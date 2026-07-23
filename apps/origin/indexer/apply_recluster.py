"""Standalone one-shot: re-group all faces in ai-index.sqlite with the same
agglomerative average-linkage clustering the service now uses, and write the new
person_ids back. Lets the improved grouping take effect on the next service reload
(reboot or restart) without needing to inject into the running process.

Safe to run while the (idle) service is up: SQLite WAL coordinates the writers.
"""
import os, sqlite3, uuid
import numpy as np
from collections import defaultdict, Counter
from scipy.cluster.hierarchy import linkage, fcluster
from scipy.spatial.distance import pdist

DB = os.environ.get("NOOK_AI_DB", r"D:\photos\ai\ai-index.sqlite")
SIM = float(os.environ.get("NOOK_FACE_CLUSTER_SIM", "0.34"))
MIN_PHOTOS = 2

con = sqlite3.connect(DB, timeout=30)
con.execute("PRAGMA busy_timeout=30000")

rows = con.execute("SELECT id, user_id, photo_id, person_id, embedding FROM faces").fetchall()
by_user = defaultdict(list)
for fid, uid, photo, person, blob in rows:
    by_user[uid].append((fid, photo, person, np.frombuffer(blob, dtype=np.float32)))

def surfaced(person_of, photo_of):
    ph = defaultdict(set)
    for i, p in enumerate(person_of):
        ph[p].add(photo_of[i])
    return sum(1 for s in ph.values() if len(s) >= MIN_PHOTOS)

for uid, items in by_user.items():
    n = len(items)
    if n < 2:
        continue
    fids = [it[0] for it in items]
    photos = [it[1] for it in items]
    old_person = [it[2] for it in items]
    X = np.vstack([it[3] for it in items]).astype(np.float64)
    X /= np.clip(np.linalg.norm(X, axis=1, keepdims=True), 1e-9, None)

    before_people = len(set(old_person))
    before_surf = surfaced(old_person, photos)

    Z = linkage(pdist(X, metric="cosine"), method="average")
    labels = fcluster(Z, t=1.0 - SIM, criterion="distance")

    # carry names (majority) from old people table
    names = {pid: nm for pid, u, nm in
             con.execute("SELECT person_id,user_id,name FROM people WHERE user_id=?", (uid,))}
    label_idx = defaultdict(list)
    for i, l in enumerate(labels):
        label_idx[int(l)].append(i)

    new_person = [None] * n
    carried = {}
    for l, idxs in label_idx.items():
        pid = "pp_" + uuid.uuid4().hex[:10]
        for i in idxs:
            new_person[i] = pid
        voted = Counter(names[old_person[i]] for i in idxs if names.get(old_person[i]))
        if voted:
            carried[pid] = voted.most_common(1)[0][0]

    con.executemany("UPDATE faces SET person_id=? WHERE id=?",
                    [(new_person[i], fids[i]) for i in range(n)])
    con.execute("DELETE FROM people WHERE user_id=?", (uid,))
    con.executemany("INSERT INTO people(person_id,user_id,name) VALUES(?,?,?)",
                    [(pid, uid, nm) for pid, nm in carried.items()])
    con.commit()

    after_people = len(set(new_person))
    after_surf = surfaced(new_person, photos)
    top = sorted(Counter(new_person).values(), reverse=True)[:12]
    # top by distinct photos:
    ph = defaultdict(set)
    for i, p in enumerate(new_person):
        ph[p].add(photos[i])
    top_photos = sorted((len(s) for s in ph.values()), reverse=True)[:12]
    print(f"user {uid}: clusters {before_people}->{after_people}, "
          f"surfaced(>=2 photos) {before_surf}->{after_surf}")
    print(f"  top person photo-counts: {top_photos}")

con.close()
print("done.")
