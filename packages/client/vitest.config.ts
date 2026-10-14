import { createRequire } from "node:module";

import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    // use the browser build of solid-js: the server build never runs effects
    alias: {
      "solid-js": require.resolve("solid-js/dist/solid.js"),
    },
  },
  test: {
    include: ["**/*.test.ts"],
  },
});
