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
  NOOK_ENABLE_FACES    "0" to disable face indexing           (default: on)
  NOOK_INDEX_POLL_SEC  db.json poll interval seconds          (default: 15)
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
from models import load_models
from pipeline import Pipeline

DATA_DIR = os.environ.get("NOOK_DATA_DIR") or os.path.join(os.path.dirname(__file__), "..", "data")
DATA_DIR = os.path.abspath(DATA_DIR)
INDEX_DIR = os.environ.get("NOOK_INDEX_DIR") or os.path.join(DATA_DIR, "ai")
PORT = int(os.environ.get("NOOK_INDEXER_PORT", "8091"))
SECRET = os.environ.get("NOOK_INDEXER_SECRET", "nook-indexer-dev")
ENABLE_FACES = os.environ.get("NOOK_ENABLE_FACES", "1") != "0"
POLL_SEC = int(os.environ.get("NOOK_INDEX_POLL_SEC", "15"))

# Heavy state is created in _init() (called only from the real __main__) so a
# spawned worker re-importing this module never re-runs it.
STORE = None
CLIP = None
FACES = None
PLACES = None
PIPE = None


def _init():
    global STORE, CLIP, FACES, PLACES, PIPE
    os.makedirs(INDEX_DIR, exist_ok=True)
    print(f"[nook-indexer] data={DATA_DIR} index={INDEX_DIR} port={PORT} faces={ENABLE_FACES}", flush=True)
    STORE = Store(os.path.join(INDEX_DIR, "ai-index.sqlite"))
    CLIP, FACES, PLACES = load_models(enable_faces=ENABLE_FACES)
    PIPE = Pipeline(DATA_DIR, STORE, CLIP, FACES, PLACES, poll_interval=POLL_SEC)
    PIPE.start()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass  # quiet

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
            return self._send(200, {
                "ok": True, "faces": FACES is not None, "places": PLACES is not None,
                "counts": STORE.counts(), "status": PIPE.status,
            })
        if not self._authed():
            return self._send(401, {"error": "unauthorized"})
        uid = q.get("userId", "_")
        if u.path == "/people":
            return self._send(200, {"people": STORE.people(uid)})
        if u.path == "/person-photos":
            return self._send(200, {"photoIds": STORE.person_photos(uid, q.get("personId", ""))})
        if u.path == "/places":
            return self._send(200, {"places": STORE.places(uid)})
        if u.path == "/place-photos":
            return self._send(200, {"photoIds": STORE.place_photos(uid, q.get("label", ""))})
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
                return self._send(200, {"results": []})
            qvec = CLIP.embed_text(q)
            return self._send(200, {"results": STORE.search(uid, qvec, q, limit)})
        return self._send(404, {"error": "not found"})

    def do_PATCH(self):
        if not self._authed():
            return self._send(401, {"error": "unauthorized"})
        u = urlparse(self.path)
        body = self._body()
        if u.path == "/person":
            STORE.rename_person(body.get("userId", "_"), body.get("personId", ""), (body.get("name") or "").strip())
            return self._send(200, {"ok": True})
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
