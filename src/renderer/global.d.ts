import type { DesktopBridgeApi } from "@shared/types";

declare global {
  interface Window {
    jjcoder: DesktopBridgeApi;
  }
}

export {};
