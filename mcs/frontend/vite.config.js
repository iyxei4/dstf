import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Split vendor libraries into long-lived, separately hashed chunks so an
// app-only release never forces returning visitors to re-download React,
// Recharts, or the Supabase client. Everything that is not an optional library
// shares ONE bucket: react-dom, react-is, prop-types, and react-transition-
// group import each other, so separate react/vendor files would be circular.
function vendorChunk(id) {
  if (!id.includes("node_modules")) return undefined;
  if (id.includes("recharts") || id.includes("d3-")) return "charts";
  if (id.includes("lucide-react")) return "icons";
  if (id.includes("@supabase")) return "supabase";
  return "vendor";
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8001",
        changeOrigin: false,
      },
    },
  },
});
