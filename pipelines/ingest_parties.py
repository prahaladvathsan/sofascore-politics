"""Build or refresh party records referenced by candidate and incumbent data."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PIPELINE_NAME = "ingest_parties"
REPORT_SLUG = "parties"
MAX_LIVE_REPORTS = 12

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT / "data"
PARTIES_DIR = DATA_DIR / "parties"
ALIASES_PATH = PARTIES_DIR / "_aliases.json"
CANDIDATES_DIR = DATA_DIR / "candidates"
INCUMBENTS_DIR = DATA_DIR / "incumbents"
QUALITY_REPORTS_DIR = DATA_DIR / "quality-reports"
ARCHIVE_DIR = QUALITY_REPORTS_DIR / "archive"

NORMALIZE_PATTERN = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class PartyReference:
    source_path: Path
    source_kind: str
    source_record_id: str | None
    party_id: str | None
    party_name: str | None


@dataclass(frozen=True)
class ResolutionResult:
    canonical_party_id: str | None
    reason: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Refresh data/parties from the candidate and incumbent datasets. "
            "In scaffold form, this resolves local party references and "
            "rewrites referenced canonical party files deterministically."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resolve parties and print a summary without writing files.",
    )
    return parser.parse_args()


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def normalize_lookup_key(value: str) -> str:
    return NORMALIZE_PATTERN.sub(" ", value.strip().lower()).strip()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def timestamp_for_report(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H-%M-%SZ")


def load_existing_parties() -> dict[str, dict[str, Any]]:
    parties: dict[str, dict[str, Any]] = {}
    if not PARTIES_DIR.exists():
        return parties

    for path in sorted(PARTIES_DIR.glob("*.json")):
        if path.name.startswith("_"):
            continue

        record = read_json(path)
        party_id = record.get("id")
        if not isinstance(party_id, str) or not party_id:
            raise ValueError(f"{path}: party file is missing a valid id")
        parties[party_id] = record

    return parties


def load_aliases() -> dict[str, str]:
    if not ALIASES_PATH.exists():
        return {}

    payload = read_json(ALIASES_PATH)
    if not isinstance(payload, dict):
        raise ValueError(f"{ALIASES_PATH}: alias file must be a JSON object")

    aliases: dict[str, str] = {}
    for raw_key, raw_value in payload.items():
        if not isinstance(raw_key, str) or not isinstance(raw_value, str):
            raise ValueError(
                f"{ALIASES_PATH}: alias keys and values must both be strings",
            )
        normalized_key = normalize_lookup_key(raw_key)
        if not normalized_key:
            raise ValueError(f"{ALIASES_PATH}: alias key cannot be blank")
        aliases[normalized_key] = raw_value

    return aliases


def build_name_indexes(
    parties: dict[str, dict[str, Any]],
) -> tuple[dict[str, str], dict[str, str]]:
    by_name: dict[str, str] = {}
    by_short_name: dict[str, str] = {}

    for party_id, record in parties.items():
        name = record.get("name")
        short_name = record.get("short_name")
        if isinstance(name, str) and name.strip():
            by_name[normalize_lookup_key(name)] = party_id
        if isinstance(short_name, str) and short_name.strip():
            by_short_name[normalize_lookup_key(short_name)] = party_id

    return by_name, by_short_name


def extract_records(path: Path, payload: Any, source_kind: str) -> list[PartyReference]:
    if isinstance(payload, dict):
        records = [payload]
    elif isinstance(payload, list):
        records = payload
    else:
        raise ValueError(f"{path}: expected a JSON object or array")

    references: list[PartyReference] = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise ValueError(f"{path}: record {index} must be a JSON object")

        record_id = record.get("id")
        party_id = record.get("party_id")
        party_name = record.get("party_name")
        references.append(
            PartyReference(
                source_path=path,
                source_kind=source_kind,
                source_record_id=record_id if isinstance(record_id, str) else None,
                party_id=party_id if isinstance(party_id, str) else None,
                party_name=party_name if isinstance(party_name, str) else None,
            ),
        )

    return references


def collect_party_references() -> tuple[list[PartyReference], list[dict[str, Any]], list[str]]:
    references: list[PartyReference] = []
    failures: list[dict[str, Any]] = []
    sources_touched: list[str] = []

    for directory, source_kind in (
        (CANDIDATES_DIR, "candidate"),
        (INCUMBENTS_DIR, "incumbent"),
    ):
        if not directory.exists():
            continue

        sources_touched.append(str(directory.relative_to(REPO_ROOT)).replace("\\", "/"))
        for path in sorted(directory.rglob("*.json")):
            payload = read_json(path)
            try:
                references.extend(extract_records(path, payload, source_kind))
            except ValueError as error:
                failures.append(
                    {
                        "reason": str(error),
                        "source_path": str(path.relative_to(REPO_ROOT)).replace("\\", "/"),
                    },
                )

    return references, failures, sources_touched


def resolve_reference(
    reference: PartyReference,
    parties: dict[str, dict[str, Any]],
    aliases: dict[str, str],
    parties_by_name: dict[str, str],
    parties_by_short_name: dict[str, str],
) -> ResolutionResult:
    raw_values = [
        value
        for value in (reference.party_id, reference.party_name)
        if isinstance(value, str) and value.strip()
    ]

    if not raw_values:
        return ResolutionResult(
            canonical_party_id=None,
            reason="Record does not include party_id or party_name",
        )

    for raw_value in raw_values:
        if raw_value in parties:
            return ResolutionResult(canonical_party_id=raw_value, reason=None)

        normalized_value = normalize_lookup_key(raw_value)

        aliased_party_id = aliases.get(normalized_value)
        if aliased_party_id:
            if aliased_party_id in parties:
                return ResolutionResult(canonical_party_id=aliased_party_id, reason=None)
            return ResolutionResult(
                canonical_party_id=None,
                reason=(
                    f"Alias '{raw_value}' points to missing canonical party "
                    f"'{aliased_party_id}'"
                ),
            )

        named_party_id = parties_by_name.get(normalized_value)
        if named_party_id:
            return ResolutionResult(canonical_party_id=named_party_id, reason=None)

        short_named_party_id = parties_by_short_name.get(normalized_value)
        if short_named_party_id:
            return ResolutionResult(canonical_party_id=short_named_party_id, reason=None)

    return ResolutionResult(
        canonical_party_id=None,
        reason=f"Unresolved party reference: {raw_values[0]}",
    )


def build_review_item(reference: PartyReference, reason: str) -> dict[str, Any]:
    return {
        "reason": reason,
        "source_kind": reference.source_kind,
        "source_path": str(reference.source_path.relative_to(REPO_ROOT)).replace("\\", "/"),
        "source_record_id": reference.source_record_id,
        "party_id": reference.party_id,
        "party_name": reference.party_name,
    }


def write_quality_report(report: dict[str, Any]) -> Path:
    QUALITY_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)

    report_name = f"ingest-{REPORT_SLUG}-{report['timestamp']}.json"
    report_path = QUALITY_REPORTS_DIR / report_name
    write_json(report_path, report)
    rotate_quality_reports()
    return report_path


def rotate_quality_reports() -> None:
    report_paths = sorted(QUALITY_REPORTS_DIR.glob(f"ingest-{REPORT_SLUG}-*.json"))
    if len(report_paths) <= MAX_LIVE_REPORTS:
        return

    overflow_paths = report_paths[: len(report_paths) - MAX_LIVE_REPORTS]
    for report_path in overflow_paths:
        report = read_json(report_path)
        report_year = report.get("finished_at", "")[:4]
        if not re.fullmatch(r"\d{4}", report_year):
            report_year = "unknown"

        archive_path = ARCHIVE_DIR / f"{report_year}.ndjson"
        with archive_path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(report, ensure_ascii=False, sort_keys=True))
            handle.write("\n")
        report_path.unlink()


def print_summary(
    *,
    dry_run: bool,
    parsed_records: int,
    referenced_party_ids: Counter[str],
    review_queue: list[dict[str, Any]],
    failures: list[dict[str, Any]],
    report_path: Path | None,
) -> None:
    mode_label = "dry-run" if dry_run else "write"
    print(f"[{PIPELINE_NAME}] completed in {mode_label} mode")
    print(f"Parsed records: {parsed_records}")
    print(f"Resolved party ids: {len(referenced_party_ids)}")
    if referenced_party_ids:
        print("Referenced parties:")
        for party_id, count in referenced_party_ids.most_common():
            print(f"  - {party_id}: {count}")

    if review_queue:
        print(f"Review queue entries: {len(review_queue)}")
        for entry in review_queue:
            print(
                "  - "
                f"{entry['reason']} "
                f"({entry['source_path']}::{entry.get('source_record_id') or 'unknown'})",
            )

    if failures:
        print(f"Failures: {len(failures)}")
        for failure in failures:
            print(f"  - {failure['reason']}")

    if report_path:
        print(f"Quality report: {report_path.relative_to(REPO_ROOT)}")


def main() -> int:
    args = parse_args()
    started_at = utc_now()

    parties = load_existing_parties()
    aliases = load_aliases()
    parties_by_name, parties_by_short_name = build_name_indexes(parties)
    references, failures, sources_touched = collect_party_references()

    review_queue: list[dict[str, Any]] = []
    referenced_party_ids: Counter[str] = Counter()

    for reference in references:
        resolution = resolve_reference(
            reference,
            parties=parties,
            aliases=aliases,
            parties_by_name=parties_by_name,
            parties_by_short_name=parties_by_short_name,
        )

        if resolution.canonical_party_id:
            referenced_party_ids[resolution.canonical_party_id] += 1
        else:
            review_queue.append(
                build_review_item(reference, resolution.reason or "Unknown error"),
            )

    finished_at = utc_now()
    report = {
        "pipeline": PIPELINE_NAME,
        "timestamp": timestamp_for_report(finished_at),
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "counts": {
            "fetched": 0,
            "parsed": len(references),
            "written": 0 if args.dry_run or review_queue or failures else len(referenced_party_ids),
            "skipped": len(review_queue),
            "resolved_party_ids": len(referenced_party_ids),
        },
        "failures": failures,
        "latencies_ms_by_source": {},
        "review_queue": review_queue,
        "sources_touched": sources_touched,
    }

    report_path: Path | None = None
    if not args.dry_run:
        if not review_queue and not failures:
            for party_id in sorted(referenced_party_ids):
                party_path = PARTIES_DIR / f"{party_id}.json"
                write_json(party_path, parties[party_id])
        report_path = write_quality_report(report)

    print_summary(
        dry_run=args.dry_run,
        parsed_records=len(references),
        referenced_party_ids=referenced_party_ids,
        review_queue=review_queue,
        failures=failures,
        report_path=report_path,
    )

    if review_queue or failures:
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
