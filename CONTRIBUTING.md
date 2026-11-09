# Contributing / 参与贡献 / Contribuir

Everyone is welcome. You can [suggest an AI tool or GitHub repository](https://github.com/ct-jaryn/monkeyai-community/issues/new?template=tool-suggestion.yml), report a website problem, improve documentation or translation, or open a pull request. English, Chinese and Spanish contributions are welcome; it is fine to start in the language you know.

## Suggest an AI tool or GitHub repository

Open the tool suggestion form with the project name, official website or repository, what it does, who it helps, and official sources for any claims. Both open-source projects and other useful AI tools may be suggested. Tell us if you maintain or are otherwise connected to the project. We review relevance, working links, safety, originality and accuracy; submitting a suggestion does not guarantee a listing. Do not post API keys, private access links, referral codes without disclosure, private contact details or personal data.

A complete listing normally needs a unique slug and category in `src/data/tools.json`, accurate English/Chinese/Spanish descriptions, and a sourced, appropriately reusable logo in `public/logos/`, `src/data/logos.json` and `docs/logo-sources.json`. Include the source and SHA-256 of a new asset. See `THIRD_PARTY.md`; do not upload third-party assets if their use is not permitted. Maintainers can help with translations and review.

## Report a problem

Search existing issues first. Use the website issue form and include the affected public URL, a short reproduction, expected and actual behavior, and browser details where useful. Product bugs in MonkeyAI itself belong in the [upstream tracker](https://github.com/chaitin/MonkeyCode/issues). Do not post secrets, access tokens, credentials, personal information, server details, private logs or screenshots containing them. Use the private process in `SECURITY.md` for security vulnerabilities.

## Make a pull request

1. Fork this repository and create a branch for your change.
2. Use Node.js 20 or later and Python 3. No npm install is required.
3. Change the relevant source under `src/`, `public/`, or `scripts/`. For factual changes, cite primary sources and update all affected languages where possible; explain gaps.
4. Run `npm run build` and `npm run check` in a clean checkout. **Build clears `dist/` and regenerates `route-manifest.json`; back up any local-only data in those paths first.** Run `npm run dev` for a local preview.
5. Open a PR describing the user-visible change, source links, and checks run. Include screenshots for visual changes when useful, with any personal data removed. Be responsive to review and do not claim tests were run if they were not.

The canonical site, Cloudflare configuration, server operations, credentials and private reports are maintained separately and should never be included in a PR.

## 社区与上游 / Comunidad y proyecto original

本站是独立社区。网站、导航工具、推荐 GitHub 仓库和本社区文档的问题请提交到本仓库；MonkeyAI 产品本身的问题请提交到上游。欢迎用中文提交 Issue 或 PR，维护者可协助完善翻译。

Este es un sitio comunitario independiente. Propón herramientas, repositorios y correcciones de este sitio aquí; los problemas del producto MonkeyAI deben ir al proyecto original. Puedes contribuir en español y pedir ayuda con las traducciones.
