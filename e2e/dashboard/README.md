# Dashboard Playwright suite

## Run

    # 1. Start the dashboard dev server (in another terminal):
    pnpm --filter @hipp0/dashboard dev

    # 2. In e2e/dashboard:
    npm install
    npx playwright install chromium  # one-time
    npx playwright test

Or with auto-start:

    E2E_AUTO_START_DASHBOARD=1 npx playwright test

## Tests

- `01-app-boots.spec.ts` - app loads without console errors
- `02-navigation.spec.ts` - every link navigates without 5xx
- `03-playground.spec.ts` - Super Brain playground accepts input (skips if route absent)
- `04-screenshots.spec.ts` - visual regression snapshots to ./screenshots/

## Notes on the dashboard routing model

The dashboard is a single-page Vite/React app. It does NOT use React Router.
Navigation is driven by the URL hash (e.g. `#chat`, `#graph`, `#search`,
`#playground`) plus a dedicated path `/playground` for public, pre-auth access
to the Super Brain playground. The navigation test visits both path- and
hash-style links.

## Known caveats

- Playwright requires browser binaries installed via `npx playwright install chromium`. CI must install them.
- The playground path is guessed across several candidates. If the real path is different, update `03-playground.spec.ts`.
- The default dashboard boot may land on a login screen. The playground path bypasses auth; other routes may require a seeded session.
