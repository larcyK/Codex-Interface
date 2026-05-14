import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    // HMR configuration for remote access
    hmr: {
      host: "192.168.0.178", // replace with auto-detection if needed
      port: 5173,
      protocol: "ws",
    },
  },
});
