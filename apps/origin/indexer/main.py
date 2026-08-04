#!/usr/bin/env python3
"""nook-indexer — the local AI sidecar for Nook Photos.

Runs on the same machine as the Node server, reads its data dir, and serves
semantic search / people / places over a localhost-only HTTP API that the Node
server proxies. Nothing leaves the box.

Env:
  NOOK_DATA_DIR        data dir shared with the Node server (db.json, thumbs/)   [required]
  NOOK_INDEX_DIR       where ai-index.sqlite lives            (default: DATA_DIR/ai)
  NOOK_INDEXER_PORT    listen port                            (default: 8091)
  NOOK_INDEXER_SECRET  shared secret required on every call   (default: dev value)
  NOOK_ENABLE_CLIP     "0" to disable semantic search         (default: on)
  NOOK_ENABLE_FACES    "0" to disable face indexing           (default: on)
  NOOK_INDEX_POLL_SEC  db.json poll interval seconds          (default: 15)

Every AI capability is optional and independently degradable: with all of them off
(or unable to load on this hardware) the sidecar still runs, still tracks the index,
and the app still has thumbnails, albums, dates and browsing. GET /health reports
exactly which ones are live.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# On Windows the CUDA/cuDNN runtime ships as pip wheels under nvidia/*/bin. Register
# every one of those dirs with the loader BEFORE any ORT session (insightface/fastembed)
# starts, so cuDNN can also find its lazily-loaded sublibraries (e.g.
# cudnn_engines_tensor_ir64_9.dll) at inference time — otherwise Conv nodes fail with
# CUDNN_STATUS_SUBLIBRARY_LOADING_FAILED and CLIP/face convolutions silently break.
def _register_cuda_dlls():
    import glob
    try:
        import nvidia
    except Exception:
        return
    # `nvidia` is a namespace package (no __init__), so __file__ is None; use __path__.
    bases = list(getattr(nvidia, "__path__", []) or [])
    added = []
    bindirs = []
    for base in bases:
        bindirs.extend(glob.glob(os.path.join(base, "*", "bin")))
    for bindir in bindirs:
        if os.path.isdir(bindir):
            try:
                os.add_dll_directory(bindir)  # Windows only
            except (AttributeError, OSError):
                pass
            os.environ["PATH"] = bindir + os.pathsep + os.environ.get("PATH", "")
            added.append(bindir)
    if added:
        print(f"[nook-indexer] registered {len(added)} CUDA DLL dirs", flush=True)

_register_cuda_dlls()
try:
    import onnxruntime as _ort
    if hasattr(_ort, "preload_dlls"):
        _ort.preload_dlls()
except Exception as _e:
    print("[nook-indexer] onnxruntime preload_dlls skipped:", _e, flush=True)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from store import Store
from models import ModelHub
from pipeline import Pipeline

DATA_DIR = os.environ.get("NOOK_DATA_DIR") or os.path.join(os.path.dirname(__file__), "..", "data")
DATA_DIR = os.path.abspath(DATA_DIR)
INDEX_DIR = os.environ.get("NOOK_INDEX_DIR") or os.path.join(DATA_DIR, "ai")
PORT = int(os.environ.get("NOOK_INDEXER_PORT", "8091"))
SECRET = os.environ.get("NOOK_INDEXER_SECRET", "nook-indexer-dev")
ENABLE_CLIP = os.environ.get("NOOK_ENABLE_CLIP", "1") != "0"
ENABLE_FACES = os.environ.get("NOOK_ENABLE_FACES", "1") != "0"
POLL_SEC = int(os.environ.get("NOOK_INDEX_POLL_SEC", "15"))
# Release the GPU models after this many idle seconds (no indexing / no search), so a
# mostly-caught-up library doesn't pin VRAM the whole time the service is up.
IDLE_UNLOAD_SEC = int(os.environ.get("NOOK_IDLE_UNLOAD_SEC", "180"))

# Heavy state is created in _init() (called only from the real __main__) so a
# spawned worker re-importing this module never re-runs it.
STORE = None
HUB = None
PIPE = None


def _capabilities() -> dict:
    """What this host can actually do, for /health. Reports model AVAILABILITY (enabled
    and not permanently failed), not whether it's resident this instant — the hub loads
    lazily and unloads when idle, and /health must stay stable across that. `search` is
    true when a text query can return anything at all — place labels match without CLIP."""
    return {
        "clip": HUB.available_clip(),
        "faces": HUB.available_faces(),
        "places": HUB.places is not None,
        "semanticSearch": HUB.available_clip(),
        "search": HUB.available_clip() or HUB.places is not None,
    }


def _init():
    global STORE, HUB, PIPE
    os.makedirs(INDEX_DIR, exist_ok=True)
    print(f"[nook-indexer] data={DATA_DIR} index={INDEX_DIR} port={PORT} "
          f"clip={ENABLE_CLIP} faces={ENABLE_FACES} idle_unload={IDLE_UNLOAD_SEC}s", flush=True)
    STORE = Store(os.path.join(INDEX_DIR, "ai-index.sqlite"))
    # The hub loads CLIP/faces lazily (only while indexing/searching) and frees them
    # when idle; Places is CPU-only and stays resident.
    HUB = ModelHub(enable_clip=ENABLE_CLIP, enable_faces=ENABLE_FACES,
                   idle_unload_sec=IDLE_UNLOAD_SEC)
    # Which models produced the stored vectors? Fingerprints are static (no model load
    # needed), so this stays cheap. A disabled kind passes None and is left untouched —
    # a disabled model must not invalidate its own vectors.
    STORE.sync_model_fingerprints(HUB.fingerprints())
    PIPE = Pipeline(DATA_DIR, STORE, HUB, poll_interval=POLL_SEC, index_dir=INDEX_DIR)
    PIPE.start()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    # HTTP/1.1 means keep-alive, so a client that walks away without closing would
    # otherwise park its handler thread in rfile.readline() forever. Drop idle sockets.
    timeout = 30

    def log_message(self, *args):
        pass  # quiet

    def handle(self):
        # A client vanishing is a fact about the client, not a server fault, but
        # socketserver logs it as a multi-frame traceback. Those buried the real signal
        # in this log (25 of them in one boot) and made a completed prune look like a
        # crash, so swallow just the connection-level ones — anything else still raises.
        try:
            super().handle()
        except (ConnectionError, TimeoutError):
            self.close_connection = True

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionError, TimeoutError):
            # Client hung up before we answered. Routine, and never interesting: the
            # handler's work is already done and committed.
            self.close_connection = True

    def _authed(self) -> bool:
        return self.headers.get("X-Indexer-Secret", "") == SECRET

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length", "0") or 0)
        if n <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/health":
            caps = _capabilities()
            return self._send(200, {
                # `faces`/`places` stay top-level: the Node server and the web app
                # already read them from here.
                "ok": True, "faces": caps["faces"], "places": caps["places"],
                "clip": caps["clip"], "capabilities": caps,
                "providers": {
                    "clip": HUB.clip_provider,
                    "faces": HUB.faces_provider,
                },
                "models": STORE.model_state(),
                "counts": STORE.counts(), "status": PIPE.status, "prune": PIPE.prune,
            })
        if not self._authed():
            return self._send(401, {"error": "unauthorized"})
        uid = q.get("userId", "_")
        if u.path == "/faces/prune":
            return self._send(200, {"prune": PIPE.prune})  # progress/result of the last pass
        if u.path == "/people":
            return self._send(200, {"people": STORE.people(uid)})
        if u.path == "/person-photos":
            return self._send(200, {"photoIds": STORE.person_photos(uid, q.get("personId", ""))})
        if u.path == "/places":
            return self._send(200, {"places": STORE.places(uid)})
        if u.path == "/place-photos":
            return self._send(200, {"photoIds": STORE.place_photos(uid, q.get("label", ""))})
        if u.path == "/memories":
            return self._send(200, {"memories": STORE.get_memories(uid)})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._authed():
            return self._send(401, {"error": "unauthorized"})
        u = urlparse(self.path)
        body = self._body()
        if u.path == "/search":
            q = (body.get("q") or "").strip()
            uid = body.get("userId", "_")
            limit = int(body.get("limit", 60))
            if not q:
                return self._send(200, {"results": [], "semantic": HUB.available_clip()})
            # No CLIP on this host → no query vector. Search still runs: store.search
            # matches place labels, so "paris" works and anything else comes back empty
            # instead of 500-ing. `semantic` tells the caller which kind of answer it is.
            # get_clip() lazily loads the model (a few seconds the first time after an
            # idle unload) and stamps last-use so it isn't unloaded out from under us.
            qvec = None
            clip = HUB.get_clip()
            if clip is not None:
                try:
                    qvec = clip.embed_text(q)
                except Exception as e:
                    print("[nook-indexer] text embed failed:", e, flush=True)
            return self._send(200, {
                "results": STORE.search(uid, qvec, q, limit),
                "semantic": qvec is not None,
            })
        if u.path == "/faces/prune":
            # Maintenance: re-measure stored face crops, delete the blurry/tiny ones and
            # re-group the rest. Derived data only — original photos are never touched.
            # Takes minutes, so it runs on a background thread and this answers at once;
            # poll GET /faces/prune (or /health) for progress and the final result.
            if not PIPE.start_prune():
                return self._send(409, {"error": "prune already running", "prune": PIPE.prune})
            return self._send(202, {"started": True, "prune": PIPE.prune})
        return self._send(404, {"error": "not found"})

    def do_PATCH(self):
        if not self._authed():
            return self._send(401, {"error": "unauthorized"})
        u = urlparse(self.path)
        body = self._body()
        if u.path == "/person":
            user_id = body.get("userId", "_")
            person_id = body.get("personId", "")
            if "name" in body:
                STORE.rename_person(user_id, person_id, (body.get("name") or "").strip())
            if "hidden" in body:
                STORE.set_person_hidden(user_id, person_id, bool(body.get("hidden")))
            return self._send(200, {"ok": True})
        if u.path == "/person/merge":
            moved = STORE.merge_people(
                body.get("userId", "_"), body.get("fromId", ""), body.get("intoId", "")
            )
            return self._send(200, {"ok": True, "moved": moved})
        return self._send(404, {"error": "not found"})


def main():
    _init()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[nook-indexer] listening on 127.0.0.1:{PORT}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        PIPE.stop()
        srv.shutdown()


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    main()
