# monkeyai.online on Cloudflare Workers Static Assets

Production Worker: `monkeyai-online-static` (zone routes `monkeyai.online/*`, `www.monkeyai.online/*`, managed in Cloudflare, not in this file).
Staging: `monkeyai-online-static-staging.jaryn1557.workers.dev` (noindex).

## Static-direct (2026-11-12)
- `run_worker_first` is `/*` minus `/`, `/*/` (canonical trailing-slash pages) and static file types
  (`/assets/*`, css, js, png, svg, ttf, woff2, json, xml, txt). Those are served by the assets layer with
  no Worker invocation (free, not counted against the daily Workers request limit).
- `worker.js` still runs for slashless paths (assets 307 -> 301), `/dir/index.html` (200), `/404.html` (404),
  dotfiles (403) and `/.well-known/acme-challenge/*` (origin passthrough).
- `_headers` reproduces the Worker's headers for asset-first responses: nosniff, Referrer-Policy,
  Cache-Control (images/fonts 86400, css/js/txt 14400, else no-cache), UTF-8 charset, workers.dev noindex.
- http -> https and www -> apex 301 are done by a zone Single Redirect rule (Rules > Redirect Rules,
  phase `http_request_dynamic_redirect`), which excludes `/.well-known/acme-challenge/*`.
  The Worker keeps its own redirect code as a fallback.
- Known difference: unknown trailing-slash paths (`/x/`) get the 404 page with `Cache-Control: no-cache`
  (the Worker sent `no-store`).

## Deploy
Only the apex home page gets search-engine verification meta. `scripts/build.mjs` injects it when `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` are set in the environment, or in an ignored `site.config.local.json`. Do not commit those values. If a build was made without them, add the meta only to `dist/index.html` afterwards. `dist/` is gitignored.

```bash
npm run build && npm run check
cp deploy/cloudflare-workers/_headers dist/_headers   # the generator no longer writes _headers
cd deploy/cloudflare-workers && npx wrangler@4.160.0 deploy --config wrangler.jsonc --keep-vars
```
Rollback: `npx wrangler rollback <previous-version-id>`.
The zone Redirect Rule is not in this directory. Leave it in place when rolling the Worker back; `worker.js` still has the same redirect as a fallback.
