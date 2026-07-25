# Nook Photos

A self-hosted photo backup and browsing ecosystem — your own private Google Photos, running on your own hardware. iPhone/Android app for backup, a fast web dashboard for browsing, and an AI indexer for search, faces, and places.

<p align="center">
  <img src="design-reference/library-home-dark.png" alt="Library (dark)" width="30%">
  &nbsp;
  <img src="design-reference/library-home.png" alt="Library (light)" width="30%">
  &nbsp;
  <img src="design-reference/albums-and-utilities-dark.png" alt="Albums" width="30%">
</p>

## What's inside

This is an npm-workspaces monorepo:

| Package | What it is |
|---|---|
| [`packages/core`](packages/core) | Framework-agnostic TypeScript shared by every client: typed `NookClient` for the full server API, data types, TanStack Query hooks, MD3 theme tokens, formatting helpers. No DOM or Expo imports — platform storage is injected. |
| [`apps/mobile`](apps/mobile) | **The phone app** — Expo (SDK 54) + Expo Router, runs in Expo Go. Zoomable date-grouped photo grid, backup & sync engine (diff against the server, thumbnail + original upload, resumable), custom video player with buffering states, biometric-gated private albums, people/places/search, light + dark themes. |
| [`apps/web`](apps/web) | **The web dashboard** — React 19 + Vite + react-router + TanStack Query. Chunked **virtual scroller** (the DOM holds a few hundred tiles even in a 10k+ photo library, with a full-height scrollbar you can drag anywhere), authed blob thumbnail cache, progressive photo viewer with server-side HEIC decode, range-streamed video, multi-select with client-side ZIP download, password-locked Hidden / Recently Deleted albums behind a lock wall, dark / light / system theme, pinch or Ctrl-scroll grid density zoom. |
| [`apps/webui`](apps/webui) | The original dependency-free vanilla-JS dashboard, kept fully working as the battle-tested fallback. Same feature set as `apps/web`. |
| [`apps/server`](apps/server) | **Performance gateway** — Fastify + sharp. Size-bucketed thumbnails resized on the fly and disk-cached (`?w=128…1024`), HTTP-Range streaming for video/originals, server-side HEIC → JPEG for full-resolution viewing, transparent proxy to the origin API for everything else, and static hosting for the web dashboard. Media auth accepts `?token=` for `<img>`/`<video>` elements that can't send headers. |
| [`apps/origin`](apps/origin) | **Origin server** — the photo store itself: a zero-dependency Node file server (accounts with scrypt passwords, bearer tokens, library/albums/hidden/deleted APIs, uploads) plus the optional Python **AI indexer** (semantic search, face clustering, places — GPU-accelerated when available). All storage is plain files + one `db.json`; your library is never locked into a database. |
| [`design-reference`](design-reference) | The Stitch design screens (light + dark) the apps are built against. |

## Architecture

```
                    ┌──────────────────────────────────────────────┐
  iPhone (Expo Go)  │  Host machine                                │
  ┌─────────────┐   │   ┌─────────────────┐    ┌────────────────┐  │
  │  apps/mobile ├───┼──►│ Fastify gateway │───►│ Origin server  │  │
  └─────────────┘   │   │  (apps/server)  │    │ (photo store,  │  │
  Browser           │   │  thumbs · range │    │  accounts, API)│  │
  ┌─────────────┐   │   │  HEIC · proxy   │    └───────┬────────┘  │
  │   apps/web   ├───┼──►│  serves web UI  │            │           │
  └─────────────┘   │   └─────────────────┘    ┌───────▼────────┐  │
        ▲           │        (via tunnel)      │  AI indexer    │  │
        └───────────┼── Cloudflare Tunnel      │ (search/faces/ │  │
                    │                          │  places, GPU)  │  │
                    └──────────────────────────┴────────────────┘  │
```

## Getting started

Prerequisites: Node 20+, npm 10+. For the mobile app: the Expo Go app on your phone.

```bash
git clone https://github.com/Aaditya188/nook-photos.git
cd nook-photos
npm install
```

### Origin server (the photo store)

```bash
cd apps/origin
node server.js      # listens on :8080; library lives in ./data (NOOK_DATA_DIR to change)
```

### Optional AI (semantic search, faces, places)

A Python sidecar the server auto-detects on :8091. Entirely optional — without it you still get thumbnails, albums, dates and browsing.

```bash
cd apps/origin/indexer
./setup-indexer.sh          # venv + deps + model download; --gpu for NVIDIA (see below)
python main.py              # or install the systemd unit the script prints
```

