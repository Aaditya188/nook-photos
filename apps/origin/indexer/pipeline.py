"""Background indexing loop.

Polls the Node server's `db.json` (read-only) for `complete`, non-deleted photos
that aren't indexed yet, reads each thumbnail, and writes CLIP/faces/place rows.
Also prunes index rows for photos that were deleted or purged on the Node side.

Every model is optional and may be None (disabled by env, or it failed to load on
this host): each stage is skipped independently, and a photo with no model at all is
still marked done so the queue drains instead of retrying forever.
"""
import json
import os
import threading
import time

from models import load_bgr, face_sharpness
from store import face_quality_ok, STALE_CLIP, STALE_FACE

# Face-detection noise filters: skip low-confidence detections and tiny
# background faces (fraction of the image's larger side) so they don't spawn
# junk one-off "people". Tunable via env.
FACE_MIN_SCORE = float(os.environ.get("NOOK_FACE_MIN_SCORE", "0.62"))
FACE_MIN_SIZE = float(os.environ.get("NOOK_FACE_MIN_SIZE", "0.05"))


class Pipeline:
    def __init__(self, data_dir, store, hub, poll_interval=15, index_dir=None):
        self.data_dir = data_dir
        self.db_path = os.path.join(data_dir, "db.json")
        self.thumbs = os.path.join(data_dir, "thumbs")
        self.store = store
        self.hub = hub          # lazy model hub: GPU models load on demand, free when idle
        self.places = hub.places  # tiny + CPU-only, always resident
        self.poll_interval = poll_interval
        self._stop = threading.Event()
        # A persisted marker: set the moment faces change, cleared once an authoritative
        # recluster has run. On boot we recluster ONLY if it's still set (a prior run was
        # killed mid-index) — otherwise the grouping already stored is correct and the
        # expensive O(n^2) recluster is skipped entirely.
        self._dirty_path = os.path.join(index_dir or os.path.join(data_dir, "ai"), "faces.dirty")
        self._dirty = os.path.exists(self._dirty_path)
        self._last_memories = 0.0  # throttle for the GPU-free memories rebuild
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

    def _set_dirty(self, value):
        """Persist (or clear) the 'faces changed, recluster pending' marker."""
        self._dirty = value
        try:
            if value:
                open(self._dirty_path, "w").close()
            elif os.path.exists(self._dirty_path):
                os.remove(self._dirty_path)
        except Exception:
            pass  # best-effort; in-memory _dirty still drives this session

    def _loop(self):
        self._stop.wait(2)  # let the server bind first
        # Recluster on boot ONLY if a prior run left faces un-grouped (marker present).
        # A clean shutdown clears it, so ordinary restarts skip the O(n^2) full pass and
        # its CPU spike; new photos still get an authoritative recluster when the queue
        # next drains.
        if self._dirty:
            print("[pipeline] pending regroup from a prior run -> reclustering", flush=True)
            self._recluster_all()
            self._set_dirty(False)
        while not self._stop.is_set():
            try:
                self._tick()
            except Exception as e:
                self.status["last_error"] = str(e)
                print("[pipeline] error:", e, flush=True)
            # Release the GPU models once indexing has been idle long enough.
            try:
                self.hub.maybe_unload()
            except Exception:
                pass
            # Rebuild memory collections on a throttle. Pure metadata over db.json +
            # the already-stored faces/places -- no model load, no GPU. Runs from the
            # loop (not gated on the queue draining) so it still refreshes on a library
            # that always has a thumbless photo keeping the queue non-empty.
            self._maybe_build_memories()
            self._stop.wait(self.poll_interval)

    def _maybe_build_memories(self):
        if time.time() - self._last_memories < 3600:
            return
        try:
            from memories import build_memories
            n = build_memories(self.store, self.db_path)
            self._last_memories = time.time()
            print("[pipeline] rebuilt memories:", n, flush=True)
        except Exception as e:
            self._last_memories = time.time()  # don't hot-loop a broken build
            print("[pipeline] memories error:", e, flush=True)

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
        # Hidden photos are excluded as firmly as deleted ones. Hiding a photo has to
        # remove it from search AND from face clustering, or its face can still surface
        # as a People cover and its content is still findable by text — which defeats
        # the point of hiding it. Because the reconcile below drops anything indexed
        # that is no longer live, this one filter also PURGES already-indexed hidden
        # photos on the next sweep, and un-hiding re-queues them automatically.
        live = [
            p
            for p in photos
            if p.get("uploadState") == "complete" and not p.get("deletedAt") and not p.get("hidden")
        ]
        live_ids = {p["id"] for p in live}
        indexed = self.store.indexed_ids()

        dropped = list(indexed - live_ids)  # deleted, hidden or purged
        for pid in dropped:
            self.store.remove_photo(pid)
        if dropped:
            # Removing faces changes the grouping, so ask for one authoritative
            # recluster when the queue next drains. Without this, People keeps the
            # membership it computed while the now-hidden faces were still present.
            self._set_dirty(True)

        todo = [p for p in live if p["id"] not in indexed]
        self.status["pending"] = len(todo)
        if not todo:
            self.status["indexing"] = False
            self._commit_migrations()  # may recluster and clear _dirty itself
            # Queue just drained and new faces arrived since the last grouping: run the
            # authoritative agglomerative recluster once (not per-sweep — it's O(n^2)).
            if self._dirty:
                self._recluster_all()
                self._set_dirty(False)
            return
        self.status["indexing"] = True
        for p in todo:
            if self._stop.is_set():
                break
            self._index_photo(p)
            self.status["done"] += 1
            self.status["pending"] = len(todo) - self.status["done"] if False else max(0, self.status["pending"] - 1)
        self._set_dirty(True)
        self.status["indexing"] = False
        self._commit_migrations()

    def _commit_migrations(self):
        """Close out any model migration whose re-index has finished.

        Called from both ends of _tick, not just the drained branch, because the queue
        is never empty on a library holding any thumbless photo — those stay `skipped`,
        which keeps them out of indexed_ids and so back in `todo` on every sweep.

        A finished FACE migration then has to be followed by the authoritative
        recluster: every face was re-embedded one photo at a time, so all that exists
        at this point is add_faces' provisional single-link grouping. Free (an early
        return) when no migration is pending, which is every ordinary sweep.
        """
        if "face" in self.store.commit_pending_fingerprints():
            print("[pipeline] face model migration finished, regrouping people", flush=True)
            self._recluster_all()
            self._set_dirty(False)

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
        """Index one photo: every stage that has a model, then mark it done.

        This is deliberately all-or-nothing per photo rather than per stage. A photo
        queued by a CLIP-model change therefore has its faces recomputed too, which is
        wasted work (faces are the expensive stage) but always *correct* — add_faces
        replaces, so nothing duplicates or mixes. Making it per-stage would need index
        state per kind, and there is no way to tell "no face in this photo" from "faces
        never ran" without it, so the cheap correct thing wins.
        """
        pid = p["id"]
        uid = p.get("userId") or "_"
        thumb = os.path.join(self.thumbs, pid + ".jpg")
        if not os.path.exists(thumb):
            # Nothing to compute from. If this photo was queued by a model change, its
            # old vectors can never be recomputed — drop them, because mark() below
            # clears the stale marker that was keeping them out of search/grouping.
            stale = self.store.stale_reasons(pid)
            if STALE_CLIP in stale:
                self.store.drop_photo_clip(pid)
            if STALE_FACE in stale:
                self.store.drop_photo_faces(pid)
            self.store.mark(pid, "skipped", "no thumb")
            return
        try:
            # Lazy: the models load on the first photo of a run and are released by the
            # hub once indexing goes idle (see _loop). Cheap after the first call.
            clip = self.hub.get_clip()
            face_model = self.hub.get_faces()
            if clip is not None:
                vec = clip.embed_image(thumb)
                if vec is not None:
                    self.store.add_clip(pid, uid, vec)

            if face_model is not None:
                bgr = load_bgr(thumb)
                kept = []
                if bgr is not None:
                    ih, iw = bgr.shape[0], bgr.shape[1]
                    faces = face_model.detect(bgr)
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
                    self.store.add_faces(pid, uid, kept)  # replaces any earlier ones
                else:
                    # No usable face, or the thumb wouldn't decode. On a re-index that
                    # still has to clear what was stored before, so a photo never keeps
                    # faces produced by a superseded model. No-op the first time round.
                    self.store.drop_photo_faces(pid)

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
