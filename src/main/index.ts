import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";
import { AppController } from "./appController";
import { checkForUpdatesNow, initializeAutoUpdater, installUpdateNow } from "./services/updater";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let controller: AppController | null = null;

function emitToRenderer(channel: string, payload: unknown) {
  mainWindow?.webContents.send("jjcoder:event", {
    channel,
    payload
  });
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#12110f",
    autoHideMenuBar: true,
    title: "JJcoder",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../../out/renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function directoryHasPersistedAppState(directoryPath: string): Promise<boolean> {
  return (
    (await pathExists(path.join(directoryPath, "state.json"))) ||
    (await pathExists(path.join(directoryPath, "state.backup.json"))) ||
    (await pathExists(path.join(directoryPath, "secrets.json")))
  );
}

async function resolveDataDirectory(): Promise<string> {
  const primary = app.getPath("userData");
  if (await directoryHasPersistedAppState(primary)) {
    return primary;
  }

  const appData = app.getPath("appData");
  const candidates = [
    path.join(appData, "JJcoder"),
    path.join(appData, "jjcoder"),
    path.join(appData, "JJcoder Desktop"),
    path.join(appData, "com.jjcoder.desktop")
  ];
  for (const candidate of candidates) {
    if (path.resolve(candidate) === path.resolve(primary)) {
      continue;
    }
    if (await directoryHasPersistedAppState(candidate)) {
      return candidate;
    }
  }

  return primary;
}

async function registerIpcHandlers() {
  if (!controller) {
    throw new Error("Controller was not initialized.");
  }

  ipcMain.handle("jjcoder:get-snapshot", async () => await controller!.getSnapshot());
  ipcMain.handle("jjcoder:refresh-models", async () => await controller!.refreshModels());
  ipcMain.handle("jjcoder:refresh-connections", async (_event, deep) => await controller!.refreshConnections(Boolean(deep)));
  ipcMain.handle("jjcoder:create-website", async (_event, input) => await controller!.createWebsite(input));
  ipcMain.handle("jjcoder:delete-website", async (_event, websiteId) => await controller!.deleteWebsite(websiteId));
  ipcMain.handle("jjcoder:rename-website", async (_event, input) => await controller!.renameWebsite(input));
  ipcMain.handle("jjcoder:open-in-ide", async (_event, websiteId) => await controller!.openInIde(websiteId));
  ipcMain.handle("jjcoder:open-in-explorer", async (_event, websiteId) => await controller!.openInExplorer(websiteId));
  ipcMain.handle("jjcoder:open-external", async (_event, url) => {
    await shell.openExternal(url);
  });
  ipcMain.handle("jjcoder:launch-provider-login", async (_event, provider) => await controller!.launchProviderLogin(provider));
  ipcMain.handle("jjcoder:save-secret", async (_event, input) => await controller!.saveSecret(input));
  ipcMain.handle("jjcoder:clear-secret", async (_event, kind) => await controller!.clearSecret(kind));
  ipcMain.handle("jjcoder:update-settings", async (_event, input) => await controller!.updateSettings(input));
  ipcMain.handle("jjcoder:create-conversation", async (_event, input) => await controller!.createConversation(input));
  ipcMain.handle("jjcoder:rename-conversation", async (_event, input) => await controller!.renameConversation(input));
  ipcMain.handle("jjcoder:delete-conversation", async (_event, conversationId) => await controller!.deleteConversation(conversationId));
  ipcMain.handle("jjcoder:reorder-websites", async (_event, input) => await controller!.reorderWebsites(input));
  ipcMain.handle("jjcoder:reorder-conversations", async (_event, input) => await controller!.reorderConversations(input));
  ipcMain.handle("jjcoder:dispatch-run", async (_event, input) => await controller!.dispatchRun(input));
  ipcMain.handle("jjcoder:respond-user-input", async (_event, input) => await controller!.respondUserInput(input));
  ipcMain.handle("jjcoder:start-preview", async (_event, websiteId) => await controller!.startPreview(websiteId));
  ipcMain.handle("jjcoder:stop-preview", async (_event, websiteId) => await controller!.stopPreview(websiteId));
  ipcMain.handle("jjcoder:init-git", async (_event, websiteId) => await controller!.initGitRepo(websiteId));
  ipcMain.handle("jjcoder:publish-repo", async (_event, input) => await controller!.publishRepo(input));
  ipcMain.handle("jjcoder:cancel-run", async (_event, runId) => await controller!.cancelRun(runId));
  ipcMain.handle("jjcoder:deploy-website", async (_event, input) => await controller!.deployWebsite(input));
  ipcMain.handle("jjcoder:pick-folder", async () => {
    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          properties: ["openDirectory", "createDirectory"]
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"]
        });
    if (result.canceled) {
      return null;
    }
    return result.filePaths[0] ?? null;
  });
  ipcMain.handle("jjcoder:show-sidebar-context-menu", async (event, input) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow;
    const template =
      input.kind === "website"
        ? [
            {
              label: "Copy Path",
              click: () => {
                if (typeof input.workspacePath === "string") {
                  clipboard.writeText(input.workspacePath);
                }
              }
            },
            {
              label: "Rename Project",
              click: () => {
                emitToRenderer("context-menu-action", {
                  kind: "website",
                  action: "rename",
                  websiteId: input.websiteId
                });
              }
            },
            { type: "separator" as const },
            {
              label: "Remove Project",
              click: () => {
                emitToRenderer("context-menu-action", {
                  kind: "website",
                  action: "delete",
                  websiteId: input.websiteId
                });
              }
            }
          ]
        : [
            {
              label: "Rename Thread",
              click: () => {
                emitToRenderer("context-menu-action", {
                  kind: "conversation",
                  action: "rename",
                  websiteId: input.websiteId,
                  conversationId: input.conversationId
                });
              }
            },
            { type: "separator" as const },
            {
              label: "Delete Thread",
              click: () => {
                emitToRenderer("context-menu-action", {
                  kind: "conversation",
                  action: "delete",
                  websiteId: input.websiteId,
                  conversationId: input.conversationId
                });
              }
            }
          ];

    Menu.buildFromTemplate(template).popup({
      window: owner ?? undefined
    });
  });
  ipcMain.handle(
    "jjcoder:check-for-updates",
    async () => await checkForUpdatesNow((payload) => emitToRenderer("update-status", payload))
  );
  ipcMain.handle("jjcoder:install-update", async () => await installUpdateNow());
}

