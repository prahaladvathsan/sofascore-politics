"""Ingest 2026 Tamil Nadu and West Bengal assembly candidates from ECI."""

from __future__ import annotations

import argparse
import html
import http.cookiejar
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


PIPELINE_NAME = "ingest_candidates"
REPORT_SLUG = "candidates"
MAX_LIVE_REPORTS = 12
TARGET_CONTEST_YEAR = 2026
ECI_BASE = "https://affidavit.eci.gov.in"
TARGET_STATE_CODES = ("TN", "WB")
ECI_STATE_CODES = {
    "TN": "S22",
    "WB": "S25",
}

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT / "data"
MAPS_PATH = DATA_DIR / "maps" / "constituencies.json"
PARTIES_DIR = DATA_DIR / "parties"
ALIASES_PATH = PARTIES_DIR / "_aliases.json"
LEGACY_CANDIDATES_DIR = DATA_DIR / "candidates"
STRUCTURED_CANDIDATES_DIR = DATA_DIR / "candidates"
QUALITY_REPORTS_DIR = DATA_DIR / "quality-reports"
ARCHIVE_DIR = QUALITY_REPORTS_DIR / "archive"

NORMALIZE_PATTERN = re.compile(r"[^a-z0-9]+")
SLUG_PATTERN = re.compile(r"[^a-z0-9]+")
OPTION_PATTERN = re.compile(
    r"<option[^>]*value=\"([^\"]*)\"[^>]*>(.*?)</option>",
    re.IGNORECASE | re.DOTALL,
)
ROW_PATTERN = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
WHITESPACE_PATTERN = re.compile(r"\s+")
HTML_TAG_PATTERN = re.compile(r"<[^>]+>")


@dataclass(frozen=True)
class ElectionContext:
    election_type_value: str
    election_type_label: str
    election_value: str
    election_label: str
    election_id: str
    const_type: str
    elect_type: str
    db_id: str


@dataclass(frozen=True)
class ConstituencyReference:
    state_code: str
    state_name: str
    eci_state_code: str
    phase_value: str
    phase_label: str
    constituency_number: int
    constituency_id: str
    constituency_name: str


@dataclass(frozen=True)
class CandidateCard:
    name: str
    party_name: str
    status: str
    state_name: str
    constituency_name: str
    profile_url: str


@dataclass(frozen=True)
class PartyResolution:
    canonical_party_id: str | None
    reason: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build accepted-candidate datasets for the 2026 Tamil Nadu and "
            "West Bengal assembly elections from the official ECI affidavit portal."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse candidates without writing output files.",
    )
    parser.add_argument(
        "--state",
        action="append",
        default=[],
        help="Limit ingestion to TN and/or WB, e.g. --state TN --state WB.",
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


def clean_html_text(value: str) -> str:
    cleaned = html.unescape(value.replace("&nbsp;", " "))
    cleaned = HTML_TAG_PATTERN.sub(" ", cleaned)
    cleaned = WHITESPACE_PATTERN.sub(" ", cleaned)
    return cleaned.strip()


def extract_select_options(page_html: str, select_id: str) -> list[tuple[str, str]]:
    match = re.search(
        rf'<select[^>]+id="{re.escape(select_id)}"[^>]*>(.*?)</select>',
        page_html,
        re.IGNORECASE | re.DOTALL,
    )
    if not match:
        raise ValueError(f"Could not find select #{select_id}")

    options: list[tuple[str, str]] = []
    for raw_value, raw_label in OPTION_PATTERN.findall(match.group(1)):
        value = raw_value.strip()
        label = clean_html_text(raw_label)
        options.append((value, label))
    return options


def extract_options(option_html: str) -> list[tuple[str, str]]:
    options: list[tuple[str, str]] = []
    for raw_value, raw_label in OPTION_PATTERN.findall(option_html):
        value = raw_value.strip()
        label = clean_html_text(raw_label)
        options.append((value, label))
    return options


def parse_int(value: str | None) -> int | None:
    if value is None:
        return None

    match = re.search(r"\d{1,4}", value.replace(",", ""))
    if not match:
        return None
    return int(match.group(0))


def build_source_reference(url: str, name: str, retrieved_at: str) -> dict[str, str]:
    return {"url": url, "name": name, "retrieved_at": retrieved_at}


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
        report_year = str(report.get("finished_at", ""))[:4]
        if not re.fullmatch(r"\d{4}", report_year):
            report_year = "unknown"

        archive_path = ARCHIVE_DIR / f"{report_year}.ndjson"
        with archive_path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(report, ensure_ascii=False, sort_keys=True))
            handle.write("\n")
        report_path.unlink()


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
        return PartyResolution(None, "Missing party field in ECI candidate record")

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


