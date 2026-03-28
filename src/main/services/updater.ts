import { app, dialog, type BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";

let updaterInitialized = false;

export function initializeAutoUpdater(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged || updaterInitialized) {
    return;
  }

  updaterInitialized = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (error) => {
    console.error("[updater] update check failed", error);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    const owner = getWindow();
    const options = {
      type: "info" as const,
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update Ready",
      message: `JJcoder ${info.version} has been downloaded.`,
      detail: "Restart the app to apply the latest GitHub release."
    };
    const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  void autoUpdater.checkForUpdatesAndNotify();
}
