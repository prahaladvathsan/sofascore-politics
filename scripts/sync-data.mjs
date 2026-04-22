import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";

const sourceDir = resolve("data");
const publicDir = resolve("public");
const targetDir = resolve(publicDir, "data");
const ignoredDirectories = new Set([resolve(sourceDir, "geo", "source")]);

function copyTree(sourcePath, targetPath) {
  if (ignoredDirectories.has(sourcePath)) {
    return;
  }

  mkdirSync(targetPath, { recursive: true });
  for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
    const nextSourcePath = resolve(sourcePath, entry.name);
    const nextTargetPath = resolve(targetPath, entry.name);

    if (entry.isDirectory()) {
      copyTree(nextSourcePath, nextTargetPath);
      continue;
    }

    copyFileSync(nextSourcePath, nextTargetPath);
  }
}

if (!existsSync(sourceDir)) {
  console.warn("No root data directory found; skipping sync.");
  process.exit(0);
}

mkdirSync(publicDir, { recursive: true });
rmSync(targetDir, { force: true, recursive: true });
copyTree(sourceDir, targetDir);
console.log(`Synced data directory to ${targetDir}`);
