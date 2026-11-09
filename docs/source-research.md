# Upstream source notes

Reviewed on **2026-10-27 (Asia/Shanghai)** for the independent MonkeyAI Community international site.

## Identity and provenance

- Official repository: [chaitin/MonkeyCode](https://github.com/chaitin/MonkeyCode).
- Chinese product site: [work.baizhi.cloud](https://work.baizhi.cloud/).
- Chinese product documentation: [work.docs.baizhi.cloud](https://work.docs.baizhi.cloud/).
- Deployment and operations reference: [monkeyai/README.md](https://github.com/chaitin/MonkeyCode/blob/main/monkeyai/README.md).
- Repository license: [LICENSE](https://github.com/chaitin/MonkeyCode/blob/main/LICENSE).
- Product issue tracker: [upstream issues](https://github.com/chaitin/MonkeyCode/issues).

The official repository links both supplied reference sites. Its README names the product **百智办公 · MonkeyAI**. The repository's historical name is MonkeyCode. This community site is independently authored and must not imply official ownership, support, endorsement, or a separate upstream software distribution.

## Verified product facts

The reviewed repository and product site describe a team AI workspace for office, coding, and design work. Office examples include presentations, documents, spreadsheets, and file organization. Coding examples include architecture, code generation, and fixes. Creative examples include posters and interface design. Teams can share models, knowledge bases, skills, experts, MCP connectors, and rules; administrator capabilities cover access, usage audit/statistics, and resource billing.

The upstream repository identifies its license as AGPL-3.0. This is a statement of the repository's declared license, not legal advice or a claim that third-party assets share the same license.

## Verified connection and platform details

The README instructs demo desktop users to connect to `https://demo.work.baizhi.cloud/` and sign in using an emailed verification code. At review time, download links existed for Windows x64, macOS Apple Silicon, macOS Intel, and Linux x64. Android, iOS, Linux ARM64, and HarmonyOS desktop were listed as forthcoming. Downloads should link through the official product page rather than freezing versioned installer URLs in community content.

Platform support, demo access, versions, and plan entitlements can change. The guides therefore direct readers to upstream for current builds and do not copy product pricing, live star counts, competitor comparisons, or service promises.

## Verified deployment boundaries

The main README describes a lightweight starting configuration of one CPU core and 1 GB of memory. It does not establish a capacity guarantee for every workload.

The source-based operations README documents copying `.env.example` to `.env`, setting database and initial administrator passwords, and using `docker compose up --build` inside the repository's `monkeyai` directory. It gives `http://localhost:8080` as the initial address and documents `MONKEYAI_PUBLIC_URL` for the externally used address, with HTTPS recommended for production.

That operations reference also documents persistent runtime identity state in the `runtime` volume and, when automatic TLS is enabled, certificate/ACME state in the `acme` volume. Maintenance that removes volumes may destroy state. The community deployment guide does not execute commands or claim installation verification.

The product FAQ expressly distinguishes server data ownership from external service processing: configured outside models and tools may receive relevant task content. Do not promise that self-hosting keeps every operation offline or every piece of data within one server.

## Documentation structure and limits

The help site's visible top-level navigation is:

- Getting started / 开始使用
- Core capabilities / 核心能力
- Team administrator configuration / 团队管理员配置
- Advanced tutorials / 进阶教程

Direct section URLs observed:

- [Getting started](https://work.docs.baizhi.cloud/node/01a14440-770b-76fc-894d-028d7a10544b)
- [Core capabilities](https://work.docs.baizhi.cloud/node/01a14442-4624-7c76-891e-f085de6b953c)
- [Team administrator configuration](https://work.docs.baizhi.cloud/node/01a14442-6c77-7072-8a8b-193d38158098)
- [Advanced tutorials](https://work.docs.baizhi.cloud/node/01a167cb-3a29-7041-81c2-9c177a61404c)

Public web extraction returned the documentation shell and navigation but not complete article bodies. It is therefore insufficient evidence for a claim that the complete Chinese manual has been translated. The five guides in `src/data/guides.json` are original community explanations, available in English, Simplified Chinese, and Spanish, with their own source links. They avoid inventing current interface field names or provider compatibility.

## Collection conditions and verification scope

Collection used the web browsing service; its egress region was not supplied. Initial direct URL attempts failed, while following the verified links from the official GitHub page returned the product site and documentation shell. A sandbox-local `curl` attempt failed at DNS resolution. These observations do not prove any geographic access policy or US/EU user availability.

Research establishes source attribution and the facts above. It does not establish successful deployment, actual model/connector execution, account access, third-party tool compatibility, search indexing, SEO rankings, or AI citation performance.

## Editorial choices

- English is the international default, with Chinese and Spanish help content.
- Use independently written task examples and review checklists rather than copied official marketing copy.
- Keep the community identity visible and direct product issues to upstream.
- Keep code names, URLs, and environment variables stable across translations.
- Treat AI output as something to inspect, especially numbers, generated code, and consequential decisions.
- Do not fabricate community membership, events, endorsements, downloads, rankings, or product support guarantees.
