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
  ),
  "src/main.tsx": `import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
  "src/App.tsx": `export function App() {
  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">JJcoder starter</p>
        <h1>Agent-built React site ready for your next prompt.</h1>
        <p className="lede">
          Replace this with a landing page, a dashboard, a portfolio, or whatever the next build run dreams up.
        </p>
        <div className="actions">
          <a href="#features" className="primary-link">Explore sections</a>
          <a href="https://vercel.com" className="secondary-link">Deploy on Vercel</a>
        </div>
      </section>
      <section className="feature-grid" id="features">
        <article>
          <span>01</span>
          <h2>Preview-first</h2>
          <p>Start with a visual shell that looks alive before the agent layers on product logic.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Type-safe</h2>
          <p>Vite, React and TypeScript are already wired, so build verification works out of the box.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Deployable</h2>
          <p>The template includes a minimal Vercel config to keep SPA routing smooth.</p>
        </article>
      </section>
    </main>
  );
}
`,
  "src/styles.css": `:root {
  color-scheme: light;
  --bg: #f7f2e7;
  --panel: rgba(255, 252, 247, 0.9);
  --ink: #1a1714;
  --muted: #6c6457;
  --accent: #1f8f5d;
  --accent-strong: #166947;
  font-family: "IBM Plex Sans", sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color: var(--ink);
  background:
    radial-gradient(circle at top left, rgba(31, 143, 93, 0.16), transparent 26%),
    linear-gradient(180deg, #f9f4ea 0%, #f1e9dc 100%);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
}

.page-shell {
  min-height: 100vh;
  padding: 48px 24px 64px;
}

.hero-card {
  max-width: 920px;
  margin: 0 auto 32px;
  padding: 40px;
  border: 1px solid rgba(26, 23, 20, 0.08);
  border-radius: 28px;
  background: var(--panel);
  box-shadow: 0 24px 80px rgba(65, 45, 16, 0.08);
}

.eyebrow {
  margin: 0 0 12px;
  text-transform: uppercase;
  letter-spacing: 0.26em;
  font-size: 0.75rem;
  color: var(--muted);
}

h1,
h2 {
  font-family: "Fraunces", serif;
  font-weight: 600;
}

h1 {
  margin: 0;
  font-size: clamp(3rem, 8vw, 5.5rem);
  line-height: 0.95;
  max-width: 10ch;
}

.lede {
  max-width: 56ch;
  margin-top: 18px;
  color: var(--muted);
  font-size: 1.05rem;
}

.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 28px;
}

.actions a {
  border-radius: 999px;
  padding: 12px 18px;
  text-decoration: none;
  transition: transform 140ms ease, opacity 140ms ease;
}

.actions a:hover {
  transform: translateY(-1px);
}

.primary-link {
  background: var(--accent);
  color: white;
}

.secondary-link {
  color: var(--ink);
  border: 1px solid rgba(26, 23, 20, 0.16);
}

.feature-grid {
  max-width: 920px;
  margin: 0 auto;
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.feature-grid article {
  padding: 24px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(26, 23, 20, 0.08);
}

.feature-grid span {
  color: var(--accent-strong);
  font-size: 0.88rem;
  letter-spacing: 0.14em;
}

.feature-grid h2 {
  margin-bottom: 8px;
}

.feature-grid p {
  margin: 0;
  color: var(--muted);
}

@media (max-width: 720px) {
  .page-shell {
    padding: 28px 16px 40px;
  }

  .hero-card {
    padding: 28px;
  }
}
`
};

export async function scaffoldReactWebsite(workspacePath: string): Promise<void> {
  for (const [relativePath, contents] of Object.entries(TEMPLATE_FILES)) {
    const filePath = path.join(workspacePath, relativePath);
    await ensureDir(path.dirname(filePath));
    await writeTextFileSafe(filePath, contents);
  }
}
