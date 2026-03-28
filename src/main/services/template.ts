import path from "node:path";
import { ensureDir, writeTextFileSafe } from "./utils";

const TEMPLATE_FILES: Record<string, string> = {
  "package.json": JSON.stringify(
    {
      name: "jjcoder-site",
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: {
        dev: "vite",
        build: "tsc -b && vite build",
        preview: "vite preview"
      },
      dependencies: {
        react: "^19.2.0",
        "react-dom": "^19.2.0"
      },
      devDependencies: {
        "@types/react": "^19.2.0",
        "@types/react-dom": "^19.2.0",
        "@vitejs/plugin-react": "^5.2.0",
        typescript: "^6.0.0",
        vite: "^7.3.0"
      }
    },
    null,
    2
  ),
  "tsconfig.json": JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        useDefineForClassFields: true,
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        module: "ESNext",
        skipLibCheck: true,
        moduleResolution: "Bundler",
        allowImportingTsExtensions: false,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: "react-jsx",
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noFallthroughCasesInSwitch: true
      },
      include: ["src"],
      references: [{ path: "./tsconfig.node.json" }]
    },
    null,
    2
  ),
  "tsconfig.node.json": JSON.stringify(
    {
      compilerOptions: {
        composite: true,
        skipLibCheck: true,
        module: "ESNext",
        moduleResolution: "Bundler",
        allowSyntheticDefaultImports: true
      },
      include: ["vite.config.ts"]
    },
    null,
    2
  ),
  "vite.config.ts": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()]
});
`,
  "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>JJcoder Starter</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  "vercel.json": JSON.stringify(
    {
      rewrites: [{ source: "/(.*)", destination: "/index.html" }]
    },
    null,
    2
  )
};

export async function scaffoldReactWebsite(workspacePath: string): Promise<void> {
  for (const [relativePath, contents] of Object.entries(TEMPLATE_FILES)) {
    const filePath = path.join(workspacePath, relativePath);
    await ensureDir(path.dirname(filePath));
    await writeTextFileSafe(filePath, contents);
  }
}
