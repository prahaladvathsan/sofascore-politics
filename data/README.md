# Data Directory

This repository keeps canonical political data under the root `data/` directory and mirrors it into the published static site during `npm run dev`, `npm run build`, and `npm run check`.

## Source conventions

- Every entity file uses `_meta.sources[]` with objects shaped as `{ "url", "name", "retrieved_at" }`.
- Tamil Nadu seed constituency numbering is cross-checked against the official Election Commission of India 2021 PDF before being committed.
- Incumbent MLA context in this phase cites Wikipedia pages as a lightweight seed source only.

## Static contract

- `data/schemas/` defines the draft-07 schemas for public JSON payloads.
- `data/states/`, `data/constituencies/`, `data/candidates/`, and `data/parties/` are the canonical seed inputs for the Astro pages.
- `data/news/` and `data/manifestos/` are reserved for later pipeline outputs and tracker data.

## Known future task

The seeded MLA records intentionally reflect the pre-May-4, 2026 snapshot requested for phase 1. Once the 2026 Tamil Nadu result transition is final, these incumbent references must be migrated to the post-May-4 slate.
