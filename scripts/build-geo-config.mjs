export const DATAMEET_COMMIT = "b3fbbde595310b397a55d718e0958ce249a4fa1f";
export const RETRIEVED_AT = "2026-04-23T02:15:00+05:30";

export const GEO_BUDGETS = {
  national: 150 * 1024,
  state: 400 * 1024,
};

export const DATAMEET_STATE_SOURCES = [
  {
    url: `https://github.com/datameet/maps/tree/${DATAMEET_COMMIT}/States`,
    name: "Datameet Admin2 state boundary shapefile",
    retrieved_at: RETRIEVED_AT,
  },
  {
    url: `https://github.com/datameet/maps/blob/${DATAMEET_COMMIT}/website/docs/states/index.md`,
    name: "Datameet state boundary notes",
    retrieved_at: RETRIEVED_AT,
  },
];

export const DATAMEET_CONSTITUENCY_SOURCES = [
  {
    url: `https://github.com/datameet/maps/blob/${DATAMEET_COMMIT}/website/docs/data/geojson/ac.geojson`,
    name: "Datameet assembly constituency GeoJSON",
    retrieved_at: RETRIEVED_AT,
  },
  {
    url: `https://github.com/datameet/maps/blob/${DATAMEET_COMMIT}/assembly-constituencies/README.md`,
    name: "Datameet assembly constituency notes",
    retrieved_at: RETRIEVED_AT,
  },
];

export const OFFICIAL_SCHEDULES = {
  AS: {
    official_date: "2026-04-09",
    status_label: "Poll held on 9 Apr 2026.",
    sources: [
      {
        url: "https://x.com/ECISVEEP/status/1900850458147588178",
        name: "ECI schedule announcement for 2026 assembly elections",
        retrieved_at: RETRIEVED_AT,
      },
    ],
  },
  KL: {
    official_date: "2026-04-09",
    status_label: "Poll held on 9 Apr 2026.",
    sources: [
      {
        url: "https://x.com/ECISVEEP/status/1900850458147588178",
        name: "ECI schedule announcement for 2026 assembly elections",
        retrieved_at: RETRIEVED_AT,
      },
    ],
  },
  PY: {
    official_date: "2026-04-09",
    status_label: "Poll held on 9 Apr 2026.",
    sources: [
      {
        url: "https://x.com/ECISVEEP/status/1900850458147588178",
        name: "ECI schedule announcement for 2026 assembly elections",
        retrieved_at: RETRIEVED_AT,
      },
    ],
  },
  TN: {
    official_date: "2026-04-23",
    status_label: "Poll on 23 Apr 2026.",
    sources: [
      {
        url: "https://x.com/ECISVEEP/status/1900850458147588178",
        name: "ECI schedule announcement for 2026 assembly elections",
        retrieved_at: RETRIEVED_AT,
      },
    ],
  },
  WB: {
    official_date: "2026-04-23",
    status_label: "Phase 1 on 23 Apr 2026 and phase 2 on 29 Apr 2026.",
    sources: [
      {
        url: "https://x.com/ECISVEEP/status/1900850458147588178",
        name: "ECI schedule announcement for 2026 assembly elections",
        retrieved_at: RETRIEVED_AT,
      },
      {
        url: "https://x.com/ECISVEEP/status/1900851874161272932",
        name: "ECI West Bengal phase schedule for 2026 assembly elections",
        retrieved_at: RETRIEVED_AT,
      },
    ],
  },
};

const STATE_THEME_PALETTE = [
  { primary: "#1d4ed8", accent: "#f97316" },
  { primary: "#0f766e", accent: "#f59e0b" },
  { primary: "#9f1239", accent: "#facc15" },
  { primary: "#334155", accent: "#22c55e" },
  { primary: "#7c3aed", accent: "#fb7185" },
  { primary: "#b45309", accent: "#10b981" },
];

