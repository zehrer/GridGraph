import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Shown in Help → About.
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const commit = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
})();

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/GridGraph/" : "/",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILD__: JSON.stringify(`${commit} · ${new Date().toISOString().slice(0, 10)}`),
  },
  test: {
    environment: "jsdom",
    exclude: ["**/.claude/**", "**/node_modules/**"],
  },
}));
