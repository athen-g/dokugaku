import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dashboardPlugin } from "./server/dashboard.mjs";

export default defineConfig({
  plugins: [react(), dashboardPlugin()],
  server: {
    host: "127.0.0.1",
    fs: {
      deny: [
        "**/.env",
        "**/.env.*",
        "**/*.{crt,pem}",
        "**/.git/**",
        "**/.local/**",
        "**/*.ps1",
        "**/*.clixml",
        "**/server/**",
      ],
    },
  },
});
