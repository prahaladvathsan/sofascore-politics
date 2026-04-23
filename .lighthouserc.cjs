/* global process, module */

const repoName =
  process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "political-report-card";
const basePath = `/${repoName}/`;
const chromeProfileDir =
  process.env.LHCI_CHROME_PROFILE_DIR ??
  `${process.cwd()}\\.tmp\\lhci-chrome-profile`;
const managedChromePort = Number.parseInt(
  process.env.LHCI_CHROME_PORT ?? "",
  10,
);
const useLegacyHeadless =
  process.platform === "linux" && Boolean(process.env.CI);
const chromeFlags = [
  `--user-data-dir=${chromeProfileDir}`,
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
]
  .filter(Boolean)
  .join(" ");

module.exports = {
  ci: {
    collect: {
      headful: useLegacyHeadless,
      numberOfRuns: 1,
      startServerCommand: "npm run preview -- --host 127.0.0.1 --port 4321",
      startServerReadyPattern: "Local",
      url: [`http://127.0.0.1:4321${basePath}`],
      settings: {
        formFactor: "mobile",
        throttlingMethod: "simulate",
        screenEmulation: {
          mobile: true,
          width: 390,
          height: 844,
          deviceScaleFactor: 2,
          disabled: false,
        },
        ...(Number.isFinite(managedChromePort) && managedChromePort > 0
          ? { port: managedChromePort }
          : {}),
        chromeFlags,
      },
    },
    assert: {
      assertions: {
        "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
        "errors-in-console": "error",
      },
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci",
    },
  },
};
