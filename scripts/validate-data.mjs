import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const DATA_DIR = resolve("data");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function walkJsonFiles(dirPath) {
  return readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
    const nextPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      return walkJsonFiles(nextPath);
    }

    return entry.name.endsWith(".json") ? [nextPath] : [];
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertSources(meta, filePath) {
  assert(meta && typeof meta === "object", `${filePath}: missing _meta object`);
  assert(
    Array.isArray(meta.sources),
    `${filePath}: _meta.sources must be an array`,
  );

  for (const [index, source] of meta.sources.entries()) {
    assert(
      typeof source.url === "string" && source.url.startsWith("http"),
      `${filePath}: source ${index} missing url`,
    );
    assert(
      typeof source.name === "string" && source.name.length > 0,
      `${filePath}: source ${index} missing name`,
    );
    assert(
      typeof source.retrieved_at === "string" &&
        !Number.isNaN(Date.parse(source.retrieved_at)),
      `${filePath}: source ${index} has invalid retrieved_at`,
    );
  }
}

function validateState(filePath, record) {
  assert(
    typeof record.code === "string" && record.code.length > 0,
    `${filePath}: state code is required`,
  );
  assert(
    Array.isArray(record.seed_constituency_ids),
    `${filePath}: seed_constituency_ids must be an array`,
  );
  assertSources(record._meta, filePath);
}

function validateConstituency(filePath, record) {
  assert(
    typeof record.id === "string" && /^[A-Z]{2}-\d{3}$/.test(record.id),
    `${filePath}: invalid constituency id`,
  );
  assert(
    Number.isInteger(record.number),
    `${filePath}: number must be an integer`,
  );
  assert(
    typeof record.current_mla_id === "string",
    `${filePath}: current_mla_id is required`,
  );
  assertSources(record._meta, filePath);
}

function validateCandidate(filePath, record) {
  assert(
    typeof record.id === "string",
    `${filePath}: candidate id is required`,
  );
  assert(
    Array.isArray(record.profile_urls),
    `${filePath}: profile_urls must be an array`,
  );
  assertSources(record._meta, filePath);
}

function validateCandidateCollection(filePath, records) {
  assert(
    Array.isArray(records),
    `${filePath}: candidate collection file must be an array`,
  );

  for (const [index, record] of records.entries()) {
    assert(
      record && typeof record === "object",
      `${filePath}: record ${index} must be an object`,
    );
    assert(
      typeof record.id === "string",
      `${filePath}: record ${index} missing id`,
    );
    assert(
      typeof record.party_id === "string" && record.party_id.length > 0,
      `${filePath}: record ${index} missing party_id`,
    );
    assert(
      typeof record.constituency_id === "string" &&
        /^[A-Z]{2}-\d{3}$/.test(record.constituency_id),
      `${filePath}: record ${index} has invalid constituency_id`,
    );
    assert(
      Array.isArray(record.profile_urls),
      `${filePath}: record ${index} profile_urls must be an array`,
    );
    for (const [urlIndex, profileUrl] of record.profile_urls.entries()) {
      assert(
        profileUrl && typeof profileUrl === "object",
        `${filePath}: record ${index} profile_urls[${urlIndex}] must be an object`,
      );
      assert(
        typeof profileUrl.url === "string" && profileUrl.url.startsWith("http"),
        `${filePath}: record ${index} profile_urls[${urlIndex}] missing url`,
      );
      assert(
        typeof profileUrl.name === "string" && profileUrl.name.length > 0,
        `${filePath}: record ${index} profile_urls[${urlIndex}] missing name`,
      );
    }
    assertSources(record._meta, `${filePath} record ${index}`);
  }
}

function validateParty(filePath, record) {
  assert(
    typeof record.short_name === "string",
    `${filePath}: party short_name is required`,
  );
  assert(
    typeof record.color === "string" && record.color.startsWith("#"),
    `${filePath}: color must be hex`,
  );
  assertSources(record._meta, filePath);
}

function validateNewsItem(filePath, record) {
  assert(
    typeof record.headline === "string",
    `${filePath}: headline is required`,
  );
  assertSources(record._meta, filePath);
}

function validateManifestoPoint(filePath, record) {
  assert(
    typeof record.category === "string",
    `${filePath}: category is required`,
  );
  assertSources(record._meta, filePath);
}

function validateStateNavigation(filePath, records) {
  assert(
    Array.isArray(records),
    `${filePath}: navigation file must be an array`,
  );
  for (const [index, record] of records.entries()) {
    assert(
      typeof record.code === "string" && /^[A-Z]{2}$/.test(record.code),
      `${filePath}: record ${index} missing code`,
    );
    assert(
      typeof record.has_assembly === "boolean",
      `${filePath}: record ${index} missing has_assembly`,
    );
    assert(
      ["map", "shell", "not_applicable"].includes(record.state_route_mode),
      `${filePath}: record ${index} has invalid state_route_mode`,
    );
    assert(
      record.theme &&
        typeof record.theme.primary === "string" &&
        record.theme.primary.startsWith("#"),
      `${filePath}: record ${index} missing theme.primary`,
    );
    assertSources(record._meta, `${filePath} record ${index}`);
  }
}

