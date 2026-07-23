# Nook Photos — context for AI-assisted development

Read [README.md](README.md) for architecture and [ROADMAP.md](ROADMAP.md) for the feature plan. This file captures the conventions and hard-won gotchas that keep changes consistent.

## Layout

- `apps/origin` — zero-dependency Node photo store + accounts API (port 8080) + Python AI indexer (port 8091). Data = plain files + one `db.json` under `NOOK_DATA_DIR`.
- `apps/server` — Fastify + sharp gateway (port 8090): sized thumbnails, HTTP-Range streaming, HEIC→JPEG, login rate-limiting, transparent proxy to origin, serves the web app (`apps/web/dist`, fallback `apps/webui`, override `NOOK_WEB_DIST`).
- `apps/web` — React 19 + Vite dashboard. `packages/core` — shared TS client/types/hooks. `apps/mobile` — Expo SDK 57 (runs in Expo Go). `apps/webui` — legacy vanilla dashboard (kept as fallback; do not add features there).

## Commands

- Root `npm install` hoists everything (workspaces).
- Web dev: `cd apps/web && npx vite` (proxies /api → :8090). Build: `npx vite build`. Typecheck: `../../node_modules/.bin/tsc -p tsconfig.json`.
- Gateway dev: `cd apps/server && ../../node_modules/.bin/tsx src/index.ts` (env: `NOOK_GATEWAY_PORT`, `NOOK_ORIGIN`).
- Mobile: `cd apps/mobile && npx expo start`.

## Conventions

- Web state: URL is the source of truth where it can be (routes; the open photo is `?photo=<id>`); TanStack Query for server data (library+status poll every 5 s); contexts in `src/state/` for auth/UI/view.
- Authed media: `<img>`/`<video>` can't send headers → blob LRU cache (`lib/blobCache.ts`, priority queue for the open viewer) or `?token=` query (gateway accepts both).
- The photo grid is a justified, chunked virtual scroller (`components/PhotoGrid.tsx`): whole-day segments packed into rows by aspect ratio; off-screen chunks are exact-height spacers. Any layout change must keep chunk heights analytic.
- Icons are raw 24px SVG strings (1.8 stroke) in `lib/icons.tsx`, rendered via `<Svg html/>`.
- All timestamps/labels US-English; theme via CSS vars with `html[data-theme]`.

## Gotchas

- Windows PowerShell 5.1: keep `.ps1` files pure ASCII; scripts need `Set-ExecutionPolicy -Scope Process Bypass` in fresh shells; service control needs elevation.
- Expo Go native modules can lag the SDK's JS (e.g. SecureStore) — probe availability and fall back (`apps/mobile/src/lib/secure-storage.ts`); use `/legacy` subpaths for media-library/file-system.
- Fastify: the gateway registers a `'*'` passthrough content parser, but the built-in JSON parser still handles `application/json` — route handlers may receive an object OR a stream.
- Don't use rAF or IntersectionObserver for scroll-critical logic in the web app (paused in embedded webviews); use timestamp-throttled scroll listeners. Lazy image loading via IO is fine.
- sharp on Windows may lack HEIF: HEIC decode goes through `heic-convert` in `apps/server/src/thumbs.ts`.
