# trailbox-mvp

`trailbox-mvp` is a local-first debugging toolkit for Next.js apps.
It provides:
- local error and network event collection
- a local dashboard
- simple CLI-based setup

## Install (npm packages)

Install SDK packages in your Next.js project:

```bash
npm install trailbox-mvp-sdk-core trailbox-mvp-sdk-next
```

You do not need to clone this repository to use the product.

## Quick start (published CLI)

Run these commands in your target Next.js project root:

```bash
npx trailbox-mvp init
npx trailbox-mvp dev
```

`init` does:
- creates `.trailbox-mvp/config.json`
- creates `instrumentation.js` and `instrumentation-client.ts` if missing
- safely integrates with existing `next.config.*` by creating `next.config.trailbox-mvp.*`
- patches `next dev/build/start` scripts to use the wrapper config
- adds `.trailbox-mvp/` to `.gitignore`

`dev` does:
- starts local agent (`127.0.0.1:7465`)
- starts local dashboard (`127.0.0.1:7466`)
- auto-detects your Next runtime from project settings (`package.json`, `next.config.*`, `.env*`)

## Doctor command

```bash
npx trailbox-mvp doctor
```

Expected checks:
- agent health
- dashboard health
- detected Next app health (based on configured host/port)

## Network tracing support

`trailbox-mvp-sdk-core` captures:
- request metadata (method, URL, status, duration)
- request/response headers
- request/response bodies for `fetch` and `XMLHttpRequest`

Safety defaults:
- masks sensitive headers (`authorization`, `cookie`, etc.)
- masks sensitive tokens in query/body text
- truncates large payloads

## Published packages

- `trailbox-mvp` (CLI)
- `trailbox-mvp-sdk-core`
- `trailbox-mvp-sdk-next`
- `trailbox-mvp-protocol`
- `trailbox-mvp-storage`
- `trailbox-mvp-agent`
- `trailbox-mvp-dashboard`

## For maintainers (repository development)

If you are developing this monorepo itself:

```bash
npm install
npm run build:all
```

CI/CD files:
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