function validateElectionStatuses(filePath, records) {
  assert(
    Array.isArray(records),
    `${filePath}: election status file must be an array`,
  );
  for (const [index, record] of records.entries()) {
    assert(
      typeof record.code === "string" && /^[A-Z]{2}$/.test(record.code),
      `${filePath}: record ${index} missing code`,
    );
    assert(
      record.schedule_status === "officially_announced",
      `${filePath}: record ${index} must be officially_announced`,
    );
    assert(
      typeof record.official_date === "string" &&
        !Number.isNaN(Date.parse(record.official_date)),
      `${filePath}: record ${index} has invalid official_date`,
    );
    assert(
      typeof record.status_label === "string" && record.status_label.length > 0,
      `${filePath}: record ${index} missing status_label`,
    );
    assertSources(record._meta, `${filePath} record ${index}`);
  }
}

function validateConstituencyMapRecords(filePath, records) {
  assert(
    Array.isArray(records),
    `${filePath}: constituency map file must be an array`,
  );
  for (const [index, record] of records.entries()) {
    assert(
      typeof record.id === "string" && /^[A-Z]{2}-\d{3}$/.test(record.id),
      `${filePath}: record ${index} has invalid id`,
    );
    assert(
      typeof record.slug === "string" &&
        record.slug === record.slug.toLowerCase(),
      `${filePath}: record ${index} must use a lowercase slug`,
    );
    assert(
      typeof record.feature_key === "string" && record.feature_key.length > 0,
      `${filePath}: record ${index} missing feature_key`,
    );
    assertSources(record._meta, `${filePath} record ${index}`);
  }
}

function validateQualityReport(filePath, record) {
  assert(
    typeof record.pipeline === "string" && record.pipeline.length > 0,
    `${filePath}: pipeline is required`,
  );
  assert(
    typeof record.started_at === "string" &&
      !Number.isNaN(Date.parse(record.started_at)),
    `${filePath}: started_at must be a valid ISO timestamp`,
  );
  assert(
    typeof record.finished_at === "string" &&
      !Number.isNaN(Date.parse(record.finished_at)),
    `${filePath}: finished_at must be a valid ISO timestamp`,
  );
  assert(
    record.counts && typeof record.counts === "object",
    `${filePath}: counts object is required`,
  );
  for (const field of ["fetched", "parsed", "written", "skipped"]) {
    assert(
      Number.isInteger(record.counts[field]),
      `${filePath}: counts.${field} must be an integer`,
    );
  }
  assert(
    Array.isArray(record.failures),
    `${filePath}: failures must be an array`,
  );
  assert(
    Array.isArray(record.review_queue),
    `${filePath}: review_queue must be an array`,
  );
  assert(
    Array.isArray(record.sources_touched),
    `${filePath}: sources_touched must be an array`,
  );
  assert(
    record.latencies_ms_by_source &&
      typeof record.latencies_ms_by_source === "object" &&
      !Array.isArray(record.latencies_ms_by_source),
    `${filePath}: latencies_ms_by_source must be an object`,
  );
}

const schemaDir = resolve(DATA_DIR, "schemas");
const candidateRoot = resolve("data", "candidates");
assert(
  existsSync(schemaDir) && statSync(schemaDir).isDirectory(),
  "data/schemas is required",
);

const ignoredDirs = [resolve("data", "geo"), resolve("data", "schemas")];
const files = walkJsonFiles(DATA_DIR).filter(
  (filePath) =>
    !ignoredDirs.some((ignoredDir) => filePath.includes(ignoredDir)),
);

for (const filePath of files) {
  const record = readJson(filePath);

  if (filePath.includes(resolve("data", "states"))) {
    validateState(filePath, record);
  } else if (filePath.includes(resolve("data", "constituencies"))) {
    validateConstituency(filePath, record);
  } else if (filePath.includes(resolve("data", "candidates"))) {
    if (dirname(filePath) === candidateRoot) {
      validateCandidate(filePath, record);
    } else {
      validateCandidateCollection(filePath, record);
    }
  } else if (filePath.includes(resolve("data", "incumbents"))) {
    validateCandidateCollection(filePath, record);
  } else if (filePath.includes(resolve("data", "parties"))) {
    if (!basename(filePath).startsWith("_")) {
      validateParty(filePath, record);
    }
  } else if (filePath.includes(resolve("data", "quality-reports"))) {
    if (basename(filePath).startsWith("ingest-")) {
      validateQualityReport(filePath, record);
    }
  } else if (filePath.includes(resolve("data", "news"))) {
    validateNewsItem(filePath, record);
  } else if (filePath.includes(resolve("data", "manifestos"))) {
    validateManifestoPoint(filePath, record);
  } else if (filePath.includes(resolve("data", "navigation"))) {
    validateStateNavigation(filePath, record);
  } else if (filePath.includes(resolve("data", "elections"))) {
    validateElectionStatuses(filePath, record);
  } else if (filePath.includes(resolve("data", "maps"))) {
    validateConstituencyMapRecords(filePath, record);
  }
}

console.log(`Validated ${files.length} JSON files.`);
