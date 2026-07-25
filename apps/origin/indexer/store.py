"""Persistent + in-memory index for the Nook AI indexer.

Owns `ai-index.sqlite` (never touched by the Node server). Embeddings are also
held in RAM as per-user numpy matrices so search/clustering are a single matmul.
Everything is scoped by `user_id` because Nook is multi-account.
"""
import json
import os
import sqlite3
import threading
import time
import uuid
import numpy as np

# Cosine-similarity floor for a CLIP result to count as relevant (tuned against
# ViT-B-32: relevant matches sit ~0.22–0.30, unrelated ~0.15).
CLIP_FLOOR = 0.20
# Two faces are the "same person" above this cosine similarity (ArcFace). Used only
# for the *provisional* streaming assignment of a new face as photos arrive; the
# authoritative grouping is recluster() below. Tuned for buffalo_l (w600k_r50).
FACE_MATCH_THRESHOLD = 0.45
# recluster() re-groups ALL of a user's faces from scratch with agglomerative
# average-linkage clustering (scipy). Two clusters merge only if their *average*
# cross-similarity exceeds this cosine — which resists the chaining that made
# single-link contaminate clusters. buffalo_l separates same-person (~0.5–0.7) from
# different-person (~0.05, 95th pct 0.20) cleanly, so a threshold in that gap is
# robust. Env-tunable: lower = more consolidation (fewer duplicate people, higher
# risk of merging look-alikes); higher = purer but more fragmentation.
FACE_CLUSTER_SIM = float(os.environ.get("NOOK_FACE_CLUSTER_SIM", "0.34"))
# Above this face count, skip the O(n^2) agglomerative pass (memory/time guard) and
# leave the streaming assignment in place.
AGGLOM_MAX_FACES = 30000
# A person needs at least this many distinct photos to surface in the UI. Raised from
# 2 to cut the long tail of acquaintances/strangers who appear in just a couple of
# photos (which otherwise reads as clutter). Env-tunable: lower to see more people.
MIN_PERSON_PHOTOS = int(os.environ.get("NOOK_MIN_PERSON_PHOTOS", "4"))
# Face-quality gate — only CLEAR faces are worth storing. A blurry or postage-stamp
# crop produces a meaningless ArcFace embedding, which is exactly what spawns
# hundreds of junk one-off "people" (and unrecognisable cover tiles).
# Minimum variance-of-Laplacian on the crop (models.face_sharpness). Measured on this
# library: median ~670, 10th percentile ~139, and the motion-blurred tail below ~100.
# Env-tunable: raise to demand crisper faces (fewer, cleaner people); lower to keep more.
FACE_MIN_SHARPNESS = float(os.environ.get("NOOK_FACE_MIN_SHARPNESS", "120"))
# Minimum crop size in thumbnail pixels (shorter side). Complements the pipeline's
# FACE_MIN_SIZE, which is a *fraction* of the frame: below ~40 px there simply isn't
# enough detail to identify anyone or to judge blur. Env-tunable: raise to reject more
# background faces; lower to keep small ones.
FACE_MIN_CROP_PX = int(os.environ.get("NOOK_FACE_MIN_CROP_PX", "40"))
# Sharpness at which a cover candidate counts as fully sharp (see _cover_score).
COVER_SHARP_TARGET = 600.0


def face_quality_ok(det_score: float, sharpness: float, crop_px: float) -> bool:
    """True if a face crop is clear enough to store: big enough, and sharp enough for
    how confidently it was detected.

    The two signals are combined rather than applied independently — a very confident
    detection is allowed to be somewhat softer (det_score 0.9 relaxes the sharpness
    floor by ~20%), a marginal one has to be crisper. `sharpness` may be None for a
    face row stored before the gate existed; those are kept until measured.
    """
    if crop_px < FACE_MIN_CROP_PX:
        return False
    if sharpness is None:
        return True
    relax = 1.25 - 0.5 * max(0.0, min(1.0, float(det_score)))
    return float(sharpness) >= FACE_MIN_SHARPNESS * relax


