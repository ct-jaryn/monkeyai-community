# MonkeyAI Community

[![Build and check](https://github.com/ct-jaryn/monkeyai-community/actions/workflows/check.yml/badge.svg)](https://github.com/ct-jaryn/monkeyai-community/actions/workflows/check.yml)

An independent, multilingual community for practical MonkeyAI guides, AI tools and model discovery. Explore the website at [monkeyai.online](https://monkeyai.online/). English, 简体中文 and Español are available.

**Everyone is welcome to help maintain the site.** Suggest an AI tool or a GitHub repository, report a problem, improve a guide or translation, or open a pull request:

- [Prepare an email draft for a tool suggestion](mailto:contact@monkeyai.online?subject=MonkeyAI%20Community%20tool%20suggestion) (this opens a draft; it is not delivered until you send it)
- [Report a website issue](https://github.com/ct-jaryn/monkeyai-community/issues/new?template=bug-report.yml)
- [Browse issues](https://github.com/ct-jaryn/monkeyai-community/issues) and [pull requests](https://github.com/ct-jaryn/monkeyai-community/pulls)
- Read [CONTRIBUTING.md](CONTRIBUTING.md), [community conduct](CODE_OF_CONDUCT.md), and the [security policy](SECURITY.md)

欢迎推荐 AI 工具和 GitHub 仓库，也欢迎提交 Issue、PR、文档与翻译。Puedes proponer herramientas y repositorios, informar de problemas y mejorar el sitio en español.

Only an AI tool can join the free review queue by emailing contact@monkeyai.online. A GitHub account is not required. A non-AI tool needs a paid listing, starting at Express for $7. A labelled home-page feature is $15 for 30 days. Current price, refund, and placement terms are on the [sponsor page](https://globalaiproductindex.com/sponsors/#express-listing). Tool pages state what a tool is for and the limits known from review, or say that a limit is unknown. This site does not own, operate, or endorse third-party products. Visitors judge legality, copyright, platform terms, privacy, and security. Paid placements are labelled Sponsored. These notes do not claim to remove legal responsibility. The mailto link only prepares a draft and nothing is delivered until you send it. Code changes still use pull requests.

只有 AI 工具可以免费排队审核，请发到 contact@monkeyai.online，不需要 GitHub 账号。非 AI 工具最低为 Express 7 美元，首页推荐 15 美元 / 30 天，以赞助页当前条款为准。工具页写明用途和已知限制；未知就写未知。本站不拥有、不运营、不背书第三方产品。访客自行判断合法性、版权、平台条款、隐私和安全。赞助展示会标注。这些说明并不声称能绝对免除法律责任。mailto 只准备一封草稿，在你发送之前并不会送达。代码修改仍请使用 Pull Request。

Solo las herramientas de IA entran en la cola gratuita escribiendo a contact@monkeyai.online, sin cuenta de GitHub. Las demás requieren una ficha de pago, desde Express a 7 USD, y la portada etiquetada cuesta 15 USD por 30 días, según las condiciones vigentes. Cada ficha dice el uso y los límites conocidos, o que son desconocidos. Este sitio no posee, no opera ni respalda productos de terceros. Quien visita juzga legalidad, derechos de autor, condiciones, privacidad y seguridad. Lo pagado se marca como Sponsored. Estas notas no eliminan la responsabilidad legal. El enlace mailto solo prepara un borrador y no se entrega hasta que lo envías. Los cambios de código siguen en pull requests.

This is an enthusiast community, independent of Chaitin and the upstream [MonkeyCode](https://github.com/chaitin/MonkeyCode) project. Product issues belong in the upstream tracker; this repository maintains the community website and directory. A listing or contribution does not imply endorsement by the original project or its maintainers.

## Run locally

Requires Node.js 20+ and Python 3. There are no npm dependencies to install.

```sh
npm run build
npm run check
npm run dev
```

Open `http://127.0.0.1:4173/`. Build generates static output in `dist/` and `route-manifest.json`. **It clears `dist/` on every build:** work in a clean checkout and back up any local-only files there first. The preview server handles directory URLs and missing pages.

Search-engine verification values are optional. For a deployment that needs them, provide `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` as environment variables, or use an ignored `site.config.local.json` on your own machine. Do not commit local settings or credentials. The public Workers static-asset files for the live site are in `deploy/cloudflare-workers/`. Zone credentials, tokens, and account data are not stored in this repository.

## Project layout

| Path | Purpose |
| --- | --- |
| `site.config.json` | Site origin, upstream and community repository links |
| `src/i18n.mjs`, `src/community-ui.mjs` | English, Chinese and Spanish interface text |
| `src/data/tools.json`, `src/data/logos.json` | Tool listings and logo metadata |
| `src/data/guides.json`, `src/data/docs-*.json` | Community guides and their translations |
| `src/data/models-*.json` | Sourced model-family profiles |
| `src/*-pages.mjs`, `scripts/build.mjs` | Static page templates and generator |
| `public/` | Styles, browser interactions, fonts and attributed assets |
| `scripts/check*.mjs` | Site and robots validation |
| `deploy/cloudflare-workers/` | Live Workers static-asset config. No zone credentials or tokens. |
| `docs/logo-sources.json`, `docs/research/` | Asset provenance and source research |

## Privacy, licensing and safety

The site has no account system. Saved tools use browser localStorage and search runs locally. The hosting provider may process request logs or provide analytics; see the live site's About page. Never submit credentials, private URLs, personal data or confidential logs to this public repository.

Original repository contributions are available under the [MIT License](LICENSE). Third-party logos, trademarks and fonts have separate terms; see [THIRD_PARTY.md](THIRD_PARTY.md). Guides are independent summaries and do not replace the official documentation. Tool listings are reviewed and are not endorsements or paid rankings.
