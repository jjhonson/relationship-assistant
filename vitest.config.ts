import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { setupFiles: ["./src/lib/test/isolate-dataset-env.ts"] },
  resolve: { alias: {
    "@": path.resolve(__dirname, "src"),
    // Next replaces this marker in server builds. Unit tests remain server-side.
    "server-only": path.resolve(__dirname, "src/lib/test/noop-server-only.ts"),
  } },
});