def _box_area(box) -> float:
    return (box[2] * box[3]) if box and len(box) == 4 else 0.0


def _cover_score(area: float, det_score: float, sharpness, rival_area: float) -> float:
    """Rank one face crop as a candidate cover tile for its person.

    A good cover is a sharp, confidently detected close-up where this person is the
    only prominent face. The rival term (the largest *other* face sharing the frame)
    is what keeps group shots out: in a photo with a second, comparably big face the
    tile can't say who the person is, so the score is scaled down hard — half-size
    rival ≈ x0.4, equal-size rival ≈ x0.25. Sharpness saturates at
    COVER_SHARP_TARGET; an unmeasured face (pre-gate row) scores neutrally so it
    neither beats nor loses to measured ones on that term alone.
    """
    if area <= 0:
        return 0.0
    q = 0.5 if sharpness is None else min(1.0, max(0.0, float(sharpness)) / COVER_SHARP_TARGET)
    solo = 1.0 / (1.0 + 3.0 * (rival_area / area))
    return area * (0.5 + 0.5 * float(det_score)) * (0.35 + 0.65 * q) * solo


def _f32_to_blob(v: np.ndarray) -> bytes:
    return np.asarray(v, dtype=np.float32).tobytes()


def _blob_to_f32(b: bytes) -> np.ndarray:
    return np.frombuffer(b, dtype=np.float32)


