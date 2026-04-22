# Political Report Card

Political Report Card is a static, map-first political transparency site for Indian state elections. This first phase establishes the repo scaffold, typed JSON schemas, Tamil Nadu seed data, and a GitHub Pages deploy path.

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
- `data/schemas/*.json`: draft-07 public JSON schemas

Every record exposes `_meta.sources[]` with `url`, `name`, and `retrieved_at`.

## Contribution guide

- Keep all public data as JSON under `data/`.
- Keep any scraping, entity tagging, or LLM usage inside `pipelines/` only.
- Do not add request-time AI calls, a backend, or a database.
- Respect ADR and ECI attribution requirements in the footer as new data sources are added.
- Validate constituency numbering against official ECI records before updating election-facing seed data.

## Phase-1 status

Implemented now:

- Repo scaffold and architecture docs
- Tamil Nadu hello-world pages for `/`, `/state/TN`, and `/constituency/TN-177`
- Seed data for 5 constituencies and current MLAs
- GitHub Actions CI and GitHub Pages deployment

Deferred by design:

- News ingestion
- Affidavit scraping
- Manifesto tracker logic
