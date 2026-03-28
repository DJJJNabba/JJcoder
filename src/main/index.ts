import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";
import { AppController } from "./appController";

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
}

app.whenReady().then(async () => {
  controller = new AppController(app.getPath("userData"), emitToRenderer);
  await controller.initialize();
  await registerIpcHandlers();
  await createMainWindow();

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
