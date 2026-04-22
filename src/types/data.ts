export interface SourceReference {
  url: string;
  name: string;
  retrieved_at: string;
}

export interface DataMeta {
  source_note?: string;
  sources: SourceReference[];
}

export interface StateRecord {
  id: string;
  code: string;
  name: string;
  type: "state" | "union_territory";
  assembly_seats_total: number;
  seed_constituency_ids: string[];
  theme: {
    primary: string;
    accent: string;
  };
  _meta: DataMeta;
}

export interface ConstituencyRecord {
  id: string;
  state_code: string;
  number: number;
  name: string;
  district: string;
  reservation: "GEN" | "SC" | "ST";
  current_mla_id: string;
  current_party_id: string;
  latest_election_year: number;
  summary: string;
  _meta: DataMeta;
}

export interface CandidateRecord {
  id: string;
  name: string;
  party_id: string;
  constituency_id: string;
  office: string;
  incumbent: boolean;
  term_start: string;
  profile_urls: string[];
  _meta: DataMeta;
}

export interface PartyRecord {
  id: string;
  name: string;
  short_name: string;
  color: string;
  official_url: string;
  _meta: DataMeta;
}

export interface NewsItemRecord {
  id: string;
  headline: string;
  published_at: string;
  related_entity_ids: string[];
  summary: string;
  url: string;
  _meta: DataMeta;
}

export interface ManifestoPointRecord {
  id: string;
  party_id: string;
  category: string;
  text: string;
  status: "promised" | "in_progress" | "completed" | "unclear";
  _meta: DataMeta;
}
