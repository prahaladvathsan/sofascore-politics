# Phase 3 Pipelines

This directory is reserved for the Phase 3 candidate, incumbent, and party
ingestion pipeline. The current patch is docs-only. No pipeline code, workflow
code, or generated election data is introduced here yet.

## Scope for this patch

- Add the Phase 3 operating contract before any ingestion code lands.
- Document source precedence, approval gates, environment setup, data rules,
  quality-report expectations, and workflow behavior.
- Pause for review after this documentation change set.

## Phase 3 sources and precedence

Phase 3 is scoped to two public sources. MyNeta is out of scope until ADR
grants written consent for automated collection, as required by ADR's current
Terms of Use.

1. ECI affidavit archive (`affidavitarchive.nic.in`) — primary source for
   candidate nominations, affidavit PDF URLs, and any nomination metadata
   (name, age, gender, party, constituency) published by the Returning Officer.
2. Wikipedia REST API — for current MLAs in assembly-bearing states and union
   territories outside Tamil Nadu and West Bengal. Parse structured infobox
   data only; do not scrape rendered HTML.

Out of scope for Phase 3 (tracked as a separate consent workstream):

- MyNeta analysed fields (criminal cases, financial assets/liabilities,
  education, profession). These require ADR written consent. See the outreach
  status table below.
- Affidavit PDF parsing. If ADR consent is not granted within a reasonable
  timeframe, a Phase 3.5 PDF-parsing pipeline may be approved separately. It
  is explicitly out of scope for Phase 3.

Source precedence rules:

- ECI records prevail if any derived source disagrees.
- Wikipedia is acceptable for current incumbent context only, not for live 2026
  contest data.
- Every public record must continue to expose `_meta.sources[]` as
  `{url, name, retrieved_at}` triples.

## ADR written-consent outreach

ADR's current Terms of Use require express written consent for automated
collection from MyNeta. This workstream is tracked separately from Phase 3
implementation; Phase 3 does not depend on its outcome.

| Item                 | Value                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contact              | `adr@adrindia.org`                                                                                                                                                                                          |
| Status               | Pending (email drafted, not yet sent)                                                                                                                                                                       |
| Request sent at      | TBD                                                                                                                                                                                                         |
| Response received at | TBD                                                                                                                                                                                                         |
| Outcome              | TBD                                                                                                                                                                                                         |
| Unlock effect        | If granted, enables a Phase 3.5 addition of MyNeta analysed fields (criminal cases, financial, education, profession) via rate-limited HTML collection. No change to Phase 3 scope if denied or unanswered. |

The outreach email template is maintained separately by the repo owner and is
not committed to this repository.

## ADR terms and compliance

The compliance document to honor for MyNeta is ADR's published Terms of Use:

