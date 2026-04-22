import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  CandidateRecord,
  ConstituencyRecord,
  PartyRecord,
  StateRecord,
} from "../types/data";

const dataRoot = fileURLToPath(new URL("../../data/", import.meta.url));

function readJsonFile<T>(...segments: string[]): T {
  const filePath = resolve(dataRoot, ...segments);
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function listJsonFiles(...segments: string[]): string[] {
  return readdirSync(resolve(dataRoot, ...segments))
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

export function getCandidate(id: string): CandidateRecord {
  return readJsonFile<CandidateRecord>("candidates", `${id}.json`);
}

export function getParty(id: string): PartyRecord {
  return readJsonFile<PartyRecord>("parties", `${id}.json`);
}
