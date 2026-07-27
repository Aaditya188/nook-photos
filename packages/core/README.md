# `packages/core`, shared client library

Framework-agnostic TypeScript shared by **both** clients (`apps/web` and `apps/mobile`). If logic
would otherwise be written twice, it belongs here.

## The one rule

**No DOM and no Expo imports.** This package is consumed by React DOM *and* React Native, so
anything platform-specific is injected rather than imported:

```ts
// storage is injected, localStorage on web, SecureStore on mobile
const client = new NookClient({ baseUrl, storage });
```

Breaking this rule doesn't fail here, it fails later, in whichever client can't resolve the import.

## What's inside

```
src/api/client.ts     NookClient, one typed method per server endpoint
src/api/types.ts      PhotoRecord, AlbumRecord, StatusRecord, …
src/hooks/            TanStack Query hooks over the client
src/lib/              trips clustering, formatting, date grouping, helpers
src/theme/            MD3 design tokens shared by both clients
src/index.ts          barrel export
```

## Adding a server endpoint

1. Add or update the type in [`src/api/types.ts`](src/api/types.ts).
2. Add one method to [`src/api/client.ts`](src/api/client.ts) returning `this.request<T>(…)`.
3. Export it from the barrel if callers need the type.
4. Both clients pick it up, no per-app duplication.

Keep `NookClient` a thin, honest mirror of the HTTP API: one method per endpoint, no business logic,
no caching. Caching is the hooks' job; policy is the app's job.

## Typechecking

```bash
cd packages/core && ../../apps/web/node_modules/.bin/tsc -p tsconfig.json
```

Note that `apps/web`'s build typechecks every file in here as part of its own program, so the web
build is the check that actually gates CI. This package's own `tsconfig.json` is stricter (it enables
`noUncheckedIndexedAccess` via `tsconfig.base.json`) and currently reports pre-existing errors in
`src/lib/trips.ts` that the web build does not; nothing invokes it, so it is informational.

## Gotchas

- **Vectors and IDs are server-owned.** Don't synthesise photo or person IDs client-side; they come
  from the origin and are used as cache keys and filesystem names.
- **`library()` is unpaginated**: it returns every non-deleted photo in one response. Fine at
  ~10k photos, but be aware before adding a caller that runs on every keystroke.
