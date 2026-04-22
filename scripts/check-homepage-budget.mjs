import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const HOMEPAGE_JS_BUDGET = 150 * 1024;
const distRoot = resolve("dist");
const homepageHtml = readFileSync(resolve(distRoot, "index.html"), "utf8");

function normalizeAssetPath(assetUrl) {
  const pathname = new URL(assetUrl, "https://example.com").pathname.replace(
    /^\/+/,
    "",
  );
  const directPath = resolve(distRoot, pathname);
  if (existsSync(directPath)) {
    return directPath;
  }

  const [, ...rest] = pathname.split("/");
  if (rest.length === 0) {
    return null;
  }

  const strippedPath = resolve(distRoot, rest.join("/"));
  return existsSync(strippedPath) ? strippedPath : null;
}

const assetMatches = Array.from(
  homepageHtml.matchAll(
    /(?:src|href|component-url|renderer-url|before-hydration-url)="([^"]+\.js)"/g,
  ),
).map((match) => match[1]);

const uniqueAssets = [...new Set(assetMatches)]
  .map((assetPath) => normalizeAssetPath(assetPath))
  .filter((assetPath) => assetPath !== null);

const inlineScriptGzipBytes = Array.from(
  homepageHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g),
).reduce(
  (sum, match) => sum + gzipSync(Buffer.from(match[1], "utf8")).byteLength,
  0,
);

const externalScriptGzipBytes = uniqueAssets.reduce((sum, assetPath) => {
  const assetContents = readFileSync(assetPath);
  return sum + gzipSync(assetContents).byteLength;
}, 0);

const totalGzipBytes = inlineScriptGzipBytes + externalScriptGzipBytes;

if (totalGzipBytes > HOMEPAGE_JS_BUDGET) {
  throw new Error(
    `Homepage-loaded JS is ${totalGzipBytes} bytes gzipped, exceeding the ${HOMEPAGE_JS_BUDGET} byte budget.`,
  );
}

console.log(
  `Homepage-loaded JS is ${totalGzipBytes} bytes gzipped across ${uniqueAssets.length} external assets and ${inlineScriptGzipBytes} inline-script bytes.`,
);
