"""Ingest current MLAs for assembly-bearing states and union territories."""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PIPELINE_NAME = "ingest_incumbents"
REPORT_SLUG = "incumbents"
MAX_LIVE_REPORTS = 12
WIKIPEDIA_REST_BASE = "https://api.wikimedia.org/core/v1/wikipedia/en/page"
WIKIPEDIA_WEB_BASE = "https://en.wikipedia.org/wiki"

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT / "data"
NAVIGATION_PATH = DATA_DIR / "navigation" / "states.json"
INCUMBENTS_DIR = DATA_DIR / "incumbents"
PARTIES_DIR = DATA_DIR / "parties"
ALIASES_PATH = PARTIES_DIR / "_aliases.json"
QUALITY_REPORTS_DIR = DATA_DIR / "quality-reports"
ARCHIVE_DIR = QUALITY_REPORTS_DIR / "archive"

NORMALIZE_PATTERN = re.compile(r"[^a-z0-9]+")
SLUG_PATTERN = re.compile(r"[^a-z0-9]+")
WIKILINK_PATTERN = re.compile(r"\[\[([^|\]]+)(?:\|([^]]+))?\]\]")
TEMPLATE_PATTERN = re.compile(r"\{\{([^{}]+)\}\}")
REF_BLOCK_PATTERN = re.compile(r"<ref\b[^>/]*>.*?</ref>", re.IGNORECASE | re.DOTALL)
REF_SELF_CLOSING_PATTERN = re.compile(r"<ref\b[^>]*/\s*>", re.IGNORECASE)
HTML_TAG_PATTERN = re.compile(r"<[^>]+>")
EXTERNAL_LINK_PATTERN = re.compile(r"\[(https?://[^\s\]]+)\s+([^\]]+)\]")
NUMBER_LINE_PATTERN = re.compile(r"^[|!]\s*(\d{1,3})\s*$")
REDIRECT_PATTERN = re.compile(r"^#redirect\s*\[\[([^|\]]+)", re.IGNORECASE)
INLINE_FIELD_PATTERN = re.compile(r"(?<!\n)\|\s*([A-Za-z0-9_]+)\s*=")
FILE_LINK_PATTERN = re.compile(r"\[\[(?:File|Image):[^\]]+\]\]", re.IGNORECASE)
DIRECT_LINK_LINE_PATTERN = re.compile(r'^[|!](?:\s*scope=row\s*\|\s*)?\s*\[\[', re.IGNORECASE)


@dataclass(frozen=True)
class StateContext:
    code: str
    name: str


@dataclass(frozen=True)
class ConstituencyReference:
    number: int
    page_title: str


@dataclass(frozen=True)
class PartyResolution:
    canonical_party_id: str | None
    reason: str | None


