import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/GridGraph/" : "/",
  plugins: [react()],
  test: {
    environment: "jsdom",
    exclude: ["**/.claude/**", "**/node_modules/**"],
  },
}));
