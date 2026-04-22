# Political Report Card

Political Report Card is a static, map-first political transparency site for Indian state elections. The current MVP ships a national choropleth, state drilldowns, and constituency panels entirely from static JSON and optimized TopoJSON on GitHub Pages.

## Stack

- Astro with React islands
- TailwindCSS
- TypeScript
- Python 3.11 for future pipelines
- GitHub Actions
- Static JSON under `data/`

## Local setup

1. Install Node.js 20+ and npm.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `http://localhost:4321/`.

Useful commands:

- `npm run lint`
- `npm run format:check`
- `npm run validate:data`
- `npm run check`
- `npm run build`
- `npm run lhci`

## GitHub bootstrap

Create an empty GitHub repository in the browser first, then connect this folder:

```powershell
git init
git branch -M main
git remote add origin https://github.com/<your-account>/political-report-card.git
git add .
git commit -m "Initial scaffold for Political Report Card"
git push -u origin main
```

After the first push, enable GitHub Pages to use GitHub Actions in the repository settings.

## Data model

- `data/states/*.json`: state-level entry points and theme metadata
- `data/constituencies/<STATE>/*.json`: constituency cards keyed by state and seat number
- `data/candidates/*.json`: current MLA records tied to seeded constituencies
- `data/parties/*.json`: party directory stubs used by the cards
- `data/navigation/states.json`: generated state navigation records for the national map
- `data/elections/state-election-status.json`: generated official-schedule records for the choropleth
- `data/maps/constituencies.json`: generated TN and WB constituency navigation index
- `data/geo/source/`: committed Datameet source snapshot
- `data/geo/optimized/`: simplified and quantized TopoJSON served to the client
- `data/schemas/*.json`: draft-07 public JSON schemas

Every record exposes `_meta.sources[]` with `url`, `name`, and `retrieved_at`.

## Contribution guide

- Keep all public data as JSON under `data/`.
- Keep any scraping, entity tagging, or LLM usage inside `pipelines/` only.
- Do not add request-time AI calls, a backend, or a database.
- Respect ADR and ECI attribution requirements in the footer as new data sources are added.
- Validate constituency numbering against official ECI records before updating election-facing seed data.
- Keep URLs lowercase when adding routes or links.
- Preserve the `build:geo` and homepage budget checks when touching geometry or map bundles.

## MVP status

Implemented now:

- Repo scaffold, architecture docs, and GitHub Pages deploy path
- Lowercase national, state, and constituency routes with uppercase compatibility shims for the original TN links
- Datameet-derived national state boundaries plus TN and WB constituency geometry
- D3 + TopoJSON homepage choropleth with a list fallback if geometry loading fails
- TN and WB constituency drilldowns with zoom, pan, pinch-zoom, and seeded MLA overlays for 5 Tamil Nadu seats
- GitHub Actions CI with lint, format, `astro check`, build-time JS budget enforcement, and Lighthouse CI LCP checks

Deferred by design:

- News ingestion
- Affidavit scraping
- Manifesto tracker logic
