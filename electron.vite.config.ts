import path from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist-electron/main",
      lib: {
        entry: path.resolve(__dirname, "src/main/index.ts")
      }
    },
    resolve: {
      alias: {
        "@main": path.resolve(__dirname, "src/main"),
        "@shared": path.resolve(__dirname, "src/shared")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist-electron/preload",
      lib: {
        entry: path.resolve(__dirname, "src/main/preload.ts")
      }
    },
    resolve: {
      alias: {
        "@main": path.resolve(__dirname, "src/main"),
        "@shared": path.resolve(__dirname, "src/shared")
      }
    }
  },
  renderer: {
    root: ".",
    build: {
      rollupOptions: {
        input: path.resolve(__dirname, "index.html")
      }
    },
    resolve: {
      alias: {
        "@renderer": path.resolve(__dirname, "src/renderer"),
        "@shared": path.resolve(__dirname, "src/shared")
      }
    },
    plugins: [react()]
  }
});
