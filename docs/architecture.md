# Architecture

Political Report Card is a static GitHub Pages site. Astro handles static page generation, React islands are reserved for interactive map behavior, and all public data is persisted as JSON under the repository root `data/`.

## Repository shape

```text
repo/
├── .github/workflows/
│   ├── ci.yml
│   ├── deploy.yml
│   ├── news-ingest.yml
│   └── affidavits-refresh.yml
├── data/
│   ├── geo/india.topojson
│   ├── schemas/
│   ├── states/TN.json
│   ├── constituencies/TN/*.json
│   ├── candidates/*.json
│   ├── parties/*.json
│   ├── news/tagged/
│   └── manifestos/
├── docs/architecture.md
├── pipelines/
│   ├── scrape_affidavits.py
│   ├── ingest_rss.py
│   ├── tag_entities.py
│   └── build_indexes.py
├── scripts/
│   ├── sync-data.mjs
│   └── validate-data.mjs
├── src/
│   ├── components/Map/
│   ├── layouts/
│   ├── lib/
│   ├── pages/
│   │   ├── index.astro
│   │   ├── state/[code].astro
│   │   ├── constituency/[id].astro
│   │   ├── parties/index.astro
│   │   └── manifestos/index.astro
│   ├── styles/
│   └── types/
├── astro.config.mjs
├── package.json
└── README.md
```

## Notes

- The original conceptual tree used `src/app/...`; in Astro, the equivalent public routing surface lives under `src/pages/...`.
- Canonical JSON stays in the root `data/` directory. A small sync script mirrors it into `public/data/` before local dev, checks, and production builds so the site can fetch static JSON directly.
- React is only used for the interactive map island. The content pages themselves render statically from local JSON during build time.
- Pipeline scripts and non-deploy workflows are placeholders in phase 1 so the architecture is visible without implementing ingestion logic too early.
