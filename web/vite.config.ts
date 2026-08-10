import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const core = fileURLToPath(new URL("../src/core", import.meta.url));

export default defineConfig({
  base: "/",
  plugins: [react()],
  resolve: {
    alias: { "@core": core },
  },
  server: {
    // core/ lives outside this package's root, so the dev server has to be
    // allowed to read the parent directory.
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