class WikipediaClient:
    """Small rate-limited REST client with robots checks and retries."""

    def __init__(self, user_agent: str, timeout_seconds: float = 20.0) -> None:
        self.user_agent = user_agent
        self.timeout_seconds = timeout_seconds
        self._last_request_by_host: dict[str, float] = {}
        self._robots_by_host: dict[str, urllib.robotparser.RobotFileParser] = {}
        self.request_count = 0
        self.latencies_ms_by_host: dict[str, dict[str, int]] = defaultdict(
            lambda: {"count": 0, "total_ms": 0, "max_ms": 0},
        )
        self.sources_touched: set[str] = set()

    def get_page(self, page_title: str) -> dict[str, Any]:
        return self._get_page(page_title, seen_titles=set())

    def _get_page(self, page_title: str, seen_titles: set[str]) -> dict[str, Any]:
        normalized_title = page_title.replace("_", " ")
        if normalized_title in seen_titles:
            raise ValueError(f"Redirect loop detected for {page_title}")
        seen_titles.add(normalized_title)

        slug = urllib.parse.quote(page_title.replace(" ", "_"), safe="(),:_-")
        url = f"{WIKIPEDIA_REST_BASE}/{slug}"
        payload = self.get_json(url)
        payload["_source_url"] = url
        payload["_page_url"] = f"{WIKIPEDIA_WEB_BASE}/{slug}"
        source = payload.get("source")
        if isinstance(source, str):
            redirect_match = REDIRECT_PATTERN.match(source.strip())
            if redirect_match:
                target_title = redirect_match.group(1).strip()
                return self._get_page(target_title, seen_titles=seen_titles)
        return payload

    def get_json(self, url: str) -> dict[str, Any]:
        parsed = urllib.parse.urlparse(url)
        host = parsed.netloc
        self._ensure_allowed(url, host)

        for attempt in range(5):
            self._wait_for_host(host)
            started = time.monotonic()
            request = urllib.request.Request(
                url,
                headers={"User-Agent": self.user_agent},
            )
            try:
                with urllib.request.urlopen(
                    request,
                    timeout=self.timeout_seconds,
                ) as response:
                    payload = json.load(response)
            except urllib.error.HTTPError as error:
                if error.code in {429, 500, 502, 503, 504} and attempt < 4:
                    time.sleep(2**attempt)
                    continue
                raise
            except urllib.error.URLError:
                if attempt < 4:
                    time.sleep(2**attempt)
                    continue
                raise

            elapsed_ms = int((time.monotonic() - started) * 1000)
            self._last_request_by_host[host] = time.monotonic()
            self.request_count += 1
            self.sources_touched.add(url)
            stats = self.latencies_ms_by_host[host]
            stats["count"] += 1
            stats["total_ms"] += elapsed_ms
            stats["max_ms"] = max(stats["max_ms"], elapsed_ms)
            return payload

        raise RuntimeError(f"Failed to fetch {url}")

    def _ensure_allowed(self, url: str, host: str) -> None:
        parser = self._robots_by_host.get(host)
        if parser is None:
            robots_url = f"{urllib.parse.urlparse(url).scheme}://{host}/robots.txt"
            parser = urllib.robotparser.RobotFileParser()
            request = urllib.request.Request(
                robots_url,
                headers={"User-Agent": self.user_agent},
            )
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = response.read().decode("utf-8", errors="replace")
            parser.parse(payload.splitlines())
            self._robots_by_host[host] = parser

        if not parser.can_fetch(self.user_agent, url):
            raise PermissionError(f"robots.txt disallows {url}")

    def _wait_for_host(self, host: str) -> None:
        previous = self._last_request_by_host.get(host)
        if previous is None:
            return

        elapsed = time.monotonic() - previous
        if elapsed < 1.0:
            time.sleep(1.0 - elapsed)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build current incumbent MLA datasets for assembly-bearing states "
            "and union territories outside Tamil Nadu and West Bengal."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and resolve incumbents without writing output files.",
    )
    parser.add_argument(
        "--state",
        action="append",
        default=[],
        help="Limit ingestion to one or more state codes, e.g. --state DL --state AP.",
    )
    parser.add_argument(
        "--limit-constituencies",
        type=int,
        default=None,
        help="Process only the first N constituencies per selected state.",
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


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def timestamp_for_report(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H-%M-%SZ")


def relative_repo_path(path: Path) -> str:
    return str(path.relative_to(REPO_ROOT)).replace("\\", "/")


def normalize_lookup_key(value: str) -> str:
    return NORMALIZE_PATTERN.sub(" ", value.strip().lower()).strip()


def slugify(value: str) -> str:
    slug = SLUG_PATTERN.sub("-", value.strip().lower()).strip("-")
    return slug or "unknown"


def load_existing_parties() -> dict[str, dict[str, Any]]:
    parties: dict[str, dict[str, Any]] = {}
    if not PARTIES_DIR.exists():
        return parties

    for path in sorted(PARTIES_DIR.glob("*.json")):
        if path.name.startswith("_"):
            continue

        record = read_json(path)
        party_id = record.get("id")
        if isinstance(party_id, str) and party_id:
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
        aliases[normalize_lookup_key(raw_key)] = raw_value

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


def resolve_party_reference(
    *,
    party_name: str | None,
    parties: dict[str, dict[str, Any]],
    aliases: dict[str, str],
    parties_by_name: dict[str, str],
    parties_by_short_name: dict[str, str],
) -> PartyResolution:
    if not party_name or not party_name.strip():
        return PartyResolution(None, "Missing party field in constituency infobox")

    if party_name in parties:
        return PartyResolution(party_name, None)

    normalized_value = normalize_lookup_key(party_name)
    aliased_party_id = aliases.get(normalized_value)
    if aliased_party_id:
        if aliased_party_id in parties:
            return PartyResolution(aliased_party_id, None)
        return PartyResolution(
            None,
            (
                f"Alias '{party_name}' points to missing canonical party "
                f"'{aliased_party_id}'"
            ),
        )

    if normalized_value in parties_by_name:
        return PartyResolution(parties_by_name[normalized_value], None)

    if normalized_value in parties_by_short_name:
        return PartyResolution(parties_by_short_name[normalized_value], None)

    return PartyResolution(None, f"Unresolved party reference: {party_name}")


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


def build_user_agent() -> str:
    project_name = os.getenv("PROJECT_USER_AGENT_NAME", "Political Report Card Pipeline")
    contact_url = os.getenv(
        "PROJECT_CONTACT_URL",
        "https://github.com/<your-account>/political-report-card",
    )
    contact_email = os.getenv("PROJECT_CONTACT_EMAIL", "").strip()
    if contact_email:
        return f"{project_name} (+{contact_url}; {contact_email})"
    return f"{project_name} (+{contact_url})"


def load_target_states(requested_codes: list[str]) -> list[StateContext]:
    records = read_json(NAVIGATION_PATH)
    selected_codes = {code.upper() for code in requested_codes}
    states: list[StateContext] = []
    for record in records:
        code = record.get("code")
        if not isinstance(code, str):
            continue
        if code in {"TN", "WB"}:
            continue
        if not record.get("has_assembly"):
            continue
        if selected_codes and code not in selected_codes:
            continue

        name = record.get("name")
        if not isinstance(name, str) or not name:
            raise ValueError(f"State navigation record is missing a valid name: {record}")
        states.append(StateContext(code=code, name=name))

    if selected_codes:
        found_codes = {state.code for state in states}
        missing_codes = sorted(selected_codes - found_codes)
        if missing_codes:
            raise ValueError(f"Unknown or unsupported state codes: {', '.join(missing_codes)}")

    return states


def build_list_page_title(state_name: str) -> str:
    normalized_name = state_name.replace("&", "and")
    underscored = normalized_name.replace(" ", "_")
    return f"List_of_constituencies_of_the_{underscored}_Legislative_Assembly"


def extract_constituency_refs(source: str) -> list[ConstituencyReference]:
    references: list[ConstituencyReference] = []
    current_number: int | None = None
    awaiting_title = False

    for raw_line in source.splitlines():
        line = raw_line.strip()
        number_match = NUMBER_LINE_PATTERN.match(line)
        if number_match:
            current_number = int(number_match.group(1))
            awaiting_title = True
            continue

        if not awaiting_title or current_number is None:
            continue

        if not line.startswith(("|", "!")):
            continue
        if not DIRECT_LINK_LINE_PATTERN.match(line):
            continue

        link_match = WIKILINK_PATTERN.search(line)
        if not link_match:
            continue

        page_title = link_match.group(1).split("#", 1)[0].strip()
        if "assembly constituency" not in page_title.lower():
            continue
        references.append(
            ConstituencyReference(number=current_number, page_title=page_title),
        )
        current_number = None
        awaiting_title = False

    return references


def extract_infobox(source: str) -> str | None:
    marker = "{{Infobox Indian constituency"
    start = source.find(marker)
    if start == -1:
        return None

    index = start
    balance = 0
    while index < len(source):
        if source.startswith("{{", index):
            balance += 1
            index += 2
            continue
        if source.startswith("}}", index):
            balance -= 1
            index += 2
            if balance == 0:
                return source[start:index]
            continue
        index += 1

    return None


def parse_infobox_fields(infobox: str) -> dict[str, str]:
    infobox = INLINE_FIELD_PATTERN.sub(r"\n|\1 =", infobox)
    fields: dict[str, str] = {}
    current_key: str | None = None
    current_value_lines: list[str] = []

    for raw_line in infobox.splitlines()[1:]:
        if raw_line.startswith("|"):
            if current_key is not None:
                fields[current_key] = "\n".join(current_value_lines).strip()

            key, separator, value = raw_line[1:].partition("=")
            if not separator:
                current_key = None
                current_value_lines = []
                continue

            current_key = key.strip()
            current_value_lines = [value.strip()]
        elif current_key is not None:
            current_value_lines.append(raw_line.strip())

    if current_key is not None:
        fields[current_key] = "\n".join(current_value_lines).strip()

    return fields


def extract_first_wikilink_target(value: str) -> str | None:
    match = WIKILINK_PATTERN.search(value)
    if not match:
        return None
    return match.group(1).split("#", 1)[0].strip()


def clean_wikitext(value: str) -> str:
    cleaned = REF_BLOCK_PATTERN.sub("", value)
    cleaned = REF_SELF_CLOSING_PATTERN.sub("", cleaned)
    cleaned = FILE_LINK_PATTERN.sub("", cleaned)
    cleaned = cleaned.replace("&nbsp;", " ")

    while True:
        template_match = TEMPLATE_PATTERN.search(cleaned)
        if not template_match:
            break

        replacement = resolve_template(template_match.group(1))
        cleaned = (
            cleaned[: template_match.start()]
            + replacement
            + cleaned[template_match.end() :]
        )

    cleaned = WIKILINK_PATTERN.sub(lambda match: match.group(2) or match.group(1), cleaned)
    cleaned = EXTERNAL_LINK_PATTERN.sub(lambda match: match.group(2), cleaned)
    cleaned = HTML_TAG_PATTERN.sub("", cleaned)
    cleaned = cleaned.replace("'''", "").replace("''", "")
    cleaned = re.sub(r"\b\d+px\b", "", cleaned)
    cleaned = html.unescape(cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def resolve_template(template_body: str) -> str:
    parts = [part.strip() for part in template_body.split("|")]
    if not parts:
        return ""

    template_name = parts[0].lower()
    positional = [part for part in parts[1:] if "=" not in part]

    if template_name in {"party index link", "party", "nowrap", "plainlist"}:
        return positional[0] if positional else ""
    if template_name == "formatnum":
        return positional[0] if positional else ""
    if positional:
        return positional[-1]
    return ""


def parse_int(value: str | None) -> int | None:
    if value is None:
        return None

    match = re.search(r"\d{1,4}", value.replace(",", ""))
    if not match:
        return None
    return int(match.group(0))


def build_source_reference(url: str, name: str, retrieved_at: str) -> dict[str, str]:
    return {"url": url, "name": name, "retrieved_at": retrieved_at}


def build_review_item(
    *,
    state_code: str,
    page_title: str,
    reason: str,
    constituency_number: int | None = None,
    mla_name: str | None = None,
    party_name: str | None = None,
) -> dict[str, Any]:
    return {
        "state_code": state_code,
        "page_title": page_title,
        "constituency_number": constituency_number,
        "mla_name": mla_name,
        "party_name": party_name,
        "reason": reason,
    }


def build_incumbent_record(
    *,
    state: StateContext,
    constituency_page: dict[str, Any],
    source_ref: ConstituencyReference,
    party_id: str,
    retrieved_at: str,
) -> dict[str, Any]:
    infobox = extract_infobox(constituency_page["source"])
    if infobox is None:
        raise ValueError("Missing Infobox Indian constituency template")

    fields = parse_infobox_fields(infobox)
    raw_mla = fields.get("mla", "")
    raw_party = fields.get("party", "")
    raw_name = fields.get("name", "")
    raw_latest_election_year = fields.get("latest_election_year", "")
    raw_number = fields.get("constituency_no", "")

    mla_name = clean_wikitext(raw_mla)
    constituency_name = clean_wikitext(raw_name) or clean_wikitext(constituency_page["title"])
    latest_election_year = parse_int(clean_wikitext(raw_latest_election_year))
    infobox_number = parse_int(clean_wikitext(raw_number))
    constituency_number = infobox_number if infobox_number is not None else source_ref.number

    if infobox_number is not None and infobox_number != source_ref.number:
        raise ValueError(
            f"List-page number {source_ref.number} does not match infobox "
            f"constituency_no {infobox_number}",
        )

    if not mla_name:
        raise ValueError("Missing mla field in constituency infobox")

    constituency_id = f"{state.code}-{constituency_number:03d}"
    candidate_id = f"{constituency_id}-{slugify(mla_name)}"
    mla_page_title = extract_first_wikilink_target(raw_mla)
    page_slug = urllib.parse.quote(constituency_page["title"].replace(" ", "_"), safe="(),:_-")
    constituency_page_url = f"{WIKIPEDIA_WEB_BASE}/{page_slug}"

    profile_urls = [
        {
            "url": constituency_page_url,
            "name": f"Wikipedia - {constituency_page['title']}",
        },
    ]
    if mla_page_title:
        mla_slug = urllib.parse.quote(mla_page_title.replace(" ", "_"), safe="(),:_-")
        profile_urls.append(
            {
                "url": f"{WIKIPEDIA_WEB_BASE}/{mla_slug}",
                "name": f"Wikipedia - {mla_page_title}",
            },
        )

    missing_fields: list[str] = []
    for field_name, value in (
        ("term_start", None),
        ("age", None),
        ("gender", None),
        ("education", None),
        ("profession_self", None),
        ("profession_spouse", None),
        ("assets_total_inr", None),
        ("liabilities_total_inr", None),
        ("criminal_cases", None),
        ("affidavit_source_url", None),
    ):
        if value is None:
            missing_fields.append(field_name)

    if latest_election_year is None:
        missing_fields.append("contest_year")

    return {
        "_meta": {
            "data_quality": {
                "missing_fields": missing_fields,
                "readability_flags": [],
            },
            "last_updated": retrieved_at,
            "sources": [
                build_source_reference(
                    constituency_page["_source_url"],
                    f"Wikipedia REST API - {constituency_page['title']}",
                    retrieved_at,
                ),
            ],
        },
        "affidavit_source_url": None,
        "age": None,
        "assets_total_inr": None,
        "constituency_id": constituency_id,
        "contest_year": latest_election_year,
        "criminal_cases": None,
        "education": None,
        "gender": None,
        "id": candidate_id,
        "incumbent": True,
        "liabilities_total_inr": None,
        "name": mla_name,
        "office": "MLA",
        "party_id": party_id,
        "profession_self": None,
        "profession_spouse": None,
        "profile_urls": profile_urls,
        "term_start": None,
    }


def print_summary(
    *,
    dry_run: bool,
    state_records: dict[str, list[dict[str, Any]]],
    review_queue: list[dict[str, Any]],
    failures: list[dict[str, Any]],
    report_path: Path | None,
) -> None:
    mode_label = "dry-run" if dry_run else "write"
    total_records = sum(len(records) for records in state_records.values())
    print(f"[{PIPELINE_NAME}] completed in {mode_label} mode")
    print(f"States parsed: {len(state_records)}")
    print(f"Incumbent records built: {total_records}")

    if state_records:
        print("Per-state counts:")
        for state_code, records in sorted(state_records.items()):
            print(f"  - {state_code}: {len(records)}")

    if review_queue:
        print(f"Review queue entries: {len(review_queue)}")
        for entry in review_queue[:10]:
            print(
                "  - "
                f"{entry['reason']} "
                f"({entry['state_code']}::{entry['page_title']})",
            )

    if failures:
        print(f"Failures: {len(failures)}")
        for failure in failures[:10]:
            print(f"  - {failure['reason']} ({failure.get('page_title', failure.get('state_code', 'unknown'))})")

    if report_path:
        print(f"Quality report: {report_path.relative_to(REPO_ROOT)}")


def main() -> int:
    args = parse_args()
    started_at = utc_now()
    retrieved_at = started_at.isoformat()

    parties = load_existing_parties()
    aliases = load_aliases()
    parties_by_name, parties_by_short_name = build_name_indexes(parties)
    states = load_target_states(args.state)
    client = WikipediaClient(build_user_agent())

    state_records: dict[str, list[dict[str, Any]]] = {}
    review_queue: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for state in states:
        list_page_title = build_list_page_title(state.name)
        try:
            list_page = client.get_page(list_page_title)
        except Exception as error:  # noqa: BLE001
            failures.append(
                {
                    "state_code": state.code,
                    "page_title": list_page_title,
                    "reason": str(error),
                },
            )
            continue

        references = extract_constituency_refs(list_page["source"])
        if args.limit_constituencies is not None:
            references = references[: args.limit_constituencies]

        records_for_state: list[dict[str, Any]] = []
        for reference in references:
            try:
                constituency_page = client.get_page(reference.page_title)
            except Exception as error:  # noqa: BLE001
                failures.append(
                    {
                        "state_code": state.code,
                        "page_title": reference.page_title,
                        "constituency_number": reference.number,
                        "reason": str(error),
                    },
                )
                continue

            infobox = extract_infobox(constituency_page["source"])
            if infobox is None:
                review_queue.append(
                    build_review_item(
                        state_code=state.code,
                        page_title=reference.page_title,
                        constituency_number=reference.number,
                        reason="Missing Infobox Indian constituency template",
                    ),
                )
                continue

            fields = parse_infobox_fields(infobox)
            party_name = clean_wikitext(fields.get("party", ""))
            mla_name = clean_wikitext(fields.get("mla", ""))
            resolution = resolve_party_reference(
                party_name=party_name,
                parties=parties,
                aliases=aliases,
                parties_by_name=parties_by_name,
                parties_by_short_name=parties_by_short_name,
            )

            if resolution.canonical_party_id is None:
                review_queue.append(
                    build_review_item(
                        state_code=state.code,
                        page_title=reference.page_title,
                        constituency_number=reference.number,
                        mla_name=mla_name or None,
                        party_name=party_name or None,
                        reason=resolution.reason or "Unknown party resolution error",
                    ),
                )
                continue

            try:
                record = build_incumbent_record(
                    state=state,
                    constituency_page=constituency_page,
                    source_ref=reference,
                    party_id=resolution.canonical_party_id,
                    retrieved_at=retrieved_at,
                )
            except ValueError as error:
                review_queue.append(
                    build_review_item(
                        state_code=state.code,
                        page_title=reference.page_title,
                        constituency_number=reference.number,
                        mla_name=mla_name or None,
                        party_name=party_name or None,
                        reason=str(error),
                    ),
                )
                continue

            record["_meta"]["sources"].insert(
                0,
                build_source_reference(
                    list_page["_source_url"],
                    f"Wikipedia REST API - {list_page['title']}",
                    retrieved_at,
                ),
            )
            records_for_state.append(record)

        state_records[state.code] = sorted(
            records_for_state,
            key=lambda record: record["constituency_id"],
        )

    finished_at = utc_now()
    report = {
        "pipeline": PIPELINE_NAME,
        "timestamp": timestamp_for_report(finished_at),
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "counts": {
            "fetched": client.request_count,
            "parsed": sum(len(records) for records in state_records.values()),
            "written": 0
            if args.dry_run or review_queue or failures
            else sum(len(records) for records in state_records.values()),
            "skipped": len(review_queue),
            "states_processed": len(states),
        },
        "failures": failures,
        "latencies_ms_by_source": {
            host: dict(stats)
            for host, stats in sorted(client.latencies_ms_by_host.items())
        },
        "review_queue": review_queue,
        "sources_touched": sorted(client.sources_touched),
    }

    report_path: Path | None = None
    if not args.dry_run:
        if not review_queue and not failures:
            for state_code, records in state_records.items():
                write_json(INCUMBENTS_DIR / f"{state_code}.json", records)
        report_path = write_quality_report(report)

    print_summary(
        dry_run=args.dry_run,
        state_records=state_records,
        review_queue=review_queue,
        failures=failures,
        report_path=report_path,
    )

    if review_queue or failures:
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
