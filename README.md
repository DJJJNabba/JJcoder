# JJcoder

JJcoder is an open-source Electron desktop app for agentically building React websites with OpenRouter, GitHub publishing, embedded live preview, and one-click Vercel deployment.

## Highlights

- OpenRouter-powered agent orchestration with `chat` and `plan` modes
- Searchable model picker backed by the live OpenRouter models catalog
- React + Vite website scaffolding for new workspaces
- In-app preview runner for local Vite dev servers
- Git initialization and GitHub repository publishing
- Vercel deployment wiring for built website output
- Secure local secret storage via Electron `safeStorage` when available

## Stack

- Electron
- React
- Vite
- TypeScript
- OpenRouter SDK
- Octokit
- Vercel SDK

## Getting Started

```bash
npm install
npm run dev
```

The app opens as a desktop shell. Add your OpenRouter API key in Settings before dispatching build agents.

## Release Builds

```bash
npm run build
npm run dist:win
npm run dist:win:portable
npm run dist:mac
npm run dist:linux
```

Verified in this workspace:

- `npm run build`
- `npx electron-builder --win nsis --dir`

Windows artifacts are emitted into `release/`.

Installed Windows builds now use Electron auto-update against the latest GitHub Release from `DJJJNabba/JJcoder`.

The standard Windows release is the NSIS installer, which now uses the normal install wizard and creates persistent app shortcuts. A portable `.exe` is optional and is built only with `npm run dist:win:portable`.

The release workflow publishes Windows, macOS, and Linux artifacts to GitHub Releases.

## Provider Setup

### OpenRouter

Add an API key in Settings, or provide `OPENROUTER_API_KEY` in the app environment.

### GitHub

Add a token with repository creation rights to enable the `Publish GitHub` flow.

### Vercel

Add a Vercel token, plus optional team ID and slug if you deploy into a team scope.

## Notes

- The app scaffolds Vite React TypeScript websites when you create a new empty workspace.
- Agent tools are intentionally constrained to workspace file operations, package manager commands, preview start, and build verification.
- Deployment currently uploads built `dist` output through the Vercel SDK after a successful local build.
