import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  CandidateRecord,
  ConstituencyMapRecord,
  ConstituencyRecord,
  PartyRecord,
  StateElectionStatusRecord,
  StateNavigationRecord,
  StateRecord,
} from "../types/data";

const dataRoot = fileURLToPath(new URL("../../data/", import.meta.url));

function readJsonFile<T>(...segments: string[]): T {
  const filePath = resolve(dataRoot, ...segments);
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function listJsonFiles(...segments: string[]): string[] {
  const directoryPath = resolve(dataRoot, ...segments);
  if (!existsSync(directoryPath)) {
    return [];
  }

  return readdirSync(directoryPath)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();
}

export function listStateCodes(): string[] {
  return listJsonFiles("states").map((fileName) =>
    fileName.replace(".json", ""),
  );
}

export function getState(code: string): StateRecord {
  return readJsonFile<StateRecord>("states", `${code}.json`);
}

export function getSeedState(code: string): StateRecord | null {
  const filePath = resolve(dataRoot, "states", `${code}.json`);
  if (!existsSync(filePath)) {
    return null;
  }

  return readJsonFile<StateRecord>("states", `${code}.json`);
}

export function listConstituenciesByState(
  stateCode: string,
): ConstituencyRecord[] {
  return listJsonFiles("constituencies", stateCode)
    .map((fileName) =>
      readJsonFile<ConstituencyRecord>("constituencies", stateCode, fileName),
    )
    .sort((left, right) => left.number - right.number);
}

export function listConstituencyIds(): string[] {
  return listStateCodes().flatMap((stateCode) =>
    listConstituenciesByState(stateCode).map((constituency) => constituency.id),
  );
}

export function getConstituency(id: string): ConstituencyRecord {
  const [stateCode] = id.split("-");
  return readJsonFile<ConstituencyRecord>(
    "constituencies",
    stateCode,
    `${id}.json`,
  );
}

export function getSeedConstituency(id: string): ConstituencyRecord | null {
  const [stateCode] = id.split("-");
  const filePath = resolve(dataRoot, "constituencies", stateCode, `${id}.json`);
  if (!existsSync(filePath)) {
    return null;
  }

  return readJsonFile<ConstituencyRecord>(
    "constituencies",
    stateCode,
    `${id}.json`,
  );
}

export function getCandidate(id: string): CandidateRecord {
  return readJsonFile<CandidateRecord>("candidates", `${id}.json`);
}

export function getSeedCandidate(id: string): CandidateRecord | null {
  const filePath = resolve(dataRoot, "candidates", `${id}.json`);
  if (!existsSync(filePath)) {
    return null;
  }

  return readJsonFile<CandidateRecord>("candidates", `${id}.json`);
}

export function getParty(id: string): PartyRecord {
  return readJsonFile<PartyRecord>("parties", `${id}.json`);
}

export function getSeedParty(id: string): PartyRecord | null {
  const filePath = resolve(dataRoot, "parties", `${id}.json`);
  if (!existsSync(filePath)) {
    return null;
  }

  return readJsonFile<PartyRecord>("parties", `${id}.json`);
}

export function listCandidatesByConstituency(
  constituencyId: string,
): CandidateRecord[] {
  return listJsonFiles("candidates")
    .map((fileName) => readJsonFile<CandidateRecord>("candidates", fileName))
    .filter((candidate) => candidate.constituency_id === constituencyId)
    .sort((left, right) => Number(right.incumbent) - Number(left.incumbent));
}

export function listStateNavigationRecords(): StateNavigationRecord[] {
  return readJsonFile<StateNavigationRecord[]>("navigation", "states.json");
}

export function getStateNavigation(
  codeOrSlug: string,
): StateNavigationRecord | undefined {
  const normalizedCode = codeOrSlug.toUpperCase();
  return listStateNavigationRecords().find(
    (record) => record.code === normalizedCode,
  );
}

export function listStateElectionStatuses(): StateElectionStatusRecord[] {
  return readJsonFile<StateElectionStatusRecord[]>(
    "elections",
    "state-election-status.json",
  );
}

export function getStateElectionStatus(
  codeOrSlug: string,
): StateElectionStatusRecord | undefined {
  const normalizedCode = codeOrSlug.toUpperCase();
  return listStateElectionStatuses().find(
    (record) => record.code === normalizedCode,
  );
}

export function listConstituencyMapRecords(): ConstituencyMapRecord[] {
  return readJsonFile<ConstituencyMapRecord[]>("maps", "constituencies.json");
}

export function listConstituencyMapRecordsByState(
  codeOrSlug: string,
): ConstituencyMapRecord[] {
  const normalizedCode = codeOrSlug.toUpperCase();
  return listConstituencyMapRecords()
    .filter((record) => record.state_code === normalizedCode)
    .sort((left, right) => left.number - right.number);
}

export function getConstituencyMapRecordBySlug(
  slugOrId: string,
): ConstituencyMapRecord | undefined {
  const normalizedSlug = slugOrId.toLowerCase();
  return listConstituencyMapRecords().find(
    (record) =>
      record.slug === normalizedSlug || record.id === slugOrId.toUpperCase(),
  );
}
