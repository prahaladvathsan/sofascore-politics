import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

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
    typeof record.id === "string" && record.id.startsWith("TN-"),
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

const schemaDir = resolve(DATA_DIR, "schemas");
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
    validateCandidate(filePath, record);
  } else if (filePath.includes(resolve("data", "parties"))) {
    validateParty(filePath, record);
  } else if (filePath.includes(resolve("data", "news"))) {
    validateNewsItem(filePath, record);
  } else if (filePath.includes(resolve("data", "manifestos"))) {
    validateManifestoPoint(filePath, record);
  }
}

console.log(`Validated ${files.length} JSON files.`);
