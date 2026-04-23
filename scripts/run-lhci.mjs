import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { execSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { launch: launchChrome } = require("chrome-launcher");

const tempRoot = resolve(".tmp", "lhci-temp");
const chromeProfileRoot = resolve(".tmp", "lhci-chrome-profile");
mkdirSync(tempRoot, { recursive: true });
mkdirSync(chromeProfileRoot, { recursive: true });
const useLegacyHeadless =
  process.platform === "linux" && Boolean(process.env.CI);

function resolveLinuxChromePath() {
  const preferredPaths = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter(Boolean);

  for (const candidate of preferredPaths) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  for (const executable of [
    "google-chrome-stable",
    "google-chrome",
    "chromium-browser",
    "chromium",
  ]) {
    try {
      const output = execSync(`which ${executable}`, {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
      if (output) {
        return output.split(/\r?\n/, 1)[0];
      }
    } catch {
      // Keep walking the candidate list.
    }
  }

  return process.env.CHROME_PATH;
}

function getManagedChromeFlags() {
  return [
    useLegacyHeadless ? "--headless" : "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    process.platform === "linux" ? "--no-sandbox" : "",
    process.platform === "linux" ? "--disable-dev-shm-usage" : "",
    process.platform === "linux" ? "--disable-setuid-sandbox" : "",
    process.platform === "linux" ? "--disable-gpu" : "",
    process.platform === "linux" ? "--disable-software-rasterizer" : "",
    process.platform === "linux" ? "--disable-crash-reporter" : "",
    process.platform === "linux" ? "--disable-breakpad" : "",
  ].filter(Boolean);
}

const chromePath =
  process.platform === "linux"
    ? resolveLinuxChromePath()
    : process.env.CHROME_PATH;
const useWorkspaceTempDirs =
  process.platform !== "win32" || Boolean(process.env.CI);
const tempEnv = useWorkspaceTempDirs
  ? {
      TEMP: tempRoot,
      TMP: tempRoot,
      TMPDIR: tempRoot,
    }
  : {};
const managedChrome = await launchChrome({
  chromeFlags: getManagedChromeFlags(),
  chromePath,
  logLevel: "silent",
  userDataDir: chromeProfileRoot,
});

const child = spawn(
  process.execPath,
  [
    resolve("node_modules", "@lhci", "cli", "src", "cli.js"),
    "autorun",
    "--config=.lighthouserc.cjs",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...tempEnv,
      CHROME_PATH: chromePath,
      LHCI_CHROME_PORT: String(managedChrome.port),
      LHCI_CHROME_PROFILE_DIR: chromeProfileRoot,
    },
  },
);

child.on("exit", (code, signal) => {
  managedChrome.kill();

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
