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
        self._face_rows: dict[str, list[dict]] = {}   # {face_id, photo_id, person_id, det_score, bbox}
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
        c.commit()

    def _load_into_memory(self):
        for pid, uid, blob in self._db.execute(
            "SELECT photo_id, user_id, clip FROM photo_embeddings"
        ):
            self._clip_ids.setdefault(uid, []).append(pid)
            self._clip_mat.setdefault(uid, []).append(_blob_to_f32(blob))
        for uid in list(self._clip_mat):
            self._clip_mat[uid] = np.vstack(self._clip_mat[uid]) if self._clip_mat[uid] else np.zeros((0, 512), np.float32)
        for fid, pid, uid, person, score, bbox, emb in self._db.execute(
            "SELECT id, photo_id, user_id, person_id, det_score, bbox, embedding FROM faces"
        ):
            try:
                box = json.loads(bbox) if bbox else None
            except Exception:
                box = None
            self._face_rows.setdefault(uid, []).append(
                {"face_id": fid, "photo_id": pid, "person_id": person, "det_score": score, "box": box}
            )
            self._face_mat.setdefault(uid, []).append(_blob_to_f32(emb))
        for uid in list(self._face_mat):
            self._face_mat[uid] = np.vstack(self._face_mat[uid]) if self._face_mat[uid] else np.zeros((0, 512), np.float32)

    # ---- indexing state ----

    def indexed_ids(self) -> set:
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
        cur = self._db.execute("SELECT COUNT(*) FROM photo_embeddings")
        photos = cur.fetchone()[0]
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
                self._db.execute(
                    "INSERT OR REPLACE INTO faces(id,photo_id,user_id,person_id,det_score,bbox,embedding) VALUES(?,?,?,?,?,?,?)",
                    (face_id, photo_id, user_id, person_id, float(f["det_score"]), json.dumps(box or []), _f32_to_blob(emb)),
                )
                rows.append({"face_id": face_id, "photo_id": photo_id, "person_id": person_id,
                             "det_score": float(f["det_score"]), "box": box})
                r = emb.reshape(1, -1)
                existing = r if existing is None or existing.size == 0 else np.vstack([existing, r])
                self._face_mat[user_id] = existing
            self._db.commit()

    def face_user_ids(self) -> list:
        with self._lock:
            return list(self._face_rows.keys())

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

            names = {pid: name for pid, _uid, name in self._db.execute(
                "SELECT person_id,user_id,name FROM people WHERE user_id=?", (user_id,))}

            from collections import defaultdict, Counter
            label_members: dict[int, list[int]] = defaultdict(list)
            for i, l in enumerate(labels):
                label_members[int(l)].append(i)

            # Fresh, stable person_id per cluster; carry over the plurality name.
            new_person = [None] * n
            carried: dict[str, str] = {}
            for l, idxs in label_members.items():
                pid = "pp_" + uuid.uuid4().hex[:10]
                for i in idxs:
                    new_person[i] = pid
                voted = Counter(
                    names[old_person[i]] for i in idxs if names.get(old_person[i]))
                if voted:
                    carried[pid] = voted.most_common(1)[0][0]

            changed = 0
            for i, r in enumerate(rows):
                if r["person_id"] != new_person[i]:
                    self._db.execute("UPDATE faces SET person_id=? WHERE id=?",
                                     (new_person[i], r["face_id"]))
                    r["person_id"] = new_person[i]
                    changed += 1

            # Rebuild the names table for this user against the new cluster ids.
            self._db.execute("DELETE FROM people WHERE user_id=?", (user_id,))
            for pid, nm in carried.items():
                self._db.execute(
                    "INSERT INTO people(person_id,user_id,name) VALUES(?,?,?)",
                    (pid, user_id, nm))
            self._db.commit()
            after = len(set(new_person))
            return {"people_before": before, "people_after": after, "changed": changed}

    def add_place(self, photo_id: str, user_id: str, place: dict):
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO places(photo_id,user_id,city,admin1,cc,label) VALUES(?,?,?,?,?,?)",
                (photo_id, user_id, place.get("city", ""), place.get("admin1", ""), place.get("cc", ""), place.get("label", "")),
            )
            self._db.commit()

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
            groups: dict[str, dict] = {}
            for r in rows:
                g = groups.setdefault(r["person_id"], {"photos": set(), "cover": None, "cover_score": -1, "box": None})
                g["photos"].add(r["photo_id"])
                if r["det_score"] > g["cover_score"]:
                    g["cover_score"] = r["det_score"]
                    g["cover"] = r["photo_id"]
                    g["box"] = r.get("box")
            names = {pid: name for pid, uid, name in
                     self._db.execute("SELECT person_id,user_id,name FROM people WHERE user_id=?", (user_id,))}
            out = []
            for person_id, g in groups.items():
                if len(g["photos"]) < MIN_PERSON_PHOTOS:
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
