<!-- Thanks for contributing to Nook Photos! -->

## What & why

<!-- What does this PR do, and why? Link any related issue: "Closes #123". -->

## Type of change

- [ ] 🐛 Bug fix
- [ ] ✨ Feature
- [ ] 📖 Docs
- [ ] ♻️ Refactor / chore

## Affected areas

- [ ] Mobile (`apps/mobile`)
- [ ] Web (`apps/web`)
- [ ] Gateway (`apps/server`)
- [ ] Origin / API (`apps/origin`)
- [ ] Shared core (`packages/core`)

## Checklist

- [ ] Typecheck passes for every package I touched (`tsc -p tsconfig.json --noEmit`)
- [ ] The web app still builds (`cd apps/web && npx vite build`), if relevant
- [ ] `node --check apps/origin/server.js` passes, if I touched the origin
- [ ] I did **not** add npm dependencies to `apps/origin/server.js` (it stays zero-dependency)
- [ ] I tested the change (note how below)
- [ ] Docs/README updated if behavior changed

## How I tested

<!-- Steps, devices/browsers, screenshots or a short clip if it's a UI change. -->
