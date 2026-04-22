import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const sourceDir = resolve("data");
const publicDir = resolve("public");
const targetDir = resolve(publicDir, "data");

if (!existsSync(sourceDir)) {
  console.warn("No root data directory found; skipping sync.");
  process.exit(0);
}

mkdirSync(publicDir, { recursive: true });
rmSync(targetDir, { force: true, recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });
console.log(`Synced data directory to ${targetDir}`);
