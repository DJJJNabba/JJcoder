import { app, dialog, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

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

  void autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    console.error("[updater] automatic update check failed", error);
  });
}

export async function checkForUpdatesNow(): Promise<{ checked: boolean; message: string }> {
  if (!app.isPackaged) {
    return {
      checked: false,
      message: "Update checks are available only in packaged builds."
    };
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.updateInfo?.version) {
      return {
        checked: true,
        message: `Checked for updates. Latest available version: ${result.updateInfo.version}.`
      };
    }

    return {
      checked: true,
      message: "Checked for updates. You're already on the latest version."
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const isNoArtifacts =
      detail.includes("latest.yml") || detail.includes("latest-mac.yml") || detail.includes("latest-linux.yml");
    return {
      checked: false,
      message: isNoArtifacts
        ? "No update information found in the latest release. You may already be on the latest version."
        : `Update check failed: ${detail.split("\n")[0]}`
    };
  }
}
