import { app, type BrowserWindow } from "electron";
import electronUpdater, { type UpdateInfo } from "electron-updater";
import type { UpdateCheckResult, UpdateStatusEvent } from "@shared/types";

const { autoUpdater } = electronUpdater;

let updaterInitialized = false;
let lastStatus: UpdateStatusEvent | null = null;
let downloadPromise: Promise<unknown> | null = null;
let updateReady = false;

function buildResult(status: UpdateStatusEvent): UpdateCheckResult {
  return {
    checked: status.status !== "error",
    message: status.message,
    updateAvailable: status.status === "available" || status.status === "downloading" || status.status === "ready",
    version: status.version,
    readyToInstall: status.status === "ready"
  };
}

function versionFromInfo(info: UpdateInfo | null | undefined): string | null {
  return typeof info?.version === "string" && info.version ? info.version : null;
}

function setStatus(
  emit: (payload: UpdateStatusEvent) => void,
  next: UpdateStatusEvent
): UpdateStatusEvent {
  lastStatus = next;
  emit(next);
  return next;
}

function ensureDownloadStarted(emit: (payload: UpdateStatusEvent) => void, version: string | null): void {
  if (downloadPromise || updateReady) {
    return;
  }

  setStatus(emit, {
    status: "downloading",
    version,
    message: version ? `Downloading JJcoder ${version}.` : "Downloading the latest JJcoder update.",
    progress: null
  });

  downloadPromise = autoUpdater.downloadUpdate().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    setStatus(emit, {
      status: "error",
      version,
      message: `Update download failed: ${detail.split("\n")[0]}`,
      progress: null
    });
    console.error("[updater] update download failed", error);
    return null;
  }).finally(() => {
    downloadPromise = null;
  });
}

export function initializeAutoUpdater(
  _getWindow: () => BrowserWindow | null,
  emit: (payload: UpdateStatusEvent) => void
): void {
  if (!app.isPackaged || updaterInitialized) {
    return;
  }

  updaterInitialized = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (error) => {
    const detail = error instanceof Error ? error.message : String(error);
    setStatus(emit, {
      status: "error",
      version: lastStatus?.version ?? null,
      message: `Update check failed: ${detail.split("\n")[0]}`,
      progress: null
    });
    console.error("[updater] update check failed", error);
  });

  autoUpdater.on("update-available", (info) => {
    const version = versionFromInfo(info);
    setStatus(emit, {
      status: "available",
      version,
      message: version ? `JJcoder ${version} is available.` : "A JJcoder update is available.",
      progress: null
    });
    ensureDownloadStarted(emit, version);
  });

  autoUpdater.on("update-not-available", (info) => {
    setStatus(emit, {
      status: "not-available",
      version: versionFromInfo(info) ?? app.getVersion(),
      message: "You're already on the latest version.",
      progress: null
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : null;
    setStatus(emit, {
      status: "downloading",
      version: lastStatus?.version ?? null,
      message:
        percent === null
          ? "Downloading the latest JJcoder update."
          : `Downloading the latest JJcoder update (${Math.round(percent)}%).`,
      progress: percent
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    updateReady = true;
    setStatus(emit, {
      status: "ready",
      version: versionFromInfo(info),
      message: `JJcoder ${info.version} is ready to install.`,
      progress: 100
    });
  });

  setTimeout(() => {
    void checkForUpdatesNow(emit).catch((error) => {
      console.error("[updater] automatic update check failed", error);
    });
  }, 1500);
}

export async function checkForUpdatesNow(
  emit?: (payload: UpdateStatusEvent) => void
): Promise<UpdateCheckResult> {
  if (!app.isPackaged) {
    return {
      checked: false,
      message: "Update checks are available only in packaged builds.",
      updateAvailable: false,
      version: null,
      readyToInstall: false
    };
  }

  if (updateReady && lastStatus?.status === "ready") {
    return buildResult(lastStatus);
  }
  if (downloadPromise && lastStatus?.status === "downloading") {
    return buildResult(lastStatus);
  }

  const setManualStatus = (next: UpdateStatusEvent) => (emit ? setStatus(emit, next) : (lastStatus = next, next));

  try {
    setManualStatus({
      status: "checking",
      version: null,
      message: "Checking for JJcoder updates.",
      progress: null
    });

    const result = await autoUpdater.checkForUpdates();
    const version = versionFromInfo(result?.updateInfo);
    if (lastStatus?.status === "available" || lastStatus?.status === "downloading" || lastStatus?.status === "ready") {
      return buildResult(lastStatus);
    }

    return buildResult(
      setManualStatus({
        status: "not-available",
        version: version ?? app.getVersion(),
        message: "You're already on the latest version.",
        progress: null
      })
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const isNoArtifacts =
      detail.includes("latest.yml") || detail.includes("latest-mac.yml") || detail.includes("latest-linux.yml");
    return buildResult(
      setManualStatus({
        status: "error",
        version: null,
        message: isNoArtifacts
          ? "No update information found in the latest release. You may already be on the latest version."
          : `Update check failed: ${detail.split("\n")[0]}`,
        progress: null
      })
    );
  }
}

export async function installUpdateNow(): Promise<void> {
  if (!app.isPackaged) {
    throw new Error("Update installs are available only in packaged builds.");
  }
  if (!updateReady) {
    throw new Error("The update is not ready to install yet.");
  }
  autoUpdater.quitAndInstall(true, true);
}
