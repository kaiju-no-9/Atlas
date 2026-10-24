import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "wxt";

const extensionRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  manifestVersion: 3,
  vite: () => ({
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(extensionRoot, "src"),
        "@atlas/contracts": path.resolve(extensionRoot, "../../packages/contracts/src/index.ts"),
        "@contracts": path.resolve(extensionRoot, "../../packages/contracts/src"),
      },
    },
  }),
  manifest: {
    name: "Atlas Browser Agent",
    version: "0.1.0",
    description: "Grounded, verified browser automation under your control.",
    permissions: ["activeTab", "storage", "tabs", "scripting", "alarms"],
    host_permissions: ["https://openrouter.ai/*"],
    action: { default_title: "Open Atlas Side Panel" },
  },
});
