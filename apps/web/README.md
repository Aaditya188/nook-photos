# `apps/web`, the web dashboard

React 19 + Vite + react-router + TanStack Query. Built to `apps/web/dist`, which the gateway
(`apps/server`) serves at `/`.

The hard problem here is scale: a 10k+ photo library has to scroll like a native app, with a
scrollbar you can drag anywhere, in a browser tab.

## Running it

```bash
cd apps/web
npx vite                                   # http://localhost:5173, proxies /api → :8090
npx vite build                             # → dist/, what the gateway serves
./node_modules/.bin/tsc -p tsconfig.json   # typecheck
```

The dev server needs the gateway running on `:8090`.

## Layout

```
src/App.tsx            routes + chrome
src/components/        PhotoGrid (virtual scroller), Lightbox, Editor, Tile, Upload…
src/views/             one file per route (Settings, MapView, Trips, Onboarding…)
src/state/             auth / UI / view contexts, URL is the source of truth
src/hooks/             useScrollLock, useGridZoom, useStickyHeights…
src/lib/               blobCache, icons, format, upload, unzip
src/styles.css         all styling, CSS variables, html[data-theme]
```

## The virtual scroller

[`components/PhotoGrid.tsx`](src/components/PhotoGrid.tsx) is a **justified, chunked** grid:

1. Photos group into whole-day segments, packed into rows by aspect ratio to a target height.
2. Segments batch into chunks of roughly `CHUNK_TARGET` photos.
3. Chunks near the viewport render real tiles; the rest collapse to a `<div>` of **exactly** their
   computed height.

That last point is the invariant everything rests on: **chunk heights must stay analytic** -
computable from the data without rendering. That's what keeps total document height, scroll
position, and scrollbar size correct at any library size. If a layout change makes a chunk's height
depend on measuring rendered content, scrolling breaks in ways that are very hard to diagnose.

The visible range is computed two ways on purpose: a fast `getBoundingClientRect()` scan of attached
chunks, and an **analytic fallback** derived from `window.scrollY` plus cumulative chunk heights.
The fallback isn't a rare safety net, React nulls callback refs during the mutation phase, so it
runs on every viewer close.

## Conventions

- **URL is the source of truth** where it can be: routes, and the open photo is `?photo=<id>`.
  Reloading with a photo open reopens that photo.
- **Server data via TanStack Query.** Library + status poll every 5 s.
- **Authed media** can't send headers from `<img>`/`<video>`, so it goes through the blob LRU cache
  ([`lib/blobCache.ts`](src/lib/blobCache.ts), with a priority queue for the open viewer) or a
  `?token=` query param.
- **Icons are raw 24 px SVG strings** (1.8 stroke) in [`lib/icons.tsx`](src/lib/icons.tsx), rendered
  via `<Svg html/>`. Never feed user data into that path.
- **Theming** is CSS variables under `html[data-theme]`; every colour must work in light *and* dark.
- All timestamps and labels are US English.

## Gotchas

- **Never use `requestAnimationFrame` or `IntersectionObserver` for scroll-critical logic.** Both
  are paused in embedded webviews, which silently freezes virtualization. Use timestamp-throttled
  scroll listeners. (Lazy *image* loading via IntersectionObserver is fine, that's `Tile.tsx`.)
- **Modals must lock scroll via `useScrollLock`**, not by toggling a class themselves.
  `overflow: hidden` alone makes the browser clamp `scrollY` to 0 and never restore it, and it also
  removes the scrollbar, which changes the grid's width and rebuilds every chunk. The hook saves
  and restores the offset and pads by a measured `--scroll-lock-gutter` so width stays identical.
- **Don't declare the same CSS selector twice.** A duplicate `.up-menu-item` rule once reset
  `display: flex` to `block`, silently killing a `gap` and welding icons to their labels.
