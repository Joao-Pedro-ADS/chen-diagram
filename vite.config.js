import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 5178,
    fs: { allow: [".."] },
    proxy: {
      "/api": "http://127.0.0.1:5177",
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
});
