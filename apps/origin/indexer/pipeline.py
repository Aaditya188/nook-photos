"""Background indexing loop.

Polls the Node server's `db.json` (read-only) for `complete`, non-deleted photos
that aren't indexed yet, reads each thumbnail, and writes CLIP/faces/place rows.
Also prunes index rows for photos that were deleted or purged on the Node side.
"""
import json
import os
import threading

from models import load_bgr


class Pipeline:
    def __init__(self, data_dir, store, clip, faces, places, poll_interval=15):
        self.data_dir = data_dir
        self.db_path = os.path.join(data_dir, "db.json")
        self.thumbs = os.path.join(data_dir, "thumbs")
        self.store = store
        self.clip = clip
        self.faces = faces
        self.places = places
        self.poll_interval = poll_interval
        self._stop = threading.Event()
        self._dirty = False  # new faces added since the last authoritative recluster
        self.status = {"indexing": False, "done": 0, "pending": 0, "last_error": ""}

    def start(self):
        threading.Thread(target=self._loop, daemon=True).start()

    def stop(self):
        self._stop.set()

    def _read_db(self):
        try:
            with open(self.db_path) as f:
                return json.load(f)
        except Exception:
            return {"photos": []}

    def _loop(self):
        self._stop.wait(2)  # let the server bind first
        self._recluster_all()  # collapse duplicate people left by any prior index run
        while not self._stop.is_set():
            try:
                self._tick()
            except Exception as e:
                self.status["last_error"] = str(e)
                print("[pipeline] error:", e, flush=True)
            self._stop.wait(self.poll_interval)

    def _recluster_all(self):
        for uid in self.store.face_user_ids():
            try:
                res = self.store.recluster(uid)
                if res.get("changed"):
                    print(f"[pipeline] recluster {uid}: {res['people_before']} -> "
                          f"{res['people_after']} people ({res['changed']} faces reassigned)",
                          flush=True)
            except Exception as e:
                print("[pipeline] recluster error:", e, flush=True)

    def _tick(self):
        photos = self._read_db().get("photos", [])
        live = [p for p in photos if p.get("uploadState") == "complete" and not p.get("deletedAt")]
        live_ids = {p["id"] for p in live}
        indexed = self.store.indexed_ids()

        for pid in list(indexed - live_ids):  # deleted/purged → drop from index
            self.store.remove_photo(pid)

        todo = [p for p in live if p["id"] not in indexed]
        self.status["pending"] = len(todo)
        if not todo:
            self.status["indexing"] = False
            # Queue just drained and new faces arrived since the last grouping: run the
            # authoritative agglomerative recluster once (not per-sweep — it's O(n^2)).
            if self._dirty:
                self._recluster_all()
                self._dirty = False
            return
        self.status["indexing"] = True
        for p in todo:
            if self._stop.is_set():
                break
            self._index_photo(p)
            self.status["done"] += 1
            self.status["pending"] = len(todo) - self.status["done"] if False else max(0, self.status["pending"] - 1)
        self._dirty = True
        self.status["indexing"] = False

    def _index_photo(self, p):
        pid = p["id"]
        uid = p.get("userId") or "_"
        thumb = os.path.join(self.thumbs, pid + ".jpg")
        if not os.path.exists(thumb):
            self.store.mark(pid, "skipped", "no thumb")
            return
        try:
            vec = self.clip.embed_image(thumb)
            if vec is not None:
                self.store.add_clip(pid, uid, vec)

            if self.faces is not None:
                bgr = load_bgr(thumb)
                if bgr is not None:
                    ih, iw = bgr.shape[0], bgr.shape[1]
                    faces = self.faces.detect(bgr)
                    for f in faces:
                        x1, y1, x2, y2 = f["bbox"]
                        # Normalized [x, y, w, h] (top-left origin) for a client crop.
                        f["box"] = [
                            max(0.0, x1 / iw), max(0.0, y1 / ih),
                            min(1.0, (x2 - x1) / iw), min(1.0, (y2 - y1) / ih),
                        ]
                    if faces:
                        self.store.add_faces(pid, uid, faces)

            if self.places is not None:
                lat, lon = p.get("latitude"), p.get("longitude")
                if lat is not None and lon is not None:
                    place = self.places.lookup(lat, lon)
                    if place and place.get("label"):
                        self.store.add_place(pid, uid, place)

            self.store.mark(pid, "done")
        except Exception as e:
            self.store.mark(pid, "error", str(e))
            print("[pipeline] index failed", pid, e, flush=True)
