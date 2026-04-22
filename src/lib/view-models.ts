import type {
  ConstituencyPanelRecord,
  NationalStateSummary,
  PanelCandidateSummary,
  PanelMlaSummary,
} from "../components/Map/types";
import {
  getSeedCandidate,
  getSeedConstituency,
  getSeedParty,
  getStateElectionStatus,
  listCandidatesByConstituency,
  listConstituencyMapRecordsByState,
  listStateNavigationRecords,
} from "./data";
import { toConstituencyPath, toStatePath, withBase } from "./routing";
import type { SourceReference } from "../types/data";

function mergeSources(...sourceLists: SourceReference[][]): SourceReference[] {
  const seen = new Set<string>();
  return sourceLists.flat().filter((source) => {
    if (seen.has(source.url)) {
      return false;
    }

    seen.add(source.url);
    return true;
  });
}

function buildCandidateSummary(
  candidateId: string,
): PanelMlaSummary | undefined {
  const candidate = getSeedCandidate(candidateId);
  if (!candidate) {
    return undefined;
  }

  const party = getSeedParty(candidate.party_id);
  return {
    name: candidate.name,
    office: candidate.office,
    termStart: candidate.term_start,
    partyName: party?.name ?? candidate.party_id,
    partyShortName: party?.short_name ?? candidate.party_id,
    partyColor: party?.color ?? "#334155",
    profileUrls: candidate.profile_urls,
  };
}

function buildCandidateList(constituencyId: string): PanelCandidateSummary[] {
  return listCandidatesByConstituency(constituencyId).map((candidate) => {
    const party = getSeedParty(candidate.party_id);
    return {
      id: candidate.id,
      name: candidate.name,
      partyName: party?.name ?? candidate.party_id,
      partyShortName: party?.short_name ?? candidate.party_id,
      partyColor: party?.color ?? "#334155",
      office: candidate.office,
      incumbent: candidate.incumbent,
      profileUrls: candidate.profile_urls,
    };
  });
}

export function buildNationalStateSummaries(
  baseUrl: string,
): NationalStateSummary[] {
  return listStateNavigationRecords().map((record) => {
    const status = getStateElectionStatus(record.code);
    return {
      code: record.code,
      name: record.name,
      hasAssembly: record.has_assembly,
      scheduleStatus: status?.schedule_status ?? "pending",
      monthsToElection: status?.months_to_election ?? null,
      statusLabel:
        status?.status_label ??
        (record.has_assembly
          ? "Awaiting official ECI schedule."
          : "No legislative assembly for this territory."),
      href:
        record.has_assembly && record.state_route_mode !== "not_applicable"
          ? withBase(baseUrl, toStatePath(record.code))
          : undefined,
    };
  });
}

export function buildConstituencyPanels(
  stateCode: string,
): ConstituencyPanelRecord[] {
  return listConstituencyMapRecordsByState(stateCode).map((record) => {
    const seededConstituency = getSeedConstituency(record.id);
    const mla = seededConstituency
      ? buildCandidateSummary(seededConstituency.current_mla_id)
      : undefined;

    return {
      slug: record.slug,
      id: record.id,
      stateCode: record.state_code,
      number: record.number,
      name: seededConstituency?.name ?? record.name,
      district: seededConstituency?.district ?? record.district,
      summary: seededConstituency?.summary,
      reservation: seededConstituency?.reservation,
      latestElectionYear: seededConstituency?.latest_election_year,
      hasSeedData: Boolean(seededConstituency),
      mla,
      candidates: seededConstituency
        ? buildCandidateList(seededConstituency.id)
        : [],
      sources: mergeSources(
        seededConstituency ? seededConstituency._meta.sources : [],
        record._meta.sources,
      ),
    };
  });
}

export function getCanonicalConstituencyHref(
  baseUrl: string,
  slug: string,
): string {
  return withBase(baseUrl, toConstituencyPath(slug));
}
