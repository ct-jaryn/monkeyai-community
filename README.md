# MonkeyAI Community

[![Build and check](https://github.com/ct-jaryn/monkeyai-community/actions/workflows/check.yml/badge.svg)](https://github.com/ct-jaryn/monkeyai-community/actions/workflows/check.yml)

An independent, multilingual community for practical MonkeyAI guides, AI tools and model discovery. Explore the website at [monkeyai.online](https://monkeyai.online/). English, 简体中文 and Español are available.

## Overview

This repository holds the source of the community website: a static, dependency-free site generator plus the English, Chinese and Spanish content behind it. It publishes practical guides, a tool directory, sourced model-family profiles and community pages, and it documents how listings are reviewed so that a listing reads as a reviewed record rather than an advertisement.

- **Live:** https://monkeyai.online/
- **Stack:** Node.js static generator (`scripts/build.mjs`), no npm dependencies, no runtime framework
- **Deploy:** Cloudflare Workers static assets (`deploy/cloudflare-workers/`)
- **Languages:** `en`, `zh`, `es`

This is an enthusiast community, independent of Chaitin and the upstream [MonkeyCode](https://github.com/chaitin/MonkeyCode) project. Product issues belong in the upstream tracker; this repository maintains the community website and directory. A listing or contribution does not imply endorsement by the original project or its maintainers.

## Listing and sponsorship terms

These paragraphs are part of the published policy and are asserted by `scripts/check-community.mjs`; edit them in all three languages together.

AI tools from small companies, startups and independent developers can apply for free review by emailing contact@monkeyai.online. Review follows queue order, with no fixed date and no guarantee of approval. A GitHub account is not required. Products from large or well-known companies are not eligible for free review and need a paid listing, starting at Express for $7. Non-AI tools need the same paid listing. A labelled home-page feature is $15 for 30 days. An approved listing may also be listed on our related sister directories. Current price, refund, and placement terms are on the [sponsor page](https://globalaiproductindex.com/sponsors/#express-listing). Listing pages describe purpose and limits honestly, or say that a limit is unknown, and include a disclaimer. This site does not own, operate, or endorse third-party products. Visitors judge legality, copyright, platform terms, privacy, and security. Paid placements are labelled Sponsored. These notes do not claim to remove legal responsibility. The mailto link only prepares a draft and nothing is delivered until you send it. Code changes still use pull requests.

小公司、初创团队和独立开发者的 AI 工具可以申请免费审核，请发到 contact@monkeyai.online，不需要 GitHub 账号。审核按队列顺序进行，没有固定日期，也不保证通过。大型或知名公司的产品不能申请免费审核，必须付费收录；非 AI 工具也必须付费收录，最低为 Express 7 美元。首页推荐 15 美元 / 30 天。通过的收录可能会被列入我们的相关姐妹目录。价格、退款和展示以赞助页当前条款为准。收录页如实说明用途和已知限制；未知就写未知，并附有说明。本站不拥有、不运营、不背书第三方产品。访客自行判断合法性、版权、平台条款、隐私和安全。赞助展示会标注。这些说明并不声称能绝对免除法律责任。mailto 只准备一封草稿，在你发送之前并不会送达。代码修改仍请使用 Pull Request。

Las herramientas de IA de empresas pequeñas, startups y desarrolladores independientes pueden solicitar la revisión gratuita escribiendo a contact@monkeyai.online, sin cuenta de GitHub. La revisión sigue el orden de la cola, sin fecha fija y sin garantía de aprobación. Los productos de empresas grandes o conocidas no pueden optar a la revisión gratuita y necesitan una ficha de pago, desde Express a 7 USD. Las herramientas que no son de IA necesitan la misma ficha de pago. La portada etiquetada cuesta 15 USD por 30 días, según las condiciones vigentes. Una ficha aprobada puede figurar también en nuestros directorios hermanos relacionados. Cada ficha describe con honestidad el uso y los límites conocidos, o que son desconocidos, e incluye un aviso. Este sitio no posee, no opera ni respalda productos de terceros. Quien visita juzga legalidad, derechos de autor, condiciones, privacidad y seguridad. Lo pagado se marca como Sponsored. Estas notas no eliminan la responsabilidad legal. El enlace mailto solo prepara un borrador y no se entrega hasta que lo envías. Los cambios de código siguen en pull requests.

## Repository layout

| Path | Purpose |
| --- | --- |
| `site.config.json` | Site origin, upstream and community repository links |
| `src/i18n.mjs`, `src/community-ui.mjs` | English, Chinese and Spanish interface text |
| `src/data/tools.json`, `src/data/logos.json` | Tool listings and logo metadata |
| `src/data/guides.json`, `src/data/docs-*.json` | Community guides and their translations |
| `src/data/models-*.json` | Sourced model-family profiles |
| `src/*-pages.mjs`, `scripts/build.mjs` | Static page templates and generator |
| `public/` | Styles, browser interactions, fonts and attributed assets |
| `scripts/check*.mjs` | Site, search-behaviour and robots validation |
| `deploy/cloudflare-workers/` | Live Workers static-asset config. No zone credentials or tokens. |
| `docs/logo-sources.json`, `docs/research/` | Asset provenance and source research |

## Getting started

Requires Node.js 20+ and Python 3. There are no npm dependencies to install.

```sh
npm run build
npm run check
npm run dev
```

Open `http://127.0.0.1:4173/`. Build generates static output in `dist/` and `route-manifest.json`.

**The build clears `dist/` on every run:** work in a clean checkout and back up any local-only files there first. The preview server handles directory URLs and missing pages.

Search-engine verification values are optional. For a deployment that needs them, provide `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` as environment variables, or use an ignored `site.config.local.json` on your own machine. Do not commit local settings or credentials.

## Verification

| Command | What it checks |
| --- | --- |
| `npm run build` | Regenerates `dist/` and `route-manifest.json` from `src/` |
| `npm run check` | Runs the whole `scripts/check*.mjs` chain: site output, search behaviour, AI-robots, community links, language parity, Worker config and deploy config |
| `npm run check:browser` | Drives the built site in a throwaway Chrome profile: phone-width layout, 24 px minimum control height, search and keyboard flows, focus rings, mobile menu, language menu, print styles |

`scripts/check-search.mjs` runs the delivered browser script against a small DOM shim, so the search dialog and the guide-index filter are tested without installing a browser. It also fails when the client script reads an interface string that the page data does not carry. The same run compares the interface tables key by key across English, Chinese and Spanish, so a blank or missing translation is a failed check.

Fonts: the two woff2 files in `public/fonts` are Latin subsets of the DM Sans and Manrope variable families. `npm run check` fails when page text uses a character the subsets no longer cover (CJK and symbols such as ≠ render from system fonts). `python3 scripts/subset-fonts.py` reads `dist/` and rewrites both fonts with `docs/font-coverage.json`; it takes `--from DIR` with the full upstream files when new text needs a glyph that was cut.

`npm run check:browser` starts its own local server and a throwaway Chrome profile, then drives the site the way a visitor would. It also fails when a page fetches more than two font files or when weight 550 lays out exactly like 600, and when a tool card falls back to a PNG twin or the raster logos on `/tools/` exceed 20KB.

A local Chrome can render the built site without any automation server:

```sh
cd dist && python3 -m http.server 8797 --bind 127.0.0.1 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --user-data-dir=/tmp/mai-chrome \
  --window-size=1120,1100 --screenshot=/tmp/page.png \
  http://127.0.0.1:8797/docs/getting-started/
```

Headless Chrome refuses to lay out narrower than 500 CSS pixels from the command line, so the screenshot flag cannot reach phone widths; `npm run check:browser` overrides the viewport through the DevTools protocol instead.

## Maintainer status

Checked against `origin/main` on 2026-11-26.

- **Site:** an independent community guide for MonkeyAI (百智办公 in Chinese), plus a reviewed tool directory and sourced model-family profiles. English, simplified Chinese, and Spanish stay in parallel. It is not the product site and not a copy of a sister directory.
- **`origin/main`:** `dd3792b5d1fed0b834192acaef5970821431bc9d` (merge of pull request #9, 2026-11-26). That merge is the client-choice and SEO/GEO pass.
- **Production:** that merge is already on https://monkeyai.online/. The operator recorded the production publish as 2026-11-27. A fetch on 2026-11-26 17:56 UTC opened https://monkeyai.online/docs/choose-a-monkeyai-client/ and the page showed the guide reviewed 2026-11-26. Do not describe that content as waiting to be published.
- **This branch:** `cursor/seo-geo-readme-20261127-0a1c`, pull request [#10](https://github.com/ct-jaryn/monkeyai-community/pull/10). It adds the knowledge-base guide and corrects server sizing and installer ports from official pages fetched on 2026-11-26. It is not production. Opening the pull request does not deploy it.
- **Left untouched:** pull request #2 (`pranshuchittora:add-agent-qa-20261110`) and the zone Redirect Rules. Redirects for http to https and www to the apex stay in Cloudflare (Rules > Redirect Rules). This repository does not contain that rule; `worker.js` only keeps a fallback.

## Deployment

Preview locally with `npm run dev` and open `http://127.0.0.1:4173/`. The live site is Cloudflare Workers static assets. The Worker files are in `deploy/cloudflare-workers/`. Zone credentials, tokens, and account data are not stored in this repository. Staging, recorded there as `monkeyai-online-static-staging.jaryn1557.workers.dev`, is noindex. This repository does not document a second staging command.

`scripts/check-deploy.mjs` validates the deploy configuration as part of `npm run check`. The `Build and check` workflow (`.github/workflows/check.yml`) is manual only. It does not deploy, and a content change is not a reason to run it.

The production publish already used by this repository is:

```bash
npm run build && npm run check
cp deploy/cloudflare-workers/_headers dist/_headers   # the generator no longer writes _headers
cd deploy/cloudflare-workers && npx wrangler@4.160.0 deploy --config wrangler.jsonc --keep-vars
```

Rollback, when a deploy has already happened, is `npx wrangler rollback <previous-version-id>` from that same directory. Leave the zone Redirect Rule in place. Do not run the deploy from a content pull request.

## Privacy, licensing and safety

The site has no account system. Saved tools use browser localStorage and search runs locally. The hosting provider may process request logs or provide analytics; see the live site's About page. Never submit credentials, private URLs, personal data or confidential logs to this public repository.

## Contributing

**Everyone is welcome to help maintain the site.** Suggest an AI tool or a GitHub repository, report a problem, improve a guide or translation, or open a pull request:

- [Prepare an email draft for a tool suggestion](mailto:contact@monkeyai.online?subject=MonkeyAI%20Community%20tool%20suggestion) (this opens a draft; it is not delivered until you send it)
- [Report a website issue](https://github.com/ct-jaryn/monkeyai-community/issues/new?template=bug-report.yml)
- [Browse issues](https://github.com/ct-jaryn/monkeyai-community/issues) and [pull requests](https://github.com/ct-jaryn/monkeyai-community/pulls)
- Read [CONTRIBUTING.md](CONTRIBUTING.md), [community conduct](CODE_OF_CONDUCT.md), and the [security policy](SECURITY.md)

欢迎推荐 AI 工具和 GitHub 仓库，也欢迎提交 Issue、PR、文档与翻译。Puedes proponer herramientas y repositorios, informar de problemas y mejorar el sitio en español.

## License

Original repository contributions are available under the [MIT License](LICENSE). Third-party logos, trademarks and fonts have separate terms; see [THIRD_PARTY.md](THIRD_PARTY.md). Guides are independent summaries and do not replace the official documentation. Tool listings are reviewed and are not endorsements or paid rankings.
