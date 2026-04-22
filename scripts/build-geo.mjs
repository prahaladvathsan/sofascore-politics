import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import mapshaper from "mapshaper";
import shapefile from "shapefile";

import {
  DATAMEET_COMMIT,
  DATAMEET_CONSTITUENCY_SOURCES,
  DATAMEET_STATE_SOURCES,
  GEO_BUDGETS,
  OFFICIAL_SCHEDULES,
  RETRIEVED_AT,
  STATE_DEFINITIONS,
} from "./build-geo-config.mjs";

const geojsonRoot = resolve(
  "data",
  "geo",
  "source",
  "datameet",
  "website",
  "docs",
  "data",
  "geojson",
);
const stateSourcePath = resolve(
  "data",
  "geo",
  "source",
  "datameet",
  "States",
  "Admin2.shp",
);
const optimizedDir = resolve("data", "geo", "optimized");
const navigationDir = resolve("data", "navigation");
const mapsDir = resolve("data", "maps");
const electionsDir = resolve("data", "elections");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeCompactJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value), "utf8");
}

async function readShapefileAsFeatureCollection(filePath) {
  const source = await shapefile.open(filePath);
  const features = [];
  for (;;) {
    const result = await source.read();
    if (result.done) {
      break;
    }

    features.push({
      type: "Feature",
      geometry: result.value.geometry,
      properties: result.value.properties,
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

function padSeatNumber(value) {
  return String(value).padStart(3, "0");
}

function toTitleCase(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .toLowerCase()
    .split(" ")
    .map((segment) =>
      segment.length === 0
        ? segment
        : `${segment[0].toUpperCase()}${segment.slice(1)}`,
    )
    .join(" ")
    .replace(/\bAnd\b/g, "and");
}

function normaliseConstituencyName(value) {
  return toTitleCase(value).replace(/\s+\((sc|st)\)$/i, "");
}

async function runMapshaper(command, input) {
  return mapshaper.applyCommands(command, input);
}

function monthsUntil(dateString) {
  const now = new Date();
  const target = new Date(`${dateString}T00:00:00+05:30`);
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) {
    return 0;
  }

  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return Math.round((diffDays / 30.4375) * 100) / 100;
}

function assertBudget(filePath, maxBytes) {
  const size = statSync(filePath).size;
  if (size > maxBytes) {
    throw new Error(
      `${filePath} is ${size} bytes, which exceeds the budget of ${maxBytes} bytes.`,
    );
  }
}

function buildStateNavigationRecords(stateGeojson) {
  return stateGeojson.features
    .map((feature) => {
      const definition = STATE_DEFINITIONS[feature.properties.ST_NM];
      if (!definition) {
        throw new Error(
          `Missing STATE_DEFINITIONS entry for ${feature.properties.ST_NM}.`,
        );
      }

      return {
        code: definition.code,
        name: definition.name,
        type: definition.type,
        has_assembly: definition.has_assembly,
        state_route_mode: definition.state_route_mode,
        theme: definition.theme,
        _meta: {
          source_note:
            "Theme and route mode fields are application metadata layered on top of Datameet geometry.",
          sources: DATAMEET_STATE_SOURCES,
        },
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildElectionStatusRecords() {
  return Object.entries(OFFICIAL_SCHEDULES)
    .map(([code, schedule]) => ({
      code,
      schedule_status: "officially_announced",
      official_date: schedule.official_date,
      months_to_election: monthsUntil(schedule.official_date),
      status_label: schedule.status_label,
      _meta: {
        source_note:
          "States not listed in this file fall back to a pending bucket until the ECI announces a schedule.",
        sources: schedule.sources,
      },
    }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

function buildConstituencyMapRecords(acGeojson) {
  return acGeojson.features
    .filter(
      (feature) =>
        feature.properties.state_code === "TN" ||
        feature.properties.state_code === "WB",
    )
    .map((feature) => {
      const stateCode = feature.properties.state_code;
      const number = Number(feature.properties.AC_NO);
      const id = `${stateCode}-${padSeatNumber(number)}`;
      const slug = id.toLowerCase();
      const district = feature.properties.DIST_NAME ?? undefined;

      return {
        id,
        state_code: stateCode,
        number,
        name: feature.properties.AC_NAME,
        district,
        feature_key: `${stateCode}_${padSeatNumber(number)}`,
        slug,
        _meta: {
          source_note:
            "Seed constituency overlays are maintained separately from the geometry-backed navigation index.",
          sources: DATAMEET_CONSTITUENCY_SOURCES,
        },
      };
    })
    .sort((left, right) =>
      left.state_code === right.state_code
        ? left.number - right.number
        : left.state_code.localeCompare(right.state_code),
    );
}

function prepareConstituencySource(acGeojson) {
  return {
    ...acGeojson,
    features: acGeojson.features
      .filter(
        (feature) =>
          feature.properties.ST_NAME === "TAMIL NADU" ||
          feature.properties.ST_NAME === "WEST BENGAL",
      )
      .map((feature) => {
        const stateCode =
          feature.properties.ST_NAME === "TAMIL NADU" ? "TN" : "WB";
        const number = Number(feature.properties.AC_NO);
        return {
          ...feature,
          properties: {
            feature_key: `${stateCode}_${padSeatNumber(number)}`,
            state_code: stateCode,
            AC_NO: number,
            AC_NAME: normaliseConstituencyName(feature.properties.AC_NAME),
            DIST_NAME: feature.properties.DIST_NAME
              ? toTitleCase(feature.properties.DIST_NAME)
              : null,
          },
        };
      }),
  };
}

async function buildOptimizedTopology(
  inputName,
  inputContent,
  outputPath,
  outputName,
  percent,
  filterExpression,
  extraCommands = "",
) {
  let command = `-i "${inputName}" `;
  if (extraCommands) {
    command += `${extraCommands} `;
  }
  if (filterExpression) {
    command += `-filter "${filterExpression}" `;
  }
  command +=
    `-simplify dp ${percent} keep-shapes ` +
    `-o format=topojson quantization=10000 ${outputName}`;

  const output =
    inputContent === null
      ? await runMapshaper(command)
      : await runMapshaper(command, {
          [inputName]: inputContent,
        });
  writeFileSync(outputPath, output[outputName], "utf8");
}

function rewriteStateTopology(filePath, recordsByCode) {
  const topology = readJson(filePath);
  const objectKey = Object.keys(topology.objects)[0];
  topology.objects[objectKey].geometries = topology.objects[
    objectKey
  ].geometries.map((geometry) => {
    const definition = STATE_DEFINITIONS[geometry.properties.ST_NM];
    const record = recordsByCode.get(definition.code);
    return {
      ...geometry,
      properties: {
        code: record.code,
        slug: record.code.toLowerCase(),
        name: record.name,
        type: record.type,
        has_assembly: record.has_assembly,
        state_route_mode: record.state_route_mode,
      },
    };
  });

  writeCompactJson(filePath, topology);
}

function rewriteConstituencyTopology(filePath, recordsByKey) {
  const topology = readJson(filePath);
  const objectKey = Object.keys(topology.objects)[0];
  topology.objects[objectKey].geometries = topology.objects[
    objectKey
  ].geometries.map((geometry) => {
    const record = recordsByKey.get(geometry.properties.feature_key);
    return {
      ...geometry,
      properties: {
        id: record.id,
        slug: record.slug,
        state_code: record.state_code,
        number: record.number,
        name: record.name,
        district: record.district ?? null,
        feature_key: record.feature_key,
      },
    };
  });

  writeCompactJson(filePath, topology);
}

mkdirSync(optimizedDir, { recursive: true });
mkdirSync(navigationDir, { recursive: true });
mkdirSync(mapsDir, { recursive: true });
mkdirSync(electionsDir, { recursive: true });

const stateGeojson = await readShapefileAsFeatureCollection(stateSourcePath);
const constituencyGeojson = prepareConstituencySource(
  readJson(resolve(geojsonRoot, "ac.geojson")),
);

const navigationRecords = buildStateNavigationRecords(stateGeojson);
const electionStatusRecords = buildElectionStatusRecords();
const constituencyMapRecords = buildConstituencyMapRecords(constituencyGeojson);

writeJson(resolve(navigationDir, "states.json"), navigationRecords);
writeJson(
  resolve(electionsDir, "state-election-status.json"),
  electionStatusRecords,
);
writeJson(resolve(mapsDir, "constituencies.json"), constituencyMapRecords);

const indiaOutput = resolve(optimizedDir, "india-states.topojson");
const tnOutput = resolve(optimizedDir, "tn-assembly.topojson");
const wbOutput = resolve(optimizedDir, "wb-assembly.topojson");

await buildOptimizedTopology(
  stateSourcePath,
  null,
  indiaOutput,
  "india-states.topojson",
  "2%",
  null,
  "-filter-fields ST_NM",
);
await buildOptimizedTopology(
  "constituencies.source.geojson",
  JSON.stringify(constituencyGeojson),
  tnOutput,
  "tn-assembly.topojson",
  "1%",
  "state_code == 'TN'",
);
await buildOptimizedTopology(
  "constituencies.source.geojson",
  JSON.stringify(constituencyGeojson),
  wbOutput,
  "wb-assembly.topojson",
  "1%",
  "state_code == 'WB'",
);

const navigationByCode = new Map(
  navigationRecords.map((record) => [record.code, record]),
);
const constituencyByKey = new Map(
  constituencyMapRecords.map((record) => [record.feature_key, record]),
);

rewriteStateTopology(indiaOutput, navigationByCode);
rewriteConstituencyTopology(tnOutput, constituencyByKey);
rewriteConstituencyTopology(wbOutput, constituencyByKey);

assertBudget(indiaOutput, GEO_BUDGETS.national);
assertBudget(tnOutput, GEO_BUDGETS.state);
assertBudget(wbOutput, GEO_BUDGETS.state);

console.log(
  `Built optimized Datameet geometry from commit ${DATAMEET_COMMIT} and refreshed navigation datasets at ${RETRIEVED_AT}.`,
);
