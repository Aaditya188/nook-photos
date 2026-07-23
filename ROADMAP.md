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
| **Search filters & chips**: `person:`, `type:`, date ranges, place; recent + saved searches | Search power-usage compounds | M |
| **Faces management**: name/merge/split people, "not this person", hide a person | Clustering is only as good as its corrections | M |
| Map view: clustered pins, tap-region to browse | The GPS data is already indexed | M |
| OCR: search text inside screenshots/documents | "that Wi-Fi password screenshot" | M |
| Smart albums (saved rule: person + place + date range, auto-updating) | Zero-maintenance organization | M |

## 4 · Relive moments (delight — the retention driver)

| Feature | Why | Size |
|---|---|---|
| ✅ Memories: "on this day" per-year cards | | — |
| ✅ Slideshow in the viewer | | — |
| Trip detection (time + location clustering → auto trip albums) | The photos people actually revisit | L |
| Monthly / year-end recap ("Your July", "2026 wrapped") | Shareable pride | M |
| Memories push notification (mobile, morning digest) | Brings people back daily | S |
| Home-screen widget (needs dev build) | Ambient delight | M |

## 5 · Share with people I love (connection)

| Feature | Why | Size |
|---|---|---|
| **Album share links**: expiring, optional password, optional download; viewable with no account | Makes Nook usable by the whole family | M |
| Shared albums (multiple accounts contribute) | Group trips | L |
| Partner sharing (auto-share everything / by person with one account) | The Google Photos killer feature for couples | L |
| One-tap "send to another user on this server" | Household convenience | S |

## 6 · Free my phone (utility)

| Feature | Why | Size |
|---|---|---|
| **Free up space** (mobile): delete local copies verified backed-up | The reason to self-host at all | M |
| Web drag-and-drop upload | Back up the laptop's downloads folder | M |
| Storage insights: largest files, per-year breakdown, per-user quotas | Admin peace of mind | S |
| Duplicate finder (hashes already exist server-side) | Reclaim space, reduce clutter | M |

## Platform & security foundation

- ✅ Biometric unlock (WebAuthn on web, Face ID/fingerprint on mobile), password-locked private albums, HEIC pipeline, range-streamed video, virtual scrolling, ZIP export
- Signed-in **devices list with revoke**; token expiry (S)
- **2FA (TOTP)** for accounts (M)
- Auto-relock private albums after idle (S)
- **PWA**: installable web app with offline shell (S)
- EAS builds → App Store/Play presence, share-sheet "Save to Nook", background sync (L)
- Admin audit log (S)

## Suggested build order

1. **Editing v1** (crop/rotate + light/color, web) — the single biggest feature-gap vs. every competitor
2. **Album share links** — unlocks families; pairs with the existing rate-limiting
3. **Backup Health + server snapshots** — the trust story, cheap to build
4. **Free up space (mobile)** — the self-hosting payoff
5. **Faces management + search filters** — makes the AI feel trainable
6. Then: map view, OCR, PWA, 2FA/devices, trips & recaps

Contributions welcome — most S/M items are well-isolated. See the package guide in the [README](README.md).
