# Contributing / 参与贡献 / Contribuir

Everyone is welcome. You can [prepare an email draft](mailto:contact@monkeyai.online?subject=MonkeyAI%20Community%20tool%20suggestion) to suggest an AI tool, report a website problem, improve documentation or translation, or open a pull request. English, Chinese and Spanish contributions are welcome; it is fine to start in the language you know. The mailto link only prepares a draft in your mail app. Nothing is delivered until you send it.

## Suggest an AI tool

Public tool suggestions and other contact go to contact@monkeyai.online. You do not need a GitHub account. Opening a mailto link only prepares a draft; it is not delivered until you send it, and sending it does not reserve a queue place or a featured slot. Include the project name, official website or repository, what it does, who it helps, the limits you know, and official sources for any claims. If a limit is unknown, write that it is unknown. Tell us if you maintain or are otherwise connected to the project. We review relevance, working links, safety, originality and accuracy; sending a message does not guarantee a listing. Do not include API keys, private access links, undisclosed referral codes, or unnecessary personal data.

People who already use this repository can still open the [tool suggestion issue](https://github.com/ct-jaryn/monkeyai-community/issues/new?template=tool-suggestion.yml). Code changes stay on pull requests.

A complete listing normally needs a unique slug and category in `src/data/tools.json`, accurate English/Chinese/Spanish descriptions, and a sourced, appropriately reusable logo in `public/logos/`, `src/data/logos.json` and `docs/logo-sources.json`. Include the source and SHA-256 of a new asset. See `THIRD_PARTY.md`; do not upload third-party assets if their use is not permitted. Maintainers can help with translations and review.

### Who can use the free queue

An AI tool from a small company, a startup, or an independent developer can apply for free review by emailing contact@monkeyai.online. Review follows queue order, with no fixed date and no guarantee of approval. A GitHub account is not required. A product from a large or well-known company is not eligible for free review and needs a paid listing. A non-AI tool, including a generic utility or a video or image downloader, is not eligible for that queue either and needs a paid listing. The minimum is Express at $7. A labelled home-page feature is $15 for 30 days. An approved listing may also be listed on our related sister directories. Price, refunds, timing, and what a payment does not buy follow the current sponsor terms: <https://globalaiproductindex.com/sponsors/#express-listing>.

Listing pages describe purpose and limits honestly. If a limit is unknown, write that it is unknown. This community does not own, operate, or endorse the third-party product. Visitors judge legality, copyright, platform terms, privacy, and security themselves. A paid placement must be labelled Sponsored. These rules do not claim to remove legal responsibility.

The public mailto link only prepares a draft. It is not delivered until you send it, and it does not reserve a queue place or a featured slot. Do not add a separate intake form for this.

## Report a problem

Search existing issues first. Use the website issue form and include the affected public URL, a short reproduction, expected and actual behavior, and browser details where useful. Product bugs in MonkeyAI itself belong in the [upstream tracker](https://github.com/chaitin/MonkeyCode/issues). Do not post secrets, access tokens, credentials, personal information, server details, private logs or screenshots containing them. Use the private process in `SECURITY.md` for security vulnerabilities.

## Make a pull request

1. Fork this repository and create a branch for your change.
2. Use Node.js 20 or later and Python 3. No npm install is required.
3. Change the relevant source under `src/`, `public/`, or `scripts/`. For factual changes, cite primary sources and update all affected languages where possible; explain gaps.
4. Run `npm run build` and `npm run check` in a clean checkout. **Build clears `dist/` and regenerates `route-manifest.json`; back up any local-only data in those paths first.** Run `npm run dev` for a local preview.
5. Open a PR describing the user-visible change, source links, and checks run. Include screenshots for visual changes when useful, with any personal data removed. Be responsive to review and do not claim tests were run if they were not.

Credentials, API tokens, zone identifiers, server operations, and private reports are maintained separately and should never be included in a PR. The public Workers static-asset files belong in `deploy/cloudflare-workers/` and must not contain secrets.

## 社区与上游 / Comunidad y proyecto original

本站是独立社区。网站、导航工具、推荐 GitHub 仓库和本社区文档的问题请提交到本仓库；MonkeyAI 产品本身的问题请提交到上游。欢迎用中文提交 Issue 或 PR，维护者可协助完善翻译。

小公司、初创团队和独立开发者的 AI 工具可以申请免费审核，请发到 contact@monkeyai.online，不需要 GitHub 账号。审核按队列顺序进行，没有固定日期，也不保证通过。大型或知名公司的产品不能申请免费审核，必须付费收录；非 AI 工具也必须付费收录，最低为 Express 7 美元。带标注的首页推荐为 15 美元 / 30 天。通过的收录可能会被列入我们的相关姐妹目录。价格、退款和档期以赞助页当前条款为准：<https://globalaiproductindex.com/sponsors/#express-listing>。收录页要如实写明用途和已知限制，未知就写未知。本社区不拥有、不运营、也不背书第三方产品；合法性、版权、平台条款、隐私和安全由访客自行判断。付费展示必须标注 Sponsored（赞助）。这些说明并不声称能绝对免除法律责任。mailto 只准备一封草稿，在你发送之前并不会送达，也不保留档期。代码修改仍请使用 Pull Request。

Este es un sitio comunitario independiente. Propón herramientas, repositorios y correcciones de este sitio aquí; los problemas del producto MonkeyAI deben ir al proyecto original. Puedes contribuir en español y pedir ayuda con las traducciones.

Las herramientas de IA de empresas pequeñas, startups y desarrolladores independientes pueden solicitar la revisión gratuita, escribiendo a contact@monkeyai.online; no hace falta una cuenta de GitHub. La revisión sigue el orden de la cola, sin fecha fija y sin garantía de aprobación. Un producto de una empresa grande o conocida no puede optar a la revisión gratuita y necesita una ficha de pago. Una herramienta que no es de IA también necesita una ficha de pago, desde Express a 7 USD. Una recomendación etiquetada en la portada cuesta 15 USD por 30 días. Una ficha aprobada puede figurar también en nuestros directorios hermanos relacionados. El precio, los reembolsos y el plazo siguen las condiciones vigentes: <https://globalaiproductindex.com/sponsors/#express-listing>. La ficha debe decir con honestidad para qué sirve y qué límites se conocen; si un límite es desconocido, se dice. Esta comunidad no posee, no opera ni respalda el producto de terceros. Quien visita juzga la legalidad, los derechos de autor, las condiciones de la plataforma, la privacidad y la seguridad. Un espacio de pago se marca como Sponsored. Estas reglas no pretenden eliminar la responsabilidad legal. El enlace mailto solo prepara un borrador: no se entrega hasta que lo envías y no reserva un lugar. Los cambios de código siguen en pull requests.