function installProcessErrorHandlers() {
  const handleFatalError = async (title: string, error: unknown) => {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    console.error(title, detail);

    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    try {
      const options = {
        type: "error" as const,
        title: "JJcoder Startup Error",
        message: title,
        detail
      };
      if (owner) {
        await dialog.showMessageBox(owner, options);
      } else {
        await dialog.showMessageBox(options);
      }
    } catch {
      // Ignore UI failures while handling a fatal startup issue.
    }
  };

  process.on("uncaughtException", (error) => {
    void handleFatalError("An unexpected main-process error occurred.", error);
  });

  process.on("unhandledRejection", (reason) => {
    void handleFatalError("An unexpected startup task failed.", reason);
  });
}

app.whenReady().then(async () => {
  installProcessErrorHandlers();
  controller = new AppController(await resolveDataDirectory(), emitToRenderer);
  await registerIpcHandlers();
  await createMainWindow();
  initializeAutoUpdater(() => mainWindow, (payload) => emitToRenderer("update-status", payload));

  try {
    await controller.initialize();
    emitToRenderer("snapshot", await controller.getSnapshot());
  } catch (error) {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    console.error("Failed to initialize JJcoder", detail);
    const options = {
      type: "warning" as const,
      title: "JJcoder Started With Limited Features",
      message: "JJcoder opened, but some startup checks failed.",
      detail
    };
    if (mainWindow) {
      await dialog.showMessageBox(mainWindow, options);
    } else {
      await dialog.showMessageBox(options);
    }
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void controller?.dispose();
});