def load_map_records() -> dict[str, dict[int, dict[str, Any]]]:
    payload = read_json(MAPS_PATH)
    if not isinstance(payload, list):
        raise ValueError(f"{MAPS_PATH}: constituency map file must be a JSON array")

    records: dict[str, dict[int, dict[str, Any]]] = defaultdict(dict)
    for record in payload:
        if not isinstance(record, dict):
            continue
        state_code = record.get("state_code")
        number = record.get("number")
        if (
            isinstance(state_code, str)
            and state_code in TARGET_STATE_CODES
            and isinstance(number, int)
        ):
            records[state_code][number] = record
    return records


def load_seed_incumbents() -> dict[str, dict[str, str | None]]:
    incumbents: dict[str, dict[str, str | None]] = {}
    if not LEGACY_CANDIDATES_DIR.exists():
        return incumbents

    for path in sorted(LEGACY_CANDIDATES_DIR.glob("*.json")):
        record = read_json(path)
        if not isinstance(record, dict):
            continue
        if record.get("incumbent") is not True:
            continue

        constituency_id = record.get("constituency_id")
        name = record.get("name")
        if not isinstance(constituency_id, str) or not isinstance(name, str):
            continue

        term_start = record.get("term_start")
        incumbents[constituency_id] = {
            "normalized_name": normalize_lookup_key(name),
            "term_start": term_start if isinstance(term_start, str) else None,
        }

    return incumbents


def sanitize_contact_url_for_user_agent(value: str) -> str:
    sanitized = re.sub(r"^https?://", "", value.strip(), flags=re.IGNORECASE)
    return sanitized.rstrip("/") or "github.com/<your-account>/political-report-card"


def build_user_agent() -> str:
    browser_prefix = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/135.0.0.0 Safari/537.36"
    )
    project_name = os.getenv("PROJECT_USER_AGENT_NAME", "Political Report Card Pipeline")
    contact_url = os.getenv(
        "PROJECT_CONTACT_URL",
        "https://github.com/<your-account>/political-report-card",
    )
    project_token = re.sub(r"[^A-Za-z0-9]+", "", project_name) or "PoliticalReportCard"

    # ECI accepts a browser-compatible UA with a project token and contact path,
    # but rejects literal https:// URLs and email addresses in the UA string.
    return (
        f"{browser_prefix} {project_token} "
        f"{sanitize_contact_url_for_user_agent(contact_url)}"
    )


