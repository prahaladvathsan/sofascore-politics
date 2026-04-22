import type { SourceReference } from "../../types/data";

export interface NationalStateSummary {
  code: string;
  name: string;
  hasAssembly: boolean;
  scheduleStatus: "officially_announced" | "pending";
  monthsToElection: number | null;
  statusLabel: string;
  href?: string;
}

export interface PanelCandidateSummary {
  id: string;
  name: string;
  partyName: string;
  partyShortName: string;
  partyColor: string;
  office: string;
  incumbent: boolean;
  profileUrls: string[];
}

export interface PanelMlaSummary {
  name: string;
  office: string;
  termStart: string;
  partyName: string;
  partyShortName: string;
  partyColor: string;
  profileUrls: string[];
}

export interface ConstituencyPanelRecord {
  slug: string;
  id: string;
  stateCode: string;
  number: number;
  name: string;
  district?: string;
  summary?: string;
  reservation?: string;
  latestElectionYear?: number;
  hasSeedData: boolean;
  mla?: PanelMlaSummary;
  candidates: PanelCandidateSummary[];
  sources: SourceReference[];
}

export interface StateMapExperienceProps {
  basePath: string;
  geometryPath: string;
  stateCode: string;
  stateName: string;
  statusLabel: string;
  mode: "browse" | "focus";
  selectedSlug?: string;
  panels: ConstituencyPanelRecord[];
}
