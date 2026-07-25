# Nook Photos — Product Roadmap

Nook's promise: **the polish of the big photo clouds, on hardware you own.** Every feature below maps to one of the six jobs customers hire a photos app for. Sizing: S = days, M = ~1–2 weeks, L = multi-week. ✅ = shipped.

## 1 · Never lose a photo (trust)

| Feature | Why | Size |
|---|---|---|
| ✅ Resumable backup engine, per-asset tolerance | The core promise | — |
| ✅ Login rate-limiting (per-IP + per-account lockout) | A public login must not be brute-forceable | — |
| **Backup Health panel** (web + mobile): last backup per device, pending items, failures surfaced | Trust comes from visibility, not promises | M |
| **Server snapshots**: scheduled export of `db.json` + originals manifest; documented restore | One disk must never be able to take the library | S |
| Multi-device backup (several phones → one account) | Households have more than one phone | M |
| True background backup (EAS dev build; Expo Go can't) | "Set and forget" | M |
| RAW file support (store + preview via embedded JPEG) | Enthusiast photographers | M |
| Encrypted off-site replication guide (restic/rclone) → later built-in | Fire/theft protection for the paranoid (rightly) | S→L |

## 2 · Make my photos better (editing) ⭐ flagship gap

Non-destructive by design: the server always keeps the untouched original; an edit is a stored **recipe** (crop/rotate/adjustments) rendered server-side with sharp. "Revert to original" is always one tap.

| Feature | Notes | Size |
|---|---|---|
| **Editor v1 — web**: crop (free + presets), rotate/straighten, flip | Canvas UI in the viewer; `POST /api/photos/:id/edit` stores the recipe, sharp renders the derivative | M |
| **Editor v1 — light & color**: exposure, contrast, highlights/shadows, saturation, warmth, vignette | Live CSS/WebGL preview; same recipe pipeline | M |
| Filter presets (a tasteful dozen; recipes under the hood) | One-tap "looks" | S |
| Editor on mobile (same recipes; expo-image-manipulator for crop/rotate first) | Parity with phone habits | M |
| Markup (draw/text on screenshots) | Screenshot-heavy users | M |
| Auto-enhance (histogram-based one-tap) | The most-used button in any editor | M |
| Video trim | Cut the boring first seconds | M |

## 3 · Find any photo in seconds (retrieval)

| Feature | Why | Size |
|---|---|---|
| ✅ Semantic search, people (face clustering), places | | — |
| ✅ Timeline scrubber with month/year bubble | | — |
| ✅ Faces management: name a person, merge clusters, hide a person | | — |
| ✅ Map view: clustered pins, tap-region to browse | | — |
| ✅ Blur-aware face indexing (sharpness gate + prune of already-stored junk) | | — |
| **Search filters & chips**: `person:`, `type:`, date ranges, place; recent + saved searches | Search power-usage compounds | M |
| **Split a person** / "not this person" | Merge exists; splitting a bad cluster does not | M |
| Smart albums (saved rule: person + place + date range, auto-updating) | Zero-maintenance organization | M |
| ~~OCR: search text inside screenshots/documents~~ | Built, then removed on request — it was the smallest model (15 MB) and not worth its complexity. Revert `3de34ae`'s parent to restore. | — |

## 4 · Relive moments (delight — the retention driver)

| Feature | Why | Size |
|---|---|---|
| ✅ Memories: "on this day" per-year cards | | — |
| ✅ Slideshow in the viewer | | — |
| ✅ Trip detection (time + location clustering → auto trip albums) | | — |
| Memories push notification (mobile, morning digest) | Brings people back daily | S |
| ~~Monthly / year-end recap~~ | Built, then removed on request as unused surface area | — |
| Home-screen widget (needs dev build) | Ambient delight | M |

## 5 · Share with people I love (connection)

| Feature | Why | Size |
|---|---|---|
| ✅ Album share links: expiring, optional password, optional download; viewable with no account | | — |
| ✅ Per-user album grants at view / edit level | | — |
| Shared albums (multiple accounts contribute) | Group trips | L |
| Partner sharing (auto-share everything / by person with one account) | The Google Photos killer feature for couples | L |
| One-tap "send to another user on this server" | Household convenience | S |

## 6 · Free my phone (utility)

| Feature | Why | Size |
|---|---|---|
| ✅ **Free up space** (mobile): deletes local copies only after re-verifying the server holds them | | — |
| ✅ Web drag-and-drop upload, incl. folders and Google Takeout `.zip` | | — |
| ✅ Duplicate finder (perceptual dHash verification, not just size/name) | | — |
| ~~Storage insights~~ | Built, then removed on request — nobody wants to audit their own disk | — |

## Platform & security foundation

- ✅ Biometric unlock (WebAuthn on web, Face ID/fingerprint on mobile), password-locked private albums, HEIC pipeline, range-streamed video, virtual scrolling, ZIP export
- ✅ Signed-in **devices list with revoke** + friendly device names, **2FA (TOTP)**, per-user accounts with admin roles
- ✅ Runs on Raspberry Pi / Apple Silicon / old x86: portable install, provider auto-detection, every AI model optional
- **Session token expiry** (S) — ⚠️ tokens currently never expire, so a leaked one is valid until an explicit logout. The highest-value security item on this list.
- **Short-TTL media tokens** (M) — `?token=` exists because `<img>` can't send headers, but it is currently the full session bearer. A media-scoped, expiring token would shrink the blast radius of a leaked URL.
- `db.json` → SQLite (M) — the single-file store is rewritten on every mutation; it is the real scaling ceiling
- Idle-unload the AI models (S) — the indexer holds ~3.3 GB RAM and ~2.9 GB VRAM with nothing queued
- Auto-relock private albums after idle (S)
- **PWA**: installable web app with offline shell (S — manifest and service worker already exist)
- EAS builds → App Store/Play presence, share-sheet "Save to Nook", background sync (L)
- Admin audit log (S)

## Suggested build order

1. **Session token expiry** — the one open security gap; everything else is polish by comparison
2. **`db.json` → SQLite** — unblocks scale and any future multi-device sync
3. **Search filters & chips** — the retrieval story is strong but has no structured query surface
4. **Split a person / "not this person"** — merge exists, so clusters can be joined but never corrected
5. **Idle-unload the AI models** — the biggest resource win, and what makes low-power hosts pleasant
6. Then: smart albums, shared albums, partner sharing, PWA, widgets

Contributions welcome — most S/M items are well-isolated. See the package guide in the [README](README.md).
