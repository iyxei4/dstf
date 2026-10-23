import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const nodeModules = join(process.cwd(), "node_modules");

/**
 * Collect the packages that import three.js themselves.
 *
 * Bundling them apart from the rest of the vendor code matters: the landing
 * page loads its 3D hero through a dynamic import, so anything that pulls
 * three in statically would drag the whole 3D bundle onto the critical path
 * of every first visit.
 */
function packagesImportingThree() {
  const found = new Set();
  if (!existsSync(nodeModules)) return found;

  const packageDirs = [];
  for (const entry of readdirSync(nodeModules)) {
    if (entry.startsWith(".")) continue;
    const full = join(nodeModules, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry.startsWith("@")) {
      for (const scoped of readdirSync(full)) {
        packageDirs.push(join(full, scoped));
      }
    } else {
      packageDirs.push(full);
    }
  }

  for (const dir of packageDirs) {
    const name = relative(nodeModules, dir).split(sep).join("/");
    if (name === "three" || name.startsWith("three-") || name.startsWith("@react-three/")) {
      found.add(name);
      continue;
    }
    if (scanForThreeImport(dir)) found.add(name);
  }
  return found;
}

function scanForThreeImport(dir) {
  const stack = [dir];
  let inspected = 0;
  while (stack.length && inspected < 400) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        // Only the build output can reach the browser bundle.
        if (["src", "test", "tests", "node_modules"].includes(entry.name)) continue;
        stack.push(full);
        continue;
      }
      if (!/\.(js|mjs|cjs)$/.test(entry.name)) continue;
      inspected += 1;
      let source;
      try {
        source = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      if (/from\s*["']three["']|require\(["']three["']\)/.test(source)) return true;
    }
  }
  return false;
}

const threePackages = packagesImportingThree();

// Split vendor libraries into long-lived, separately hashed chunks so an
// app-only release never forces returning visitors to re-download React,
// Recharts, or the Supabase client. Everything that is not an optional library
// shares ONE bucket: react-dom, react-is, prop-types, and react-transition-
// group import each other, so separate react/vendor files would be circular.
// The 3D libraries get their own bucket and are reached only through the
// lazily imported hero, so the landing page paints before the 3D bundle is
// even requested.
function vendorChunk(id) {
  if (!id.includes("node_modules")) return undefined;
  const path = id.replace(/\\/g, "/");
  for (const name of threePackages) {
    if (path.includes(`/node_modules/${name}/`)) return "three";
  }
  if (id.includes("recharts") || id.includes("d3-")) return "charts";
  if (id.includes("lucide-react")) return "icons";
  if (id.includes("@supabase")) return "supabase";
  return "vendor";
}

// The helper that Vite injects for dynamic imports must not sit in the 3D
// chunk: the entry file imports it statically, which would make the browser
// download the 3D bundle before the page has painted.
function helperChunk(id) {
  if (id.includes("preload-helper")) return "preload-helper";
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          return helperChunk(id) || vendorChunk(id);
        },
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
