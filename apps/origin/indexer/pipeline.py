"""Background indexing loop.

Polls the Node server's `db.json` (read-only) for `complete`, non-deleted photos
that aren't indexed yet, reads each thumbnail, and writes CLIP/faces/place rows.
Also prunes index rows for photos that were deleted or purged on the Node side.
"""
import json
import os
import threading
import time

from models import load_bgr, face_sharpness
from store import face_quality_ok

# Face-detection noise filters: skip low-confidence detections and tiny
# background faces (fraction of the image's larger side) so they don't spawn
# junk one-off "people". Tunable via env.
FACE_MIN_SCORE = float(os.environ.get("NOOK_FACE_MIN_SCORE", "0.62"))
FACE_MIN_SIZE = float(os.environ.get("NOOK_FACE_MIN_SIZE", "0.05"))


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
        self._maint = threading.Lock()  # one face-quality maintenance pass at a time
        self.status = {"indexing": False, "done": 0, "pending": 0, "last_error": ""}
        # Progress + outcome of the background face-quality prune, so a caller polls
        # instead of holding a request open for minutes. Every key is created here and
        # only ever reassigned — never added or removed — so another thread can safely
        # serialize this dict while the pass is mutating it.
        self.prune = {"running": False, "phase": "idle", "started_at": None,
                      "finished_at": None, "users_done": 0, "users_total": 0,
                      "photos_done": 0, "photos_total": 0, "faces_measured": 0,
                      "faces_deleted": 0, "result": None, "error": None}

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

    def start_prune(self) -> bool:
        """Begin a face-quality prune on a background thread. False if one is running.

        The pass takes minutes — longer than any HTTP client will wait — so it must not
        run inside a request handler. It used to: a client that timed out and hung up
        discarded a pass that had in fact completed, and the traceback from writing the
        response to the dead socket read exactly like a wedged lock.

        `_maint` is acquired here, on the caller's thread, and released by the worker's
        `finally`. A plain Lock has no owner, so handing it off between threads is legal,
        and it means "already running" is true from the instant the request is accepted
        until the pass is genuinely over — result, exception, or shutdown alike.
        """
        if not self._maint.acquire(blocking=False):
            return False
        self.prune.update({
            "running": True, "phase": "measuring", "started_at": time.time(),
            "finished_at": None, "users_done": 0, "users_total": 0, "photos_done": 0,
            "photos_total": 0, "faces_measured": 0, "faces_deleted": 0,
            "result": None, "error": None,
        })
        try:
            threading.Thread(target=self._prune_worker, daemon=True).start()
        except Exception:
            # Nobody will reach the worker's finally, so undo the acquire here rather
            # than leaving the lock held forever with no thread to release it.
            self.prune.update({"running": False, "phase": "idle"})
            self._maint.release()
            raise
        return True

    def _prune_worker(self):
        try:
            res = self._prune_low_quality_faces()
            self.prune.update({"phase": "cancelled" if res.get("cancelled") else "done",
                               "result": res})
        except Exception as e:
            self.prune.update({"phase": "failed", "error": str(e)})
            print("[pipeline] face prune failed:", e, flush=True)
        finally:
            self.prune.update({"running": False, "finished_at": time.time()})
            self._maint.release()

    def _prune_low_quality_faces(self) -> dict:
        """Re-measure every stored face against the current quality gate, delete the ones
        that fail, then re-group the survivors. Assumes `_maint` is held — go through
        start_prune(), never call this directly.

        Faces indexed before the sharpness gate existed include blurry and tiny crops,
        which is what left the library with hundreds of duplicate/junk "people". This
        re-reads each thumbnail once, scores every face crop, drops the failures, and
        hands the survivors to the existing agglomerative recluster. Idempotent — run it
        again after changing NOOK_FACE_MIN_SHARPNESS / NOOK_FACE_MIN_CROP_PX.

        DESTRUCTIVE TO DERIVED DATA ONLY: it deletes face rows from ai-index.sqlite,
        which are recomputed from thumbnails by a re-index. Original photos, thumbnails
        and the Node server's db.json are opened read-only or not at all, and are NEVER
        modified or deleted.
        """
        faces_before = self.store.counts().get("faces", 0)
        people_before = visible_before = 0
        deleted = measured = unmeasurable = 0
        uids = self.store.face_user_ids()
        self.prune["users_total"] = len(uids)
        for uid in uids:
            people_before += self.store.person_count(uid)
            visible_before += len(self.store.people(uid))
            by_photo: dict[str, list[dict]] = {}
            for r in self.store.face_rows(uid):
                by_photo.setdefault(r["photo_id"], []).append(r)
            self.prune.update({"photos_done": 0, "photos_total": len(by_photo)})
            keep, drop, skipped = [], [], 0
            for pid, rows in by_photo.items():
                if self._stop.is_set():
                    # Shutting down mid-scan. keep/drop only cover the photos measured so
                    # far, so writing them would prune against a partial measurement and
                    # then burn the O(n^2) recluster during shutdown. Throw this user's
                    # work away (the pass is idempotent, and the next boot reclusters
                    # anyway) and report it instead of claiming success.
                    print(f"[pipeline] face prune {uid}: cancelled at "
                          f"{self.prune['photos_done']}/{len(by_photo)} photos", flush=True)
                    return {"ok": False, "cancelled": True, "faces_before": faces_before,
                            "faces_deleted": deleted, "faces_measured": measured,
                            "faces_unmeasurable": unmeasurable}
                thumb = os.path.join(self.thumbs, pid + ".jpg")
                bgr = load_bgr(thumb) if os.path.exists(thumb) else None
                if bgr is None:
                    skipped += len(rows)  # no thumb to judge it by: leave it alone
                    self.prune["photos_done"] += 1
                    continue
                ih, iw = bgr.shape[0], bgr.shape[1]
                for r in rows:
                    box = r.get("box")
                    if not box or len(box) != 4:
                        skipped += 1
                        continue
                    sharp = face_sharpness(bgr, box)
                    crop_px = min(box[2] * iw, box[3] * ih)
                    if face_quality_ok(r["det_score"], sharp, crop_px):
                        keep.append((r["face_id"], sharp))
                    else:
                        drop.append(r["face_id"])
                self.prune["photos_done"] += 1
            measured += self.store.set_face_sharpness(uid, keep)
            deleted += self.store.delete_faces(uid, drop)
            unmeasurable += skipped
            self.prune.update({"faces_measured": measured, "faces_deleted": deleted,
                               "users_done": self.prune["users_done"] + 1})
            print(f"[pipeline] face prune {uid}: kept {len(keep)}, deleted {len(drop)}, "
                  f"unmeasurable {skipped}", flush=True)
        self.prune["phase"] = "reclustering"
        self._recluster_all()  # re-group the survivors with the existing clustering
        people_after = visible_after = 0
        for uid in self.store.face_user_ids():
            people_after += self.store.person_count(uid)
            visible_after += len(self.store.people(uid))
        return {
            "ok": True,
            "faces_before": faces_before,
            "faces_after": self.store.counts().get("faces", 0),
            "faces_deleted": deleted,
            "faces_measured": measured,
            "faces_unmeasurable": unmeasurable,
            "people_before": people_before,
            "people_after": people_after,
            "visible_before": visible_before,
            "visible_after": visible_after,
        }

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
                    kept = []
                    for f in faces:
                        x1, y1, x2, y2 = f["bbox"]
                        bw = max(0.0, (x2 - x1) / iw)
                        bh = max(0.0, (y2 - y1) / ih)
                        # Drop noise: low-confidence detections and tiny background
                        # faces, which otherwise spawn junk one-off "people".
                        if f["det_score"] < FACE_MIN_SCORE or max(bw, bh) < FACE_MIN_SIZE:
                            continue
                        # Normalized [x, y, w, h] (top-left origin) for a client crop.
                        f["box"] = [max(0.0, x1 / iw), max(0.0, y1 / ih), min(1.0, bw), min(1.0, bh)]
                        # Only CLEAR faces are stored: a blurred or postage-stamp crop
                        # embeds badly, so it never matches its own person and instead
                        # spawns a junk one-off "person".
                        f["sharpness"] = face_sharpness(bgr, f["box"])
                        if not face_quality_ok(f["det_score"], f["sharpness"], min(bw * iw, bh * ih)):
                            continue
                        kept.append(f)
                    if kept:
                        self.store.add_faces(pid, uid, kept)

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
