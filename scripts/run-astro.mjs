import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const astroPackagePath = require.resolve("astro/package.json");
const astroCli = resolve(dirname(astroPackagePath), "astro.js");
const astroArgs = process.argv.slice(2);

const result = spawnSync(process.execPath, [astroCli, ...astroArgs], {
  stdio: "inherit",
  env: {
    ...process.env,
    ASTRO_TELEMETRY_DISABLED: "1",
  },
});

process.exit(result.status ?? 1);