- [ADR Terms of Use](https://adrindia.org/content/adr-terms-use)

Operational takeaways from that page:

- ADR data may be used for non-commercial research and information
  dissemination with citation and attribution.
- News and independent-media usage should mention Association for Democratic
  Reforms as the source and may link back to ADR/MyNeta.
- The current Terms of Use also state that systematic or automated data
  collection requires ADR's express written consent. Future scraper work should
  treat that as a live compliance requirement.
- Future implementation must still adhere to rate-limit, User-Agent, and
  robots.txt conventions.

Additional repository rules that still apply:

- Do not implement any MyNeta collection (API, HTML, or otherwise) in Phase 3.
  MyNeta integration requires ADR written consent and a separate Phase 3.5
  approval from the repo owner before any implementation work begins.
- Do not rehost affidavit PDFs. Store only the original ECI affidavit URL.
- Do not add dependencies beyond the approved list without prior approval.
- Do not merge generated Tamil Nadu 2026 or West Bengal 2026 candidate data to
  `main` until after May 4, 2026 results are final, even if the pipeline is
  ready sooner.

## Local setup

Requirements:

- Python 3.11
- The packages listed in `pipelines/requirements.txt`

Suggested local setup:

```powershell
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
py -3.11 -m pip install -r pipelines/requirements.txt
```

Environment variables are documented in `.env.example`.

Minimum variables:

- `PROJECT_USER_AGENT_NAME`: human-readable project name included in requests.
- `PROJECT_CONTACT_URL`: public contact or repository URL included in the
  User-Agent.
- `PROJECT_CONTACT_EMAIL`: optional but recommended for source operators.

Recommended request identity:

```text
Political Report Card Pipeline (+https://github.com/<your-account>/political-report-card; contact@example.com)
```

## Shared pipeline rules

All future Phase 3 pipeline code must follow these rules:

- Python only, under `pipelines/`.
- Static JSON output only, written under root `data/`.
- No backend, database, OCR layer, or LLM calls.
- Idempotent and safe to re-run.
- Deterministic output ordering so diffs stay clean.

Network behavior:

- Maximum 1 request per second to any single host.
- Exponential backoff on `429` and `5xx` responses.
- Respect `robots.txt`.
- Use a User-Agent that identifies the project and contact URL.

## Data conventions

Output format for all future generated JSON:

- UTF-8
- no BOM
- 2-space indent
- sorted keys
- trailing newline

Null and missing field policy:

- Never invent values.
- If a field is part of the record model but unavailable from the source, write
  it as `null`.
- Use `_meta.data_quality.missing_fields[]` to capture expected-but-absent
  fields.
- Use `_meta.data_quality.readability_flags[]` to capture parse or source
  quality concerns.

Candidate field semantics to preserve in future schema comments:

- `contest_year`: the election year this record belongs to. For a contesting
  candidate, this is the election being contested. For a current incumbent
  record derived from the latest winning assembly result, this is that winning
  election year.
- `term_start`: the sworn-in or service start date for the office, when known.
  This may be `null` even when `contest_year` is known.

Phase 3 null-field expectations:

The following candidate fields will remain `null` in all Phase 3 output,
pending either (a) ADR written consent unlocking MyNeta, or (b) explicit
approval of a Phase 3.5 affidavit PDF-parsing pipeline:

- `education`
- `profession_self`
- `profession_spouse`
- `assets_total_inr`
- `liabilities_total_inr`
- `criminal_cases`

These fields remain in the schema as nullable. UI treatment: the constituency
panel must hide these fields entirely when `null` and surface a single
"View official affidavit ->" link to `affidavit_source_url`. Do not render
"Not available" placeholders; a graveyard of N/A labels is worse than absence.

Fields that Phase 3 will populate from ECI + Wikipedia:

- `id`, `name`, `party_id`, `constituency_id`, `contest_year`, `office`,
  `incumbent`, `term_start`, `age`, `gender`, `affidavit_source_url`,
  `profile_urls`, `_meta.*`

Provenance requirements:

- Every written record must include `_meta.sources[]`.
- `_meta.last_updated` should record the pipeline write timestamp.
- `profile_urls` for future candidate records should be stored as
  `{url, name}` objects, not bare strings.

## Planned outputs

Once pipeline code is approved and implemented, the intended outputs are:

- `data/candidates/<state>/<constituency_id>.json`
  - one JSON array of extended candidate records for each Tamil Nadu and West
    Bengal constituency
- `data/incumbents/<state>.json`
  - one JSON array of extended candidate-like records for current MLAs in every
    other assembly-bearing state or union territory
- `data/parties/<party_id>.json`
  - party records for every party referenced by candidates or incumbents
- `data/quality-reports/ingest-<pipeline>-<timestamp>.json`
  - run summary for each pipeline execution

Legacy compatibility note:

- Existing flat seed candidate files under `data/candidates/*.json` remain in
  place for now.
- Future loader updates should prefer the new structured datasets and fall back
  to the legacy flat seed files where structured data is absent.

## Quality reports

Every future pipeline run should write a quality report using the pattern:

```text
data/quality-reports/ingest-<pipeline>-<timestamp>.json
```

Expected contents:

- `pipeline`
- `started_at`
- `finished_at`
- `counts`
  - `fetched`
  - `parsed`
  - `written`
  - `skipped`
- `latencies_ms_by_source`
- `failures`
- `sources_touched`
- `review_queue`

`review_queue[]` is required for manual follow-up items. Unknown party names
must halt the run and be emitted here. Do not silently mint new party ids.

Rotation policy for the future shared helper:

- Keep the newest 12 JSON quality reports per pipeline in
  `data/quality-reports/`.
- Append older reports to `data/quality-reports/archive/<year>.ndjson`.
- Archive entries should preserve the original JSON report payload, one object
  per line.

## Party alias policy

Future party resolution will use a hand-curated alias file:

```text
data/parties/_aliases.json
```

Do not add that file in this docs-only patch. Add it with the first
party-resolution implementation change.

Required shape for the future alias file:

```json
{
  "all india anna dravida munnetra kazhagam": "AIADMK",
  "bharatiya janata party": "BJP",
  "independent": "IND"
}
```

Resolution order for future code:

1. Existing canonical party ids / files under `data/parties/`
2. `_aliases.json`
3. Exact case-insensitive matches against existing party `name`
4. Exact case-insensitive matches against existing party `short_name`

If resolution still fails:

- stop the run
- add the unresolved names to `review_queue[]`
- write no new candidate or incumbent outputs for unresolved records

## Workflow expectations

The future workflow set is:

- `ingest-candidates.yml`
- `ingest-incumbents.yml`
- `ingest-parties.yml`

Expected behavior to preserve when workflow code is added later:

- all three workflows expose `workflow_dispatch.inputs.dry_run` as a boolean
- `dry_run=true` writes outputs and quality reports in the workflow workspace,
  uploads them as artifacts, and skips commit/push
- `ingest-parties.yml` also runs on `workflow_run`
- upstream workflows should publish a small metadata artifact containing the
  resolved `dry_run` state so `ingest-parties.yml` inherits it
- bot commits should use `[skip ci]` in the commit message
- CI should later add `paths-ignore` for:
  - `data/candidates/**`
  - `data/incumbents/**`
  - `data/quality-reports/**`

Loop-prevention note:

- `data/parties/**` stays visible to CI
- only generated candidate, incumbent, and quality-report paths are planned for
  ignore-based loop prevention

## Planned local commands

These commands are placeholders for the upcoming implementation order:

```powershell
py -3.11 pipelines/ingest_parties.py --dry-run
py -3.11 pipelines/ingest_incumbents.py --dry-run
py -3.11 pipelines/ingest_candidates.py --dry-run
npm run validate:data
```

Implementation order after docs approval:

1. `ingest_parties.py` scaffold
2. `ingest_incumbents.py`
3. `ingest_candidates.py`
4. `ingest_parties.py` refresh with real source data
5. GitHub Actions workflow wiring last

## Data-quality review workflow

After each future pipeline run, review:

- the quality report counts and failures
- `review_queue[]` for unknown parties or records needing manual action
- source provenance on newly written records
- candidate release-freeze compliance for Tamil Nadu and West Bengal outputs
- deterministic diffs before any commit is allowed

## Out of scope for Phase 3

- News ingestion
- Entity tagging
- Manifesto tracking
- Subjective scoring
- Sentiment labels
- Promise / broken-promise taxonomy