function themeFor(code) {
  const index =
    code.split("").reduce((sum, letter) => sum + letter.charCodeAt(0), 0) %
    STATE_THEME_PALETTE.length;
  return STATE_THEME_PALETTE[index];
}

function createStateRecord(code, sourceName, options = {}) {
  const hasAssembly = options.has_assembly ?? true;
  return {
    code,
    source_name: sourceName,
    name: options.name ?? sourceName,
    type: options.type ?? "state",
    has_assembly: hasAssembly,
    state_route_mode: hasAssembly
      ? (options.state_route_mode ??
        (code === "TN" || code === "WB" ? "map" : "shell"))
      : "not_applicable",
    theme: options.theme ?? themeFor(code),
  };
}

export const STATE_DEFINITIONS = {
  "Andaman & Nicobar": createStateRecord("AN", "Andaman & Nicobar", {
    name: "Andaman & Nicobar",
    type: "union_territory",
    has_assembly: false,
  }),
  "Andhra Pradesh": createStateRecord("AP", "Andhra Pradesh"),
  "Arunachal Pradesh": createStateRecord("AR", "Arunachal Pradesh"),
  Assam: createStateRecord("AS", "Assam"),
  Bihar: createStateRecord("BR", "Bihar"),
  Chandigarh: createStateRecord("CH", "Chandigarh", {
    type: "union_territory",
    has_assembly: false,
  }),
  Chhattisgarh: createStateRecord("CG", "Chhattisgarh"),
  "Dadra and Nagar Haveli and Daman and Diu": createStateRecord(
    "DN",
    "Dadra and Nagar Haveli and Daman and Diu",
    {
      type: "union_territory",
      has_assembly: false,
    },
  ),
  Delhi: createStateRecord("DL", "Delhi", {
    type: "union_territory",
  }),
  Goa: createStateRecord("GA", "Goa"),
  Gujarat: createStateRecord("GJ", "Gujarat"),
  Haryana: createStateRecord("HR", "Haryana"),
  "Himachal Pradesh": createStateRecord("HP", "Himachal Pradesh"),
  "Jammu & Kashmir": createStateRecord("JK", "Jammu & Kashmir", {
    type: "union_territory",
  }),
  Jharkhand: createStateRecord("JH", "Jharkhand"),
  Karnataka: createStateRecord("KA", "Karnataka"),
  Kerala: createStateRecord("KL", "Kerala"),
  Ladakh: createStateRecord("LA", "Ladakh", {
    type: "union_territory",
    has_assembly: false,
  }),
  Lakshadweep: createStateRecord("LD", "Lakshadweep", {
    type: "union_territory",
    has_assembly: false,
  }),
  "Madhya Pradesh": createStateRecord("MP", "Madhya Pradesh"),
  Maharashtra: createStateRecord("MH", "Maharashtra"),
  Manipur: createStateRecord("MN", "Manipur"),
  Meghalaya: createStateRecord("ML", "Meghalaya"),
  Mizoram: createStateRecord("MZ", "Mizoram"),
  Nagaland: createStateRecord("NL", "Nagaland"),
  Odisha: createStateRecord("OD", "Odisha"),
  Puducherry: createStateRecord("PY", "Puducherry", {
    type: "union_territory",
  }),
  Punjab: createStateRecord("PB", "Punjab"),
  Rajasthan: createStateRecord("RJ", "Rajasthan"),
  Sikkim: createStateRecord("SK", "Sikkim"),
  "Tamil Nadu": createStateRecord("TN", "Tamil Nadu", {
    theme: { primary: "#7c2d12", accent: "#22c55e" },
  }),
  Telangana: createStateRecord("TS", "Telangana"),
  Tripura: createStateRecord("TR", "Tripura"),
  "Uttar Pradesh": createStateRecord("UP", "Uttar Pradesh"),
  Uttarakhand: createStateRecord("UK", "Uttarakhand"),
  "West Bengal": createStateRecord("WB", "West Bengal", {
    theme: { primary: "#1d4ed8", accent: "#facc15" },
  }),
};