class ECIClient:
    """Small rate-limited client for the official ECI affidavit portal."""

    def __init__(self, user_agent: str, timeout_seconds: float = 30.0) -> None:
        self.user_agent = user_agent
        self.timeout_seconds = timeout_seconds
        self._last_request_by_host: dict[str, float] = {}
        self._robots_by_host: dict[str, urllib.robotparser.RobotFileParser] = {}
        self._cookie_jar = http.cookiejar.CookieJar()
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self._cookie_jar),
        )
        self.request_count = 0
        self.latencies_ms_by_source: dict[str, dict[str, int]] = defaultdict(
            lambda: {"count": 0, "total_ms": 0, "max_ms": 0},
        )
        self.sources_touched: set[str] = set()

    def get_homepage(self) -> str:
        return self.get_html(f"{ECI_BASE}/")

    def get_html(self, url: str, *, referer: str | None = None) -> str:
        return self._request(url, referer=referer, ajax=False)

    def post_ajax(self, path: str, payload: dict[str, str], *, referer: str) -> str:
        url = f"{ECI_BASE}{path}"
        return self._request(url, payload=payload, referer=referer, ajax=True)

    def post_form(self, path: str, payload: dict[str, str], *, referer: str) -> str:
        url = f"{ECI_BASE}{path}"
        return self._request(url, payload=payload, referer=referer, ajax=False)

    def _request(
        self,
        url: str,
        *,
        payload: dict[str, str] | None = None,
        referer: str | None = None,
        ajax: bool,
    ) -> str:
        parsed = urllib.parse.urlparse(url)
        host = parsed.netloc
        self._ensure_allowed(url, host)

        encoded_payload = (
            urllib.parse.urlencode(payload).encode("utf-8")
            if payload is not None
            else None
        )

        for attempt in range(5):
            self._wait_for_host(host)
            headers = {
                "User-Agent": self.user_agent,
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": (
                    "*/*"
                    if ajax
                    else "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                ),
            }
            if referer:
                headers["Referer"] = referer
            if encoded_payload is not None:
                headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
                headers["Origin"] = ECI_BASE
                if ajax:
                    headers["X-Requested-With"] = "XMLHttpRequest"

            request = urllib.request.Request(url, data=encoded_payload, headers=headers)
            started = time.monotonic()
            try:
                with self._opener.open(request, timeout=self.timeout_seconds) as response:
                    payload_text = response.read().decode("utf-8", errors="replace")
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
            source_key = summarize_source(url)
            self.sources_touched.add(source_key)
            stats = self.latencies_ms_by_source[source_key]
            stats["count"] += 1
            stats["total_ms"] += elapsed_ms
            stats["max_ms"] = max(stats["max_ms"], elapsed_ms)
            return payload_text

        raise RuntimeError(f"Failed to fetch {url}")

    def _ensure_allowed(self, url: str, host: str) -> None:
        parser = self._robots_by_host.get(host)
        if parser is None:
            robots_url = f"{urllib.parse.urlparse(url).scheme}://{host}/robots.txt"
            request = urllib.request.Request(
                robots_url,
                headers={
                    "User-Agent": self.user_agent,
                    "Accept": "text/plain,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Referer": f"{urllib.parse.urlparse(url).scheme}://{host}/",
                },
            )
            with self._opener.open(request, timeout=self.timeout_seconds) as response:
                payload_text = response.read().decode("utf-8", errors="replace")
            parser = urllib.robotparser.RobotFileParser()
            parser.parse(payload_text.splitlines())
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


