# Contributing to Nook Photos

Thanks for your interest in making Nook better! 🎉 Whether it's a bug report, a docs fix, or a feature, contributions of all sizes are welcome.

## Ways to contribute

- 🐛 **Report a bug**: open an issue with the Bug report template.
- 💡 **Suggest a feature**: open an issue with the Feature request template.
- 📖 **Improve docs**: typos, clearer setup steps, screenshots.
- 🔧 **Send a PR**: bug fixes and features (see below).

If you're planning a larger change, please open an issue first so we can align on the approach before you invest time.

## Development setup

**Prerequisites:** Node 20+, npm 10+. For the mobile app: [Expo Go](https://expo.dev/go) (or a dev build). The optional AI indexer needs Python 3.11+.

```bash
git clone https://github.com/Aaditya188/nook-photos.git
cd nook-photos
npm install            # workspaces hoist everything; @nook/core is symlinked into the apps
```

Run the stack (see the [README](README.md#quick-start) for details):

```bash
cd apps/origin && node server.js          # origin (photo store)  :8080
npm run build -w @nook/web                 # build the dashboard once
cd apps/server && ../../node_modules/.bin/tsx src/index.ts   # gateway :8090 → open http://localhost:8090
cd apps/web && npx vite                     # web dev with hot reload :5173
cd apps/mobile && npx expo start            # mobile in Expo Go
```

## Project layout

An npm-workspaces monorepo, see the [README table](README.md#whats-in-the-repo). In short:

| Path | What |
|---|---|
| `packages/core` | Shared TS: API client, types, hooks, theme. No DOM/Expo imports. |
| `apps/web` | React 19 + Vite dashboard. |
| `apps/mobile` | Expo (SDK 54) iOS/Android app. |
| `apps/server` | Fastify + sharp performance gateway. |
| `apps/origin` | Zero-dependency Node photo store + optional Python AI indexer. |

## Before you open a PR

Please make sure your change passes the same checks CI runs:

```bash
# Typecheck each package you touched:
cd packages/core && npx tsc -p tsconfig.json --noEmit
cd apps/web      && npx tsc -p tsconfig.json --noEmit
cd apps/mobile   && npx tsc -p tsconfig.json --noEmit
cd apps/server   && npx tsc -p tsconfig.json --noEmit

# The web app must still build:
cd apps/web && npx vite build

# The origin server must stay valid vanilla Node:
node --check apps/origin/server.js
```

## Guidelines

- **Branch off `master`**, and target your PR at `master`. CI (typecheck + build) must be green.
- **Match the surrounding style.** The codebase favors small, well-commented modules; keep comments about the *why*.
- **`apps/origin/server.js` is deliberately dependency-free vanilla Node**: do not add npm dependencies to the origin photo store. Its zero-supply-chain property is a feature.
- **Shared logic goes in `packages/core`** so web and mobile stay in sync; `core` must not import DOM or Expo APIs (platform bits are injected).
- **Keep it private-by-default.** Nook never phones home; don't add analytics, telemetry, or third-party network calls without discussion.
- Write clear, imperative commit messages (e.g., "mobile: fix login form hidden behind keyboard").

## Reporting security issues

Please **do not** open a public issue for security vulnerabilities. Instead, report them privately to the maintainer (see the profile on the repo). We'll coordinate a fix and disclosure.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
