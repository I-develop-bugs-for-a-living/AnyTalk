import { createRequire } from "node:module";

import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    // use the browser build of solid-js: the server build never runs effects
    alias: {
      "solid-js/web": require.resolve("solid-js/web/dist/web.js"),
      "solid-js": require.resolve("solid-js/dist/solid.js"),
    },
  },
  test: {
    include: ["**/*.test.ts"],
    // run the QR library through the aliases above (browser build of solid)
    server: { deps: { inline: ["solid-qr-code"] } },
  },
});
