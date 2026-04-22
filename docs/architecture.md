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
│   ├── geo/
│   │   ├── source/
│   │   ├── optimized/
│   │   └── README.md
│   ├── navigation/states.json
│   ├── elections/state-election-status.json
│   ├── maps/constituencies.json
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
│   ├── build-geo.mjs
│   ├── check-homepage-budget.mjs
│   ├── sync-data.mjs
│   └── validate-data.mjs
├── src/
│   ├── components/
│   │   └── Map/
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
- React is only used for the interactive map islands on `/`, `/state/[code]`, and `/constituency/[id]`. The rest of the page content renders statically from local JSON during build time.
- Lowercase URLs are canonical. Static compatibility shims preserve the already-shipped uppercase phase-1 links.
- `scripts/build-geo.mjs` is the geometry build gate. It regenerates the navigation indexes, simplifies and quantizes the committed Datameet source snapshot, and fails the build if the national or per-state TopoJSON budgets are exceeded.
- `scripts/check-homepage-budget.mjs` enforces the homepage JS gzip budget after build, and Lighthouse CI checks the homepage LCP budget in CI.
- Pipeline scripts and non-deploy workflows remain placeholders in this phase so the architecture is visible without implementing ingestion logic too early.
