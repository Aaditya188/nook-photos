"""Memory collections: 'on this day', per-year, per-place, and per-person
highlights.

This is PURE METADATA work. It reads photo dates from db.json and the
ALREADY-COMPUTED face clusters + places out of the sqlite store. It never loads
CLIP or InsightFace and never touches the GPU, so it adds no inference load to
the host. The whole pass is light CPU (group + sort over the library) and runs
on a throttle, not in a loop.
"""
import json
import os
from datetime import datetime, date

MAX_PHOTOS = 60          # cap photos stored per memory
MIN_YEAR_PHOTOS = 25     # a year needs this many to become a "year" memory
MIN_PLACE_PHOTOS = 8
MIN_PERSON_PHOTOS = 10
MAX_MEMORIES = 48


def _parse(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except Exception:
        return None


def _read_photos_by_user(db_path):
    try:
        with open(db_path, encoding="utf-8") as f:
            db = json.load(f)
    except Exception:
        return {}
    by_user = {}
    for p in db.get("photos", []):
        if p.get("uploadState") != "complete" or p.get("deletedAt") or p.get("hidden"):
            continue
        dt = _parse(p.get("createdAt"))
        if dt is None:
            continue
        uid = p.get("userId") or "_"
        by_user.setdefault(uid, []).append({"id": p["id"], "dt": dt, "fav": bool(p.get("favorite"))})
    return by_user


def _cover(photos):
    favs = [p for p in photos if p["fav"]]
    pool = favs or photos
    return pool[len(pool) // 2]["id"] if pool else None


def _build_for_user(uid, photos, store):
    photos.sort(key=lambda p: p["dt"])
    today = date.today()
    this_year = today.year
    mems = []

    # 1) On this day: same month/day in a previous year.
    byday = {}
    for p in photos:
        d = p["dt"].date()
        if d.month == today.month and d.day == today.day and d.year < this_year:
            byday.setdefault(d.year, []).append(p)
    for year, ph in sorted(byday.items(), reverse=True):
        ago = this_year - year
        mems.append({
            "id": "onthisday-%d" % year, "kind": "on_this_day",
            "title": "1 year ago today" if ago == 1 else "%d years ago today" % ago,
            "subtitle": "%d %s" % (len(ph), "photo" if len(ph) == 1 else "photos"),
            "coverPhotoId": _cover(ph), "photoIds": [p["id"] for p in ph][:MAX_PHOTOS],
            "sort": 1000 - ago,
        })

    # 2) Per year highlight.
    peryear = {}
    for p in photos:
        peryear.setdefault(p["dt"].year, []).append(p)
    for year, ph in sorted(peryear.items(), reverse=True):
        if len(ph) < MIN_YEAR_PHOTOS:
            continue
        mems.append({
            "id": "year-%d" % year, "kind": "year", "title": str(year),
            "subtitle": "%d photos" % len(ph),
            "coverPhotoId": _cover(ph), "photoIds": [p["id"] for p in ph][:MAX_PHOTOS],
            "sort": 500 + (year - 2000),
        })

    # 3) Places (already reverse-geocoded by the indexer; just read them).
    try:
        for pl in store.places(uid):
            if pl.get("count", 0) < MIN_PLACE_PHOTOS:
                continue
            label = (pl.get("label") or "").split(",")[0].strip()
            if not label:
                continue
            ids = store.place_photos(uid, pl["label"])
            mems.append({
                "id": "place-%s" % pl["label"], "kind": "place",
                "title": label, "subtitle": "%d photos" % pl["count"],
                "coverPhotoId": pl.get("coverPhotoId"), "photoIds": ids[:MAX_PHOTOS],
                "sort": 300 + min(pl["count"], 199),
            })
    except Exception:
        pass

    # 4) People (named only; unnamed clusters are skipped).
    try:
        for person in store.people(uid):
            if not person.get("name") or person.get("count", 0) < MIN_PERSON_PHOTOS:
                continue
            ids = store.person_photos(uid, person["id"])
            mems.append({
                "id": "person-%s" % person["id"], "kind": "person",
                "title": person["name"], "subtitle": "%d photos" % person["count"],
                "coverPhotoId": person.get("coverPhotoId"), "photoIds": ids[:MAX_PHOTOS],
                "sort": 200 + min(person["count"], 99),
            })
    except Exception:
        pass

    mems.sort(key=lambda m: m["sort"], reverse=True)
    return mems[:MAX_MEMORIES]


def build_memories(store, db_path):
    """Regenerate and persist memories for every user. Returns the total count.

    Writes to two places: the sqlite `memories` table (kept for the indexer's own
    /memories endpoint) AND a plain memories.json in the data dir. The origin -- a
    zero-dependency Node process with no sqlite driver -- serves Memories straight
    from that JSON, so they keep working even while the indexer is stopped.
    """
    total = 0
    by_user = {}
    for uid, photos in _read_photos_by_user(db_path).items():
        mems = _build_for_user(uid, photos, store)
        store.save_memories(uid, mems)
        by_user[uid] = mems
        total += len(mems)
    # Atomic write next to db.json so the origin never reads a half-written file.
    try:
        out = os.path.join(os.path.dirname(os.path.abspath(db_path)), "memories.json")
        tmp = out + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"users": by_user}, f)
        os.replace(tmp, out)
    except Exception as e:
        print("[memories] json write failed:", e, flush=True)
    return total
