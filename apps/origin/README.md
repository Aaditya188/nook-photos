# Nook Photos server (v2 — accounts)

Zero-dependency Node.js (>= 16) file server for the Nook Photos backup box.
Implements the API contract in [`../docs/API.md`](../docs/API.md) using only
`http`, `fs`, `path`, `crypto`, and `os` — no npm install, no `express`, no
global `fetch`, no `node:sqlite`.

Auth is **per-user with bearer tokens** — there is no shared key. The server
starts **unclaimed**: the first account created via `POST /api/setup` becomes the
admin, after which setup is closed. Every user sees only their own photos and
albums.

## Run

```sh
node server.js
```

On boot the server auto-creates the data directory and its `originals/` and
`thumbs/` subfolders, and loads any existing `db.json`.

## First-run flow

```sh
# 1. Is the box claimed yet?
curl http://127.0.0.1:8080/api/ping
#   -> {"ok":true,"server":"nook","version":"2.0","setupRequired":true}

# 2. Claim it (first account becomes admin)
curl -X POST http://127.0.0.1:8080/api/setup -H 'Content-Type: application/json' \
  -d '{"username":"aaditya","password":"...","displayName":"Aaditya","email":"a@x.com"}'
#   -> {"token":"<bearer>","user":{...,"role":"admin"}}

# 3. Log in later to get a fresh token
curl -X POST http://127.0.0.1:8080/api/login -H 'Content-Type: application/json' \
  -d '{"username":"aaditya","password":"..."}'

# 4. Use the token on every other /api/* route
curl http://127.0.0.1:8080/api/library -H 'Authorization: Bearer <bearer>'
```

## Environment variables

All optional — sensible auto-detection, never a user-identity default.

| Variable                   | Default                                         | Purpose                                    |
|----------------------------|-------------------------------------------------|--------------------------------------------|
| `NOOK_PORT`                | `8080`                                           | TCP port to listen on                      |
| `NOOK_SERVER_NAME`         | `os.hostname()`                                  | Display name of the server                 |
| `NOOK_SERVER_MODEL`        | `Model` line from `/proc/cpuinfo` (Pi), else `""`| Hardware label reported to clients         |
| `NOOK_STORAGE_TOTAL_BYTES` | free+used of the data disk (`statfs`), else 1 TB | Capacity to report in `/api/status`        |
| `NOOK_DATA_DIR`            | `./data`                                         | Where `db.json`, originals, and thumbs live|

There is **no** `NOOK_KEY` in v2 — access is accounts, not a shared secret.

Each request is logged as one line: `METHOD /path STATUS ms`.

## Auth model

- Public (no token): `GET /api/ping`, `GET /api/server`, `POST /api/setup`,
  `POST /api/login`, and everything under static (`/` + assets).
- Every other `/api/*` route requires `Authorization: Bearer <token>`; a missing
  or invalid token returns `401 {"error": "..."}`.
- Passwords are hashed with `scrypt(password, 16-byte salt, 64)` and stored as
  `{saltHex, hashHex}`; verification uses `crypto.timingSafeEqual`. Plaintext
  passwords are never stored or returned.
- Tokens are `crypto.randomBytes(32).toString("hex")`, persisted server-side, and
  revoked on `POST /api/logout`.

## Roles & users

- The first account (via `/api/setup`) is an `admin`. Accounts created later via
  `POST /api/users` default to `member` (pass `role` to override).
- `GET/POST /api/users` and `DELETE /api/users/:id` are **admin-only** (`403`
  otherwise). An admin cannot delete their own account or the last admin.
- Deleting a user cascades: their photos (and stored files), albums, and tokens
  are removed too.

## Data layout

```
server/
  server.js          # the whole server
  public/            # web dashboard (static, served at /; SPA fallback to index.html)
  data/              # runtime state (path overridable via NOOK_DATA_DIR)
    db.json          # {users, tokens, photos, albums} — rewritten atomically on every mutation
    originals/<id>   # raw uploaded bytes, stored verbatim (Content-Type kept in the record)
    thumbs/<id>.jpg  # client-generated JPEG thumbnails
```

`db.json` is the only index. Every photo and album carries a `userId`; queries,
uploads, downloads, and mutations are scoped to the caller — another user's
record reads as `404`. Uploads and `db.json` writes go through a temp-file +
rename so a power cut on the Pi never leaves a torn file.

## Raspberry Pi (systemd)

Install Node 16+ on the Pi, copy the `server/` directory to
`/opt/nook-photos/server`, then create `/etc/systemd/system/nook-photos.service`:

```ini
[Unit]
Description=Nook Photos server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nook
WorkingDirectory=/opt/nook-photos/server
ExecStart=/usr/bin/node /opt/nook-photos/server/server.js
Environment=NOOK_PORT=8080
# Optional overrides:
# Environment=NOOK_SERVER_NAME=nook.local
# Environment=NOOK_DATA_DIR=/mnt/nook-drive/data
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable and start:

```sh
sudo useradd -r -s /usr/sbin/nologin nook   # once
sudo chown -R nook /opt/nook-photos/server
sudo systemctl daemon-reload
sudo systemctl enable --now nook-photos
journalctl -u nook-photos -f                # tail the request log
```

If the Pi stores photos on an external drive, point `NOOK_DATA_DIR` at the mount
(e.g. `/mnt/nook-drive/data`) instead of symlinking.

## Notes

- CORS: `/api/*` answers with `Access-Control-Allow-Origin: *`, allows the
  `Authorization` and `Content-Type` headers, and handles `OPTIONS` preflight
  with `204`, so the dashboard can be served from anywhere during development.
- Uploads are buffered with a 500 MB cap (`413` beyond that) and stored verbatim
  with their `Content-Type`. Thumbnails are generated client-side and stored as
  JPEG. The server never generates thumbnails.
- Static routes need no auth; path traversal outside `public/` is rejected.
- Every handler is wrapped in try/catch and answers with `{"error": ...}` and the
  right status (`400/401/403/404/409/500`); the process is designed never to
  crash on a bad request.
