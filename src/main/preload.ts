import { contextBridge, ipcRenderer } from "electron";
import type { AppEventMap, DesktopBridgeApi } from "@shared/types";

const BRIDGE_EVENT_CHANNEL = "jjcoder:event";

const api: DesktopBridgeApi = {
  getSnapshot: async () => await ipcRenderer.invoke("jjcoder:get-snapshot"),
  pickFolder: async () => await ipcRenderer.invoke("jjcoder:pick-folder"),
  refreshModels: async () => await ipcRenderer.invoke("jjcoder:refresh-models"),
  refreshConnections: async (deep) => await ipcRenderer.invoke("jjcoder:refresh-connections", deep),
  createWebsite: async (input) => await ipcRenderer.invoke("jjcoder:create-website", input),
  deleteWebsite: async (websiteId) => await ipcRenderer.invoke("jjcoder:delete-website", websiteId),
  renameWebsite: async (input) => await ipcRenderer.invoke("jjcoder:rename-website", input),
  openInIde: async (websiteId) => await ipcRenderer.invoke("jjcoder:open-in-ide", websiteId),
  openInExplorer: async (websiteId) => await ipcRenderer.invoke("jjcoder:open-in-explorer", websiteId),
  openExternal: async (url) => await ipcRenderer.invoke("jjcoder:open-external", url),
  launchProviderLogin: async (provider) => await ipcRenderer.invoke("jjcoder:launch-provider-login", provider),
  saveSecret: async (input) => await ipcRenderer.invoke("jjcoder:save-secret", input),
  clearSecret: async (kind) => await ipcRenderer.invoke("jjcoder:clear-secret", kind),
  updateSettings: async (input) => await ipcRenderer.invoke("jjcoder:update-settings", input),
  createConversation: async (input) => await ipcRenderer.invoke("jjcoder:create-conversation", input),
  renameConversation: async (input) => await ipcRenderer.invoke("jjcoder:rename-conversation", input),
  deleteConversation: async (conversationId) => await ipcRenderer.invoke("jjcoder:delete-conversation", conversationId),
  reorderWebsites: async (input) => await ipcRenderer.invoke("jjcoder:reorder-websites", input),
  reorderConversations: async (input) => await ipcRenderer.invoke("jjcoder:reorder-conversations", input),
  dispatchRun: async (input) => await ipcRenderer.invoke("jjcoder:dispatch-run", input),
  respondUserInput: async (input) => await ipcRenderer.invoke("jjcoder:respond-user-input", input),
  startPreview: async (websiteId) => await ipcRenderer.invoke("jjcoder:start-preview", websiteId),
  stopPreview: async (websiteId) => await ipcRenderer.invoke("jjcoder:stop-preview", websiteId),
  initGitRepo: async (websiteId) => await ipcRenderer.invoke("jjcoder:init-git", websiteId),
  publishRepo: async (input) => await ipcRenderer.invoke("jjcoder:publish-repo", input),
  cancelRun: async (runId) => await ipcRenderer.invoke("jjcoder:cancel-run", runId),
  deployWebsite: async (input) => await ipcRenderer.invoke("jjcoder:deploy-website", input),
  checkForUpdates: async () => await ipcRenderer.invoke("jjcoder:check-for-updates"),
  installUpdate: async () => await ipcRenderer.invoke("jjcoder:install-update"),
  showSidebarContextMenu: async (input) => await ipcRenderer.invoke("jjcoder:show-sidebar-context-menu", input),
  subscribe: (channel, listener) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: {
        channel: keyof AppEventMap;
        payload: AppEventMap[keyof AppEventMap];
      }
    ) => {
      if (payload.channel === channel) {
        listener(payload.payload as AppEventMap[typeof channel]);
      }
    };
    ipcRenderer.on(BRIDGE_EVENT_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(BRIDGE_EVENT_CHANNEL, wrapped);
    };
  }
};

contextBridge.exposeInMainWorld("jjcoder", api);
