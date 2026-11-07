# Contributing

Pull requests, bug reports and translation fixes are welcome. Nothing formal, but a few things will save us both time.

## Before you start

- Open an issue first for anything bigger than a typo or a small fix, so we don't build the same thing twice or in opposite directions.
- Read the relevant note in [`docs/decisions`](docs/decisions). Sensors, the message bridge, permissions and anything that touches the network have hard rules there. They exist for a reason, and breaking them usually means the change won't be merged.
- No new dependencies without a discussion. The extension ships almost no runtime code from outside, and I'd like to keep it that way.

## Setup

You need Node 24 and pnpm 10.

```bash
pnpm install --frozen-lockfile
node scripts/build-production.mjs --browser chrome     # or: --browser firefox / --browser all
```

The built extension lands in `dist/chrome` (or `dist/firefox`). In Chrome open `chrome://extensions`, switch on developer mode and load that folder unpacked.

## Checks

```bash
node scripts/lint.mjs
node scripts/build.mjs --profile local                 # once: audit.test.mjs reads dist/local
node --test scripts/test/*.test.mjs scripts/production/test/*.test.mjs
npx vitest run --config vitest.config.ts
npx tsc -p tsconfig.json
```

Before `node --test`, run `node scripts/build.mjs --profile local` once: `scripts/test/audit.test.mjs` needs the `dist/local` manifest that this legacy build produces.

The `*-native.mjs` scripts in `scripts/test` start a real browser; run the ones that match what you changed (`node scripts/run-natives.mjs --list` shows the plan). Playwright and a Firefox install are needed for those.

## Code style

- ESM everywhere, plain and readable; comments in English and short.
- Tests next to behavior changes. A test that cannot fail is not a test: break the code on purpose once and watch it go red.
- UI strings live in the locale tables (21 languages). If you add one, add English and Russian by hand; others can be rough, someone will fix them.
- Don't wrap or "fix" page APIs in ways that change their results unless that is the explicit point of the feature (Antidetect). The Detector only watches.

## Translations

Native speakers are very welcome. If a string reads wrong in your language, open an issue or a PR against the locale tables; the notes in `docs/translations.md` list the places I'm least sure about.

## Reporting security problems

Please don't open a public issue. Use [private security advisories](https://github.com/vektort13/Detect.Expert/security/advisories/new).
