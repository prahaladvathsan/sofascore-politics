import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

const [repoOwner = "example", repoName = "political-report-card"] =
  process.env.GITHUB_REPOSITORY?.split("/") ?? [];
const isDev = process.argv.includes("dev");

export default defineConfig({
  site: isDev ? "http://localhost:4321" : `https://${repoOwner}.github.io`,
  base: isDev ? "/" : `/${repoName}/`,
  output: "static",
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