Requires **Python 3.11+**. `pip install -r requirements.txt` is the portable install and works as-is on Raspberry Pi OS 64-bit (aarch64), Apple Silicon, and old x86 Windows/Linux, using CPU inference — plus Apple's CoreML automatically on Apple Silicon.

GPU is a deliberate opt-in, because each accelerator is a *different* PyPI package that overwrites the same `onnxruntime` files, so exactly one can be installed and it has to be written last:

| Hardware | Extra step after `requirements.txt` |
|---|---|
| NVIDIA (Linux/Windows x86_64) | `pip install --force-reinstall --no-deps -r requirements-gpu.txt` |
| Windows + Intel/AMD GPU | `pip install --force-reinstall --no-deps onnxruntime-directml==1.24.4` |
| Intel CPU/iGPU (x86_64) | `pip install --force-reinstall --no-deps onnxruntime-openvino==1.24.1` |
| Apple Silicon | nothing — CoreML is already in the portable install |
| Raspberry Pi / aarch64 | nothing — CPU only; no accelerated wheel exists for its SoC |

`requirements-gpu.txt` documents the whole trap in detail. The indexer picks the best provider it finds at startup (CUDA > DirectML > CoreML > OpenVINO > CPU) and logs which one it actually got; `curl localhost:8091/health` reports the live capabilities.

Known limits: 32-bit Raspberry Pi OS is unsupported (no `onnxruntime` wheel has ever existed for armv7l), Apple Silicon needs macOS 14+, and Intel Macs are capped at `onnxruntime` 1.23.2.

On slow hardware, face detection is by far the most expensive stage — set `NOOK_ENABLE_FACES=0` (and `NOOK_ENABLE_CLIP=0` to drop semantic search too). Either can be turned back on later; the indexer notices and backfills the existing library.

### Gateway (thumbnails, streaming, serves the web app)

```bash
cd apps/server
npm run build -w @nook/web            # build the dashboard once
../../node_modules/.bin/tsx src/index.ts   # listens on :8090 → open http://localhost:8090
```

For an always-on setup, `apps/origin/install-services.ps1` and `apps/server/install-gateway-service.ps1` register both as Windows services (macOS: LaunchAgents — see the in-app setup guide).

### Web dashboard (dev)

```bash
cd apps/web
npx vite            # http://localhost:5173, proxies /api to the gateway on :8090
```

Production build: `npx vite build` → `apps/web/dist`, which the gateway can serve directly.

### Mobile app

```bash
cd apps/mobile
npx expo start      # scan the QR with your phone's camera → opens in Expo Go
```

On first launch, point the app at your server URL, test the connection, and sign in.

## Highlights

- **Virtual scrolling that scales** — photo lists are split into chunks of whole days (or whole grid rows); off-screen chunks collapse into measured spacers, so scroll position, scrollbar size, and memory stay correct at any library size.
- **Density-aware thumbnails** — the grid requests exactly the pixel size it renders (`?w=` buckets by zoom level × devicePixelRatio); the gateway resizes with sharp and caches per size.
- **HEIC everywhere** — iPhone HEIC originals are decoded server-side to full-resolution JPEG for browsers that can't display them.
- **Chunked video** — HTTP-Range streaming end to end; seeking never downloads the whole file.
- **Private albums** — Hidden and Recently Deleted sit behind a password lock (biometrics on mobile) with a session-scoped unlock.
- **Client-side ZIP** — multi-select download builds an uncompressed ZIP in the browser with zero dependencies.

## Self-hosting guide

First run: start the server, open the web app, and create your admin account — the in-app **setup guide** (`/welcome`, also under Account → Setup guide) walks you through the rest. The short version:

1. **Keep it always on**
   - *Windows*: `apps/server/install-gateway-service.ps1` (elevated PowerShell) registers the gateway as an auto-start service via [NSSM](https://nssm.cc).
   - *macOS*: register a LaunchAgent (`~/Library/LaunchAgents/com.nook.server.plist` with `RunAtLoad` + `KeepAlive`) pointing at the server entry.
2. **Connect your phone** — open the mobile app, enter your server address, sign in, and start a backup from *Backup & Sync*.
3. **Reach it from anywhere** (optional) — a free [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) gives the gateway a public HTTPS hostname with no port forwarding: `cloudflared tunnel create nook`, route a DNS name, point the ingress at `http://localhost:8090`.

## Repo conventions

- `npm install` at the root hoists everything; `@nook/core` is symlinked into both apps.
- TypeScript everywhere except `apps/webui` (intentionally dependency-free vanilla JS).
- The web app reuses the vanilla dashboard's stylesheet and markup classes 1:1, so the two stay visually identical.

## License

[MIT](LICENSE)