def summarize_source(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    path = parsed.path or "/"
    if path.startswith("/show-profile/"):
        path = "/show-profile/*"
    elif path.startswith("/affidavit-pdf-download/"):
        path = "/affidavit-pdf-download/*"
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def extract_csrf_token(page_html: str) -> str:
    match = re.search(
        r'<meta name="csrf-token" content="([^"]+)"',
        page_html,
        re.IGNORECASE,
    )
    if not match:
        raise ValueError("Could not extract CSRF token from ECI homepage")
    return match.group(1)


def find_target_election_context(client: ECIClient) -> tuple[ElectionContext, str]:
    homepage = client.get_homepage()
    csrf_token = extract_csrf_token(homepage)
    election_type_options = extract_select_options(homepage, "electionType")

    for election_type_value, election_type_label in election_type_options:
        if not election_type_value or str(TARGET_CONTEST_YEAR) not in election_type_label:
            continue

        election_html = client.post_ajax(
            "/getAllElection",
            {"_token": csrf_token, "electionType": election_type_value},
            referer=f"{ECI_BASE}/",
        )
        election_options = [
            (value, label)
            for value, label in extract_options(election_html)
            if value and "AC - GENERAL" in label.upper()
        ]
        for election_value, election_label in election_options:
            parts = [part.strip() for part in election_value.split("-")]
            if len(parts) < 5:
                continue

            election_id, const_type, elect_type, _election_type_id, db_id = parts[:5]
            state_html = client.post_ajax(
                "/getElectionState",
                {
                    "_token": csrf_token,
                    "electionId": election_id,
                    "constType": const_type,
                    "dbId": db_id,
                    "ElectType": elect_type,
                },
                referer=f"{ECI_BASE}/",
            )
            state_codes = {
                value
                for value, _label in extract_options(state_html)
                if value
            }
            if {"S22", "S25"}.issubset(state_codes):
                return (
                    ElectionContext(
                        election_type_value=election_type_value,
                        election_type_label=election_type_label,
                        election_value=election_value,
                        election_label=election_label,
                        election_id=election_id,
                        const_type=const_type,
                        elect_type=elect_type,
                        db_id=db_id,
                    ),
                    csrf_token,
                )

    raise ValueError(
        "Could not find a 2026 Assembly General election context containing "
        "both Tamil Nadu and West Bengal on the ECI portal",
    )


def load_target_states(requested_codes: list[str]) -> list[str]:
    selected_codes = [code.upper() for code in requested_codes] if requested_codes else []
    if not selected_codes:
        return list(TARGET_STATE_CODES)

    invalid_codes = sorted(set(selected_codes) - set(TARGET_STATE_CODES))
    if invalid_codes:
        raise ValueError(f"Unsupported state codes: {', '.join(invalid_codes)}")
    return sorted(dict.fromkeys(selected_codes))


def build_constituency_refs(
    *,
    client: ECIClient,
    csrf_token: str,
    election: ElectionContext,
    state_code: str,
    map_records: dict[str, dict[int, dict[str, Any]]],
    limit_constituencies: int | None,
) -> tuple[list[ConstituencyReference], list[dict[str, Any]]]:
    eci_state_code = ECI_STATE_CODES[state_code]
    state_name = "Tamil Nadu" if state_code == "TN" else "West Bengal"
    review_queue: list[dict[str, Any]] = []

    phase_html = client.post_ajax(
        "/getElectionPhase",
        {
            "_token": csrf_token,
            "electionId": election.election_id,
            "constType": election.const_type,
            "dbId": election.db_id,
            "ElectType": election.elect_type,
            "st_code": eci_state_code,
        },
        referer=f"{ECI_BASE}/",
    )
    phase_options = [(value, label) for value, label in extract_options(phase_html) if value]
    refs_by_id: dict[str, ConstituencyReference] = {}

    for phase_value, phase_label in phase_options:
        const_html = client.post_ajax(
            "/allConstListPhs",
            {
                "_token": csrf_token,
                "st_code": eci_state_code,
                "electionId": election.election_id,
                "constType": election.const_type,
                "dbId": election.db_id,
                "ElectType": election.elect_type,
                "phaseid": phase_value,
            },
            referer=f"{ECI_BASE}/",
        )
        for raw_constituency_number, constituency_name in extract_options(const_html):
            if not raw_constituency_number:
                continue

            try:
                constituency_number = int(raw_constituency_number)
            except ValueError:
                review_queue.append(
                    {
                        "state_code": state_code,
                        "constituency_id": None,
                        "constituency_name": constituency_name,
                        "candidate_name": None,
                        "party_name": None,
                        "reason": (
                            f"Unexpected constituency option value "
                            f"'{raw_constituency_number}'"
                        ),
                    },
                )
                continue

            constituency_id = f"{state_code}-{constituency_number:03d}"
            if constituency_number not in map_records.get(state_code, {}):
                review_queue.append(
                    {
                        "state_code": state_code,
                        "constituency_id": constituency_id,
                        "constituency_name": constituency_name,
                        "candidate_name": None,
                        "party_name": None,
                        "reason": "Constituency number not present in local map records",
                    },
                )
                continue

            if constituency_id in refs_by_id:
                review_queue.append(
                    {
                        "state_code": state_code,
                        "constituency_id": constituency_id,
                        "constituency_name": constituency_name,
                        "candidate_name": None,
                        "party_name": None,
                        "reason": (
                            "Constituency appeared in multiple ECI phases; "
                            "manual review required"
                        ),
                    },
                )
                continue

            refs_by_id[constituency_id] = ConstituencyReference(
                state_code=state_code,
                state_name=state_name,
                eci_state_code=eci_state_code,
                phase_value=phase_value,
                phase_label=phase_label,
                constituency_number=constituency_number,
                constituency_id=constituency_id,
                constituency_name=constituency_name,
            )

    refs = sorted(refs_by_id.values(), key=lambda item: item.constituency_id)
    if limit_constituencies is not None:
        refs = refs[:limit_constituencies]

    return refs, review_queue


def extract_first(pattern: str, text: str) -> str | None:
    match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    return clean_html_text(match.group(1))


def parse_candidate_cards(page_html: str) -> list[CandidateCard]:
    table_match = re.search(
        r"<tbody>(.*?)</tbody>",
        page_html,
        re.IGNORECASE | re.DOTALL,
    )
    table_html = table_match.group(1) if table_match else page_html
    cards: list[CandidateCard] = []

    for row_html in ROW_PATTERN.findall(table_html):
        if "/show-profile/" not in row_html:
            continue

        profile_url_match = re.search(
            r'href="(https://affidavit\.eci\.gov\.in/show-profile/[^"]+)"',
            row_html,
            re.IGNORECASE,
        )
        if not profile_url_match:
            continue

        name = extract_first(r'<h4[^>]*>(.*?)</h4>', row_html)
        party_name = extract_first(r"<strong>Party :</strong>\s*(.*?)</p>", row_html)
        status = extract_first(r"<strong>Status :</strong>.*?<font[^>]*>(.*?)</font>", row_html)
        state_name = extract_first(r"<strong>State :</strong>\s*(.*?)</p>", row_html)
        constituency_name = extract_first(
            r"<strong>Constituency :</strong>\s*(.*?)</p>",
            row_html,
        )
        if not all((name, party_name, status, state_name, constituency_name)):
            continue

        cards.append(
            CandidateCard(
                name=name,
                party_name=party_name,
                status=status,
                state_name=state_name,
                constituency_name=constituency_name,
                profile_url=profile_url_match.group(1),
            ),
        )

    return cards


def extract_profile_column_value(profile_html: str, label: str) -> str | None:
    escaped = re.escape(label)
    patterns = [
        rf"<label[^>]*>\s*<p>\s*(?:<strong>\s*)?{escaped}:\s*(?:</strong>\s*)?(?:</p>)?\s*</label>\s*</div>\s*<div class=\"col-sm-6\">\s*(.*?)\s*</div>",
        rf"<label[^>]*>\s*<p>\s*{escaped}:\s*(?:</p>)?\s*</label>\s*<div class=\"col-sm-6\">\s*(.*?)\s*</div>",
    ]
    for pattern in patterns:
        match = re.search(pattern, profile_html, re.IGNORECASE | re.DOTALL)
        if match:
            value = clean_html_text(match.group(1))
            return value or None
    return None


def extract_pdf_token(profile_html: str) -> str | None:
    for input_tag in re.findall(r"<input\b[^>]*>", profile_html, re.IGNORECASE | re.DOTALL):
        if 'id="pdfUrl' not in input_tag:
            continue
        value_match = re.search(r'value="([^"]+)"', input_tag, re.IGNORECASE)
        if value_match:
            return value_match.group(1)
    return None


def build_affidavit_source_url(pdf_token: str | None) -> str | None:
    if not pdf_token:
        return None
    return f"{ECI_BASE}/affidavit-pdf-download/{urllib.parse.quote(pdf_token, safe='')}"


def fetch_constituency_candidates(
    *,
    client: ECIClient,
    csrf_token: str,
    election: ElectionContext,
    constituency: ConstituencyReference,
) -> str:
    return client.post_form(
        "/CandidateCustomFilter",
        {
            "_token": csrf_token,
            "electionType": election.election_type_value,
            "election": election.election_value,
            "states": constituency.eci_state_code,
            "phase": constituency.phase_value,
            "constId": str(constituency.constituency_number),
            "submitName": "6",
        },
        referer=f"{ECI_BASE}/",
    )


def build_candidate_record(
    *,
    constituency: ConstituencyReference,
    card: CandidateCard,
    profile_html: str,
    party_id: str,
    retrieved_at: str,
    seed_incumbents: dict[str, dict[str, str | None]],
) -> dict[str, Any]:
    profile_name = extract_profile_column_value(profile_html, "Name")
    profile_party_name = extract_profile_column_value(profile_html, "Party Name")
    gender = extract_profile_column_value(profile_html, "Gender")
    age = parse_int(extract_profile_column_value(profile_html, "Age"))
    pdf_token = extract_pdf_token(profile_html)
    affidavit_source_url = build_affidavit_source_url(pdf_token)

    resolved_name = profile_name or card.name
    resolved_party_name = profile_party_name or card.party_name
    readability_flags: list[str] = []

    if (
        profile_name
        and normalize_lookup_key(profile_name) != normalize_lookup_key(card.name)
    ):
        readability_flags.append("profile_name_mismatch")
    if (
        profile_party_name
        and normalize_lookup_key(profile_party_name)
        != normalize_lookup_key(card.party_name)
    ):
        readability_flags.append("profile_party_name_mismatch")
    if affidavit_source_url is None:
        readability_flags.append("missing_affidavit_pdf")

    seed_incumbent = seed_incumbents.get(constituency.constituency_id)
    incumbent: bool | None = None
    term_start: str | None = None
    if seed_incumbent:
        if normalize_lookup_key(resolved_name) == seed_incumbent["normalized_name"]:
            incumbent = True
            term_start = seed_incumbent["term_start"]
        else:
            incumbent = False

    record = {
        "_meta": {
            "data_quality": {
                "missing_fields": [],
                "readability_flags": readability_flags,
            },
            "last_updated": retrieved_at,
            "sources": [
                build_source_reference(
                    card.profile_url,
                    f"ECI Candidate Profile - {resolved_name}",
                    retrieved_at,
                ),
            ],
        },
        "affidavit_source_url": affidavit_source_url,
        "age": age,
        "assets_total_inr": None,
        "constituency_id": constituency.constituency_id,
        "contest_year": TARGET_CONTEST_YEAR,
        "criminal_cases": None,
        "education": None,
        "gender": gender,
        "id": f"{constituency.constituency_id}-{slugify(resolved_name)}",
        "incumbent": incumbent,
        "liabilities_total_inr": None,
        "name": resolved_name,
        "office": "MLA",
        "party_id": party_id,
        "profession_self": None,
        "profession_spouse": None,
        "profile_urls": [
            {
                "url": card.profile_url,
                "name": f"ECI Candidate Profile - {resolved_name}",
            },
        ],
        "term_start": term_start,
    }

    if affidavit_source_url is not None:
        record["_meta"]["sources"].append(
            build_source_reference(
                affidavit_source_url,
                f"ECI Affidavit PDF - {resolved_name}",
                retrieved_at,
            ),
        )

    missing_fields = [
        field_name
        for field_name in (
            "incumbent",
            "term_start",
            "age",
            "gender",
            "education",
            "profession_self",
            "profession_spouse",
            "assets_total_inr",
            "liabilities_total_inr",
            "criminal_cases",
            "affidavit_source_url",
        )
        if record[field_name] is None
    ]
    record["_meta"]["data_quality"]["missing_fields"] = missing_fields

    if normalize_lookup_key(resolved_party_name) != normalize_lookup_key(card.party_name):
        record["_meta"]["data_quality"]["readability_flags"].append(
            "profile_party_name_used",
        )

    return record


def print_summary(
    *,
    dry_run: bool,
    records_by_constituency: dict[str, list[dict[str, Any]]],
    review_queue: list[dict[str, Any]],
    failures: list[dict[str, Any]],
    report_path: Path | None,
) -> None:
    mode_label = "dry-run" if dry_run else "write"
    total_records = sum(len(records) for records in records_by_constituency.values())
    state_counts: dict[str, int] = defaultdict(int)
    state_constituencies: dict[str, int] = defaultdict(int)
    for constituency_id, records in records_by_constituency.items():
        state_code = constituency_id.split("-", 1)[0]
        state_constituencies[state_code] += 1
        state_counts[state_code] += len(records)

    print(f"[{PIPELINE_NAME}] completed in {mode_label} mode")
    print(f"Constituency files built: {len(records_by_constituency)}")
    print(f"Candidate records built: {total_records}")

    if state_counts:
        print("Per-state counts:")
        for state_code in sorted(state_counts):
            print(
                f"  - {state_code}: {state_counts[state_code]} candidates across "
                f"{state_constituencies[state_code]} constituencies",
            )

    if review_queue:
        print(f"Review queue entries: {len(review_queue)}")
        for entry in review_queue[:10]:
            print(
                "  - "
                f"{entry['reason']} "
                f"({entry['state_code']}::{entry.get('constituency_id') or 'unknown'}"
                f"::{entry.get('candidate_name') or 'unknown'})",
            )

    if failures:
        print(f"Failures: {len(failures)}")
        for failure in failures[:10]:
            print(
                "  - "
                f"{failure['reason']} "
                f"({failure.get('state_code', 'unknown')}::"
                f"{failure.get('constituency_id', failure.get('page_url', 'unknown'))})",
            )

    if report_path:
        print(f"Quality report: {report_path.relative_to(REPO_ROOT)}")


def main() -> int:
    args = parse_args()
    started_at = utc_now()
    retrieved_at = started_at.isoformat()

    parties = load_existing_parties()
    aliases = load_aliases()
    parties_by_name, parties_by_short_name = build_name_indexes(parties)
    map_records = load_map_records()
    seed_incumbents = load_seed_incumbents()

    client = ECIClient(build_user_agent())
    election_context, csrf_token = find_target_election_context(client)
    selected_states = load_target_states(args.state)

    records_by_constituency: dict[str, list[dict[str, Any]]] = {}
    review_queue: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    parsed_candidate_cards = 0

    for state_code in selected_states:
        try:
            constituency_refs, constituency_reviews = build_constituency_refs(
                client=client,
                csrf_token=csrf_token,
                election=election_context,
                state_code=state_code,
                map_records=map_records,
                limit_constituencies=args.limit_constituencies,
            )
        except Exception as error:  # noqa: BLE001
            failures.append(
                {
                    "state_code": state_code,
                    "reason": str(error),
                },
            )
            continue

        review_queue.extend(constituency_reviews)

        for constituency in constituency_refs:
            try:
                result_html = fetch_constituency_candidates(
                    client=client,
                    csrf_token=csrf_token,
                    election=election_context,
                    constituency=constituency,
                )
            except Exception as error:  # noqa: BLE001
                failures.append(
                    {
                        "state_code": state_code,
                        "constituency_id": constituency.constituency_id,
                        "reason": str(error),
                    },
                )
                continue

            cards = parse_candidate_cards(result_html)
            parsed_candidate_cards += len(cards)
            records: list[dict[str, Any]] = []
            seen_candidate_ids: set[str] = set()

            for card in cards:
                if normalize_lookup_key(card.status) != "accepted":
                    review_queue.append(
                        {
                            "state_code": state_code,
                            "constituency_id": constituency.constituency_id,
                            "constituency_name": constituency.constituency_name,
                            "candidate_name": card.name,
                            "party_name": card.party_name,
                            "reason": (
                                f"Accepted-only filter returned unexpected status "
                                f"'{card.status}'"
                            ),
                        },
                    )
                    continue

                resolution = resolve_party_reference(
                    party_name=card.party_name,
                    parties=parties,
                    aliases=aliases,
                    parties_by_name=parties_by_name,
                    parties_by_short_name=parties_by_short_name,
                )
                if resolution.canonical_party_id is None:
                    review_queue.append(
                        {
                            "state_code": state_code,
                            "constituency_id": constituency.constituency_id,
                            "constituency_name": constituency.constituency_name,
                            "candidate_name": card.name,
                            "party_name": card.party_name,
                            "reason": resolution.reason or "Unknown party resolution error",
                        },
                    )
                    continue

                try:
                    profile_html = client.get_html(
                        card.profile_url,
                        referer=f"{ECI_BASE}/CandidateCustomFilter",
                    )
                except Exception as error:  # noqa: BLE001
                    failures.append(
                        {
                            "state_code": state_code,
                            "constituency_id": constituency.constituency_id,
                            "candidate_name": card.name,
                            "page_url": card.profile_url,
                            "reason": str(error),
                        },
                    )
                    continue

                record = build_candidate_record(
                    constituency=constituency,
                    card=card,
                    profile_html=profile_html,
                    party_id=resolution.canonical_party_id,
                    retrieved_at=retrieved_at,
                    seed_incumbents=seed_incumbents,
                )

                if record["id"] in seen_candidate_ids:
                    review_queue.append(
                        {
                            "state_code": state_code,
                            "constituency_id": constituency.constituency_id,
                            "constituency_name": constituency.constituency_name,
                            "candidate_name": record["name"],
                            "party_name": card.party_name,
                            "reason": (
                                "Stable candidate id collision inside constituency; "
                                "manual review required"
                            ),
                        },
                    )
                    continue

                seen_candidate_ids.add(record["id"])
                records.append(record)

            records_by_constituency[constituency.constituency_id] = sorted(
                records,
                key=lambda record: record["id"],
            )

    finished_at = utc_now()
    report = {
        "pipeline": PIPELINE_NAME,
        "timestamp": timestamp_for_report(finished_at),
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "counts": {
            "fetched": client.request_count,
            "parsed": parsed_candidate_cards,
            "written": 0
            if args.dry_run or review_queue or failures
            else sum(len(records) for records in records_by_constituency.values()),
            "skipped": len(review_queue),
            "constituency_files": len(records_by_constituency),
            "states_processed": len(selected_states),
        },
        "failures": failures,
        "latencies_ms_by_source": {
            source: dict(stats)
            for source, stats in sorted(client.latencies_ms_by_source.items())
        },
        "review_queue": review_queue,
        "sources_touched": sorted(client.sources_touched),
    }

    report_path: Path | None = None
    if not args.dry_run:
        if not review_queue and not failures:
            for constituency_id, records in records_by_constituency.items():
                state_code = constituency_id.split("-", 1)[0]
                write_json(
                    STRUCTURED_CANDIDATES_DIR / state_code / f"{constituency_id}.json",
                    records,
                )
        report_path = write_quality_report(report)

    print_summary(
        dry_run=args.dry_run,
        records_by_constituency=records_by_constituency,
        review_queue=review_queue,
        failures=failures,
        report_path=report_path,
    )

    if review_queue or failures:
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
