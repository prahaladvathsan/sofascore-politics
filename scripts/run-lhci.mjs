import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const tempRoot = resolve(".tmp", "lhci-temp");
const chromeProfileRoot = resolve(".tmp", "lhci-chrome-profile");
mkdirSync(tempRoot, { recursive: true });
mkdirSync(chromeProfileRoot, { recursive: true });

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
      TEMP: tempRoot,
      TMP: tempRoot,
      TMPDIR: tempRoot,
      LHCI_CHROME_PROFILE_DIR: chromeProfileRoot,
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