class Store:
    def __init__(self, path: str):
        self.path = path
        self._lock = threading.RLock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._init_schema()
        # In-memory, per-user caches.
        self._clip_ids: dict[str, list[str]] = {}
        self._clip_mat: dict[str, np.ndarray] = {}
        self._face_rows: dict[str, list[dict]] = {}   # {face_id, photo_id, person_id, det_score, box, sharpness}
        self._face_mat: dict[str, np.ndarray] = {}
        self._load_into_memory()

    # ---- schema ----

    def _init_schema(self):
        c = self._db
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS photo_embeddings (
                photo_id TEXT PRIMARY KEY, user_id TEXT, clip BLOB, indexed_at REAL
            );
            CREATE TABLE IF NOT EXISTS faces (
                id TEXT PRIMARY KEY, photo_id TEXT, user_id TEXT,
                person_id TEXT, det_score REAL, bbox TEXT, embedding BLOB
            );
            CREATE TABLE IF NOT EXISTS people (
                person_id TEXT PRIMARY KEY, user_id TEXT, name TEXT
            );
            CREATE TABLE IF NOT EXISTS places (
                photo_id TEXT PRIMARY KEY, user_id TEXT,
                city TEXT, admin1 TEXT, cc TEXT, label TEXT
            );
            CREATE TABLE IF NOT EXISTS index_state (
                photo_id TEXT PRIMARY KEY, status TEXT, error TEXT, updated_at REAL
            );
            CREATE INDEX IF NOT EXISTS faces_user ON faces(user_id);
            CREATE INDEX IF NOT EXISTS faces_person ON faces(person_id);
            CREATE INDEX IF NOT EXISTS places_user ON places(user_id);
            """
        )
        # Migration: people.hidden (0/1) for hiding a person from the rail.
        cols = [r[1] for r in c.execute("PRAGMA table_info(people)")]
        if "hidden" not in cols:
            c.execute("ALTER TABLE people ADD COLUMN hidden INTEGER DEFAULT 0")
        # Migration: faces.sharpness (variance of the Laplacian of the crop). NULL means
        # "not measured yet" — a face stored before the quality gate existed.
        fcols = [r[1] for r in c.execute("PRAGMA table_info(faces)")]
        if "sharpness" not in fcols:
            c.execute("ALTER TABLE faces ADD COLUMN sharpness REAL")
        c.commit()
        # Migration: OCR is gone, so the text table (and its indexes) are dead weight.
        # DROP releases the pages and the one-time VACUUM hands the space back to the
        # filesystem; both are no-ops on every later boot.
        if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='photo_text'").fetchone():
            c.execute("DROP TABLE photo_text")
            c.commit()
            prev = c.isolation_level
            c.isolation_level = None  # VACUUM cannot run inside a transaction
            try:
                c.execute("VACUUM")
                print("[store] dropped the OCR text table and vacuumed the index", flush=True)
            except Exception as e:
                print("[store] OCR table dropped; VACUUM skipped:", e, flush=True)
            finally:
                c.isolation_level = prev

    def _load_into_memory(self):
        for pid, uid, blob in self._db.execute(
            "SELECT photo_id, user_id, clip FROM photo_embeddings"
        ):
            self._clip_ids.setdefault(uid, []).append(pid)
            self._clip_mat.setdefault(uid, []).append(_blob_to_f32(blob))
        for uid in list(self._clip_mat):
            self._clip_mat[uid] = np.vstack(self._clip_mat[uid]) if self._clip_mat[uid] else np.zeros((0, 512), np.float32)
        for fid, pid, uid, person, score, bbox, sharp, emb in self._db.execute(
            "SELECT id, photo_id, user_id, person_id, det_score, bbox, sharpness, embedding FROM faces"
        ):
            try:
                box = json.loads(bbox) if bbox else None
            except Exception:
                box = None
            self._face_rows.setdefault(uid, []).append(
                {"face_id": fid, "photo_id": pid, "person_id": person, "det_score": score,
                 "box": box, "sharpness": sharp}
            )
            self._face_mat.setdefault(uid, []).append(_blob_to_f32(emb))
        for uid in list(self._face_mat):
            self._face_mat[uid] = np.vstack(self._face_mat[uid]) if self._face_mat[uid] else np.zeros((0, 512), np.float32)

    # ---- indexing state ----

    def indexed_ids(self) -> set:
        with self._lock:
            return {r[0] for r in self._db.execute("SELECT photo_id FROM index_state WHERE status='done'")}

    def mark(self, photo_id: str, status: str, error: str = ""):
        with self._lock:
            self._db.execute(
                "INSERT INTO index_state(photo_id,status,error,updated_at) VALUES(?,?,?,?) "
                "ON CONFLICT(photo_id) DO UPDATE SET status=excluded.status,error=excluded.error,updated_at=excluded.updated_at",
                (photo_id, status, error, time.time()),
            )
            self._db.commit()

    def counts(self) -> dict:
        # The lock is not optional: `_db` is shared by the poll thread and every HTTP
        # handler thread (check_same_thread=False), and reading it unlocked really does
        # tear — /health has raised "IndexError: tuple index out of range" from
        # fetchone()[0] here while a writer was mid-statement on the same connection.
        with self._lock:
            photos = self._db.execute("SELECT COUNT(*) FROM photo_embeddings").fetchone()[0]
            faces = self._db.execute("SELECT COUNT(*) FROM faces").fetchone()[0]
            return {"photos": photos, "faces": faces}

    # ---- writes (called by the pipeline) ----

    def add_clip(self, photo_id: str, user_id: str, vec: np.ndarray):
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO photo_embeddings(photo_id,user_id,clip,indexed_at) VALUES(?,?,?,?)",
                (photo_id, user_id, _f32_to_blob(vec), time.time()),
            )
            self._db.commit()
            ids = self._clip_ids.setdefault(user_id, [])
            mat = self._clip_mat.get(user_id)
            row = np.asarray(vec, dtype=np.float32).reshape(1, -1)
            if photo_id in ids:
                i = ids.index(photo_id)
                mat[i] = row
            else:
                ids.append(photo_id)
                self._clip_mat[user_id] = row if mat is None or mat.size == 0 else np.vstack([mat, row])

    def add_faces(self, photo_id: str, user_id: str, faces: list):
        """Insert faces, assigning a stable person_id by incremental single-link:
        a new face joins the person of its nearest existing face above threshold,
        else starts a new person. Stable ids keep user-assigned names intact."""
        with self._lock:
            existing = self._face_mat.get(user_id)
            rows = self._face_rows.setdefault(user_id, [])
            for f in faces:
                emb = np.asarray(f["embedding"], dtype=np.float32)
                person_id = None
                if existing is not None and existing.shape[0] > 0:
                    sims = existing @ emb
                    j = int(np.argmax(sims))
                    if float(sims[j]) >= FACE_MATCH_THRESHOLD:
                        person_id = rows[j]["person_id"]
                if person_id is None:
                    person_id = "pp_" + uuid.uuid4().hex[:10]
                face_id = "f_" + uuid.uuid4().hex[:12]
                box = f.get("box")
                sharp = f.get("sharpness")
                sharp = float(sharp) if sharp is not None else None
                self._db.execute(
                    "INSERT OR REPLACE INTO faces(id,photo_id,user_id,person_id,det_score,bbox,sharpness,embedding) VALUES(?,?,?,?,?,?,?,?)",
                    (face_id, photo_id, user_id, person_id, float(f["det_score"]), json.dumps(box or []), sharp, _f32_to_blob(emb)),
                )
                rows.append({"face_id": face_id, "photo_id": photo_id, "person_id": person_id,
                             "det_score": float(f["det_score"]), "box": box, "sharpness": sharp})
                r = emb.reshape(1, -1)
                existing = r if existing is None or existing.size == 0 else np.vstack([existing, r])
                self._face_mat[user_id] = existing
            self._db.commit()

    def face_user_ids(self) -> list:
        with self._lock:
            return list(self._face_rows.keys())

    def face_rows(self, user_id: str) -> list:
        """Snapshot of a user's face rows (face_id/photo_id/box/det_score/sharpness) for
        a maintenance pass that needs to re-measure crops without holding the lock."""
        with self._lock:
            return [dict(r) for r in self._face_rows.get(user_id, [])]

    def person_count(self, user_id: str) -> int:
        with self._lock:
            return len({r["person_id"] for r in self._face_rows.get(user_id, [])})

    def recluster(self, user_id: str) -> dict:
        """Re-group ALL of a user's faces from scratch with agglomerative clustering.

        The streaming assignment in add_faces is single-link (a face joins its single
        nearest neighbour), which chains and produces contaminated person clusters. This
        pass discards those provisional groups and recomputes them with average-linkage
        agglomerative clustering over every stored face embedding: two groups merge only
        when their *average* cross-similarity clears FACE_CLUSTER_SIM, so distinct people
        don't chain together. Operates purely on stored embeddings — no image reprocessing.

        User-assigned names are carried over: each new cluster inherits the name that the
        plurality of its member faces previously carried.
        """
        with self._lock:
            rows = self._face_rows.get(user_id)
            mat = self._face_mat.get(user_id)
            if not rows or mat is None or mat.shape[0] == 0:
                return {"people_before": 0, "people_after": 0, "changed": 0}

            old_person = [r["person_id"] for r in rows]
            before = len(set(old_person))
            n = mat.shape[0]
            if n < 2:
                return {"people_before": before, "people_after": before, "changed": 0}
            if n > AGGLOM_MAX_FACES:
                return {"people_before": before, "people_after": before,
                        "changed": 0, "skipped": "too_many_faces"}

            try:
                from scipy.cluster.hierarchy import linkage, fcluster
                from scipy.spatial.distance import pdist
            except Exception as e:
                print("[store] scipy unavailable, skipping recluster:", e, flush=True)
                return {"people_before": before, "people_after": before, "changed": 0}

            X = np.asarray(mat, dtype=np.float64)
            X /= np.clip(np.linalg.norm(X, axis=1, keepdims=True), 1e-9, None)
            Z = linkage(pdist(X, metric="cosine"), method="average")
            labels = fcluster(Z, t=1.0 - FACE_CLUSTER_SIM, criterion="distance")

            names, was_hidden = {}, set()
            for pid, name, hid in self._db.execute(
                    "SELECT person_id,name,hidden FROM people WHERE user_id=?", (user_id,)):
                names[pid] = name
                if hid:
                    was_hidden.add(pid)

            from collections import defaultdict, Counter
            label_members: dict[int, list[int]] = defaultdict(list)
            for i, l in enumerate(labels):
                label_members[int(l)].append(i)

            # Fresh, stable person_id per cluster; carry over the plurality name.
            new_person = [None] * n
            carried: dict[str, tuple] = {}   # new person_id -> (name, hidden)
            for l, idxs in label_members.items():
                pid = "pp_" + uuid.uuid4().hex[:10]
                for i in idxs:
                    new_person[i] = pid
                voted = Counter(
                    names[old_person[i]] for i in idxs if names.get(old_person[i]))
                nm = voted.most_common(1)[0][0] if voted else None
                # `hidden` has to ride along with the name vote. The DELETE below drops
                # this user's people rows and every cluster gets a brand-new uuid, so a
                # flag that isn't carried here is simply gone — which silently un-hid
                # everyone on each recluster (and a prune runs one at the end).
                hid = sum(1 for i in idxs if old_person[i] in was_hidden) * 2 > len(idxs)
                if nm or hid:
                    carried[pid] = (nm, hid)

            # One executemany rather than a statement per face: each UPDATE rewrites a row
            # carrying a ~2 KB embedding blob, and that is most of the WAL this pass makes.
            moves = [(new_person[i], r["face_id"]) for i, r in enumerate(rows)
                     if r["person_id"] != new_person[i]]
            self._db.executemany("UPDATE faces SET person_id=? WHERE id=?", moves)
            for i, r in enumerate(rows):
                r["person_id"] = new_person[i]

            # Rebuild the names table for this user against the new cluster ids.
            self._db.execute("DELETE FROM people WHERE user_id=?", (user_id,))
            self._db.executemany(
                "INSERT INTO people(person_id,user_id,name,hidden) VALUES(?,?,?,?)",
                [(pid, user_id, nm, 1 if hid else 0) for pid, (nm, hid) in carried.items()])
            self._db.commit()
            after = len(set(new_person))
            return {"people_before": before, "people_after": after, "changed": len(moves)}

    def add_place(self, photo_id: str, user_id: str, place: dict):
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO places(photo_id,user_id,city,admin1,cc,label) VALUES(?,?,?,?,?,?)",
                (photo_id, user_id, place.get("city", ""), place.get("admin1", ""), place.get("cc", ""), place.get("label", "")),
            )
            self._db.commit()

    def set_face_sharpness(self, user_id: str, values: list) -> int:
        """Persist measured crop sharpness for [(face_id, sharpness), ...]."""
        if not values:
            return 0
        with self._lock:
            self._db.executemany(
                "UPDATE faces SET sharpness=? WHERE id=?",
                [(float(s), fid) for fid, s in values],
            )
            self._db.commit()
            measured = {fid: float(s) for fid, s in values}
            for r in self._face_rows.get(user_id, []):
                if r["face_id"] in measured:
                    r["sharpness"] = measured[r["face_id"]]
            return len(values)

    def delete_faces(self, user_id: str, face_ids: list) -> int:
        """Delete face rows by id and drop any person left with no faces.

        DERIVED DATA ONLY: face rows live in ai-index.sqlite and are recomputed from
        thumbnails by a re-index. Original photos are never touched.
        """
        if not face_ids:
            return 0
        drop = set(face_ids)
        with self._lock:
            self._db.executemany("DELETE FROM faces WHERE id=?", [(fid,) for fid in drop])
            rows = self._face_rows.get(user_id, [])
            keep = [i for i, r in enumerate(rows) if r["face_id"] not in drop]
            deleted = len(rows) - len(keep)
            self._face_rows[user_id] = [rows[i] for i in keep]
            mat = self._face_mat.get(user_id)
            if mat is not None and mat.size:
                self._face_mat[user_id] = mat[keep] if keep else np.zeros((0, mat.shape[1]), np.float32)
            # People whose every face just went away would otherwise linger as empty
            # names in the rail.
            alive = {r["person_id"] for r in self._face_rows[user_id]}
            for (pid,) in self._db.execute(
                "SELECT person_id FROM people WHERE user_id=?", (user_id,)
            ).fetchall():
                if pid not in alive:
                    self._db.execute("DELETE FROM people WHERE person_id=?", (pid,))
            self._db.commit()
            return deleted

    def remove_photo(self, photo_id: str):
        """Drop all index rows for a photo (deleted/purged on the Node side)."""
        with self._lock:
            self._db.execute("DELETE FROM photo_embeddings WHERE photo_id=?", (photo_id,))
            self._db.execute("DELETE FROM faces WHERE photo_id=?", (photo_id,))
            self._db.execute("DELETE FROM places WHERE photo_id=?", (photo_id,))
            self._db.execute("DELETE FROM index_state WHERE photo_id=?", (photo_id,))
            self._db.commit()
            # Rebuild in-memory caches for affected users lazily on next load; here
            # we just drop the photo from the clip caches.
            for uid, ids in self._clip_ids.items():
                if photo_id in ids:
                    i = ids.index(photo_id)
                    ids.pop(i)
                    self._clip_mat[uid] = np.delete(self._clip_mat[uid], i, axis=0)
            for uid in list(self._face_rows):
                keep = [k for k, r in enumerate(self._face_rows[uid]) if r["photo_id"] != photo_id]
                if len(keep) != len(self._face_rows[uid]):
                    self._face_rows[uid] = [self._face_rows[uid][k] for k in keep]
                    self._face_mat[uid] = self._face_mat[uid][keep] if self._face_mat.get(uid) is not None and self._face_mat[uid].size else self._face_mat.get(uid)

    # ---- queries ----

    def search(self, user_id: str, query_vec: np.ndarray, text: str, limit: int = 60) -> list:
        with self._lock:
            mat = self._clip_mat.get(user_id)
            ids = self._clip_ids.get(user_id, [])
            scores: dict[str, float] = {}
            if mat is not None and mat.shape[0] > 0:
                sims = mat @ np.asarray(query_vec, dtype=np.float32)
                for pid, s in zip(ids, sims):
                    if s >= CLIP_FLOOR:
                        scores[pid] = float(s)
            # Named-place text match: boost photos whose place label contains a token.
            tokens = [t for t in text.lower().split() if len(t) >= 3]
            if tokens:
                for pid, uid, label in self._db.execute(
                    "SELECT photo_id, user_id, label FROM places WHERE user_id=?", (user_id,)
                ):
                    ll = (label or "").lower()
                    if any(t in ll for t in tokens):
                        scores[pid] = max(scores.get(pid, 0.0), 0.5) + 0.3
            ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:limit]
            return [{"photoId": pid, "score": round(s, 4)} for pid, s in ranked]

    def people(self, user_id: str) -> list:
        with self._lock:
            rows = self._face_rows.get(user_id, [])
            # Face areas indexed by photo, so a cover candidate can be judged against
            # the other faces sharing its frame.
            areas = [_box_area(r.get("box")) for r in rows]
            photo_idx: dict[str, list[int]] = {}
            for i, r in enumerate(rows):
                photo_idx.setdefault(r["photo_id"], []).append(i)
            groups: dict[str, dict] = {}
            for i, r in enumerate(rows):
                g = groups.setdefault(r["person_id"], {"photos": set(), "cover": None, "cover_score": -1.0, "box": None})
                g["photos"].add(r["photo_id"])
                # Cover = the sharpest, biggest, least-crowded shot of this person, so
                # tiles crop to a recognisable close-up of ONE face rather than a
                # smeared or tiny face out of a group photo.
                rival = max((areas[j] for j in photo_idx[r["photo_id"]] if j != i), default=0.0)
                score = _cover_score(areas[i], r["det_score"], r.get("sharpness"), rival)
                if score > g["cover_score"]:
                    g["cover_score"] = score
                    g["cover"] = r["photo_id"]
                    g["box"] = r.get("box")
            names = {}
            hidden = set()
            for pid, name, hid in self._db.execute(
                "SELECT person_id,name,hidden FROM people WHERE user_id=?", (user_id,)
            ):
                names[pid] = name
                if hid:
                    hidden.add(pid)
            out = []
            for person_id, g in groups.items():
                if len(g["photos"]) < MIN_PERSON_PHOTOS:
                    continue
                if person_id in hidden:
                    continue
                out.append({
                    "id": person_id,
                    "name": names.get(person_id),
                    "coverPhotoId": g["cover"],
                    "coverFace": g["box"],
                    "count": len(g["photos"]),
                })
            out.sort(key=lambda p: p["count"], reverse=True)
            return out

    def person_photos(self, user_id: str, person_id: str) -> list:
        with self._lock:
            seen = []
            for r in self._face_rows.get(user_id, []):
                if r["person_id"] == person_id and r["photo_id"] not in seen:
                    seen.append(r["photo_id"])
            return seen

    def rename_person(self, user_id: str, person_id: str, name: str):
        with self._lock:
            self._db.execute(
                "INSERT INTO people(person_id,user_id,name) VALUES(?,?,?) "
                "ON CONFLICT(person_id) DO UPDATE SET name=excluded.name",
                (person_id, user_id, name),
            )
            self._db.commit()

    def set_person_hidden(self, user_id: str, person_id: str, hidden: bool):
        with self._lock:
            self._db.execute(
                "INSERT INTO people(person_id,user_id,name,hidden) VALUES(?,?,NULL,?) "
                "ON CONFLICT(person_id) DO UPDATE SET hidden=excluded.hidden",
                (person_id, user_id, 1 if hidden else 0),
            )
            self._db.commit()

    def merge_people(self, user_id: str, from_id: str, into_id: str) -> int:
        """Reassign every face in `from_id` to `into_id`. Keeps the target's
        name (adopting the source's if the target is unnamed). Returns the
        number of faces moved."""
        if not from_id or not into_id or from_id == into_id:
            return 0
        with self._lock:
            cur = self._db.execute(
                "UPDATE faces SET person_id=? WHERE user_id=? AND person_id=?",
                (into_id, user_id, from_id),
            )
            moved = cur.rowcount
            names = {
                pid: name
                for pid, name in self._db.execute(
                    "SELECT person_id,name FROM people WHERE person_id IN (?,?)",
                    (from_id, into_id),
                )
            }
            if names.get(from_id) and not names.get(into_id):
                self._db.execute(
                    "INSERT INTO people(person_id,user_id,name) VALUES(?,?,?) "
                    "ON CONFLICT(person_id) DO UPDATE SET name=excluded.name",
                    (into_id, user_id, names[from_id]),
                )
            self._db.execute("DELETE FROM people WHERE person_id=?", (from_id,))
            self._db.commit()
            for r in self._face_rows.get(user_id, []):
                if r["person_id"] == from_id:
                    r["person_id"] = into_id
            return moved

    def places(self, user_id: str) -> list:
        with self._lock:
            groups: dict[str, dict] = {}
            for pid, label in self._db.execute(
                "SELECT photo_id,label FROM places WHERE user_id=? AND label!=''", (user_id,)
            ):
                g = groups.setdefault(label, {"cover": pid, "count": 0})
                g["count"] += 1
            out = [{"label": k, "coverPhotoId": v["cover"], "count": v["count"]} for k, v in groups.items()]
            out.sort(key=lambda p: p["count"], reverse=True)
            return out

    def place_photos(self, user_id: str, label: str) -> list:
        with self._lock:
            return [pid for (pid,) in self._db.execute(
                "SELECT photo_id FROM places WHERE user_id=? AND label=?", (user_id, label))]
