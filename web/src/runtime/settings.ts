export type ResolutionPreset = "640x360" | "1280x720" | "1920x1080" | "custom";
export type TickMode = "raf" | "fixed";
export type LoggingLevel = "silent" | "error" | "warn" | "info" | "debug";
export type UnsupportedBlockPolicy = "abort_script" | "noop";

export interface RunnerSettings {
  resolutionPreset: ResolutionPreset;
  customWidth: number;
  customHeight: number;
  keepAspect: boolean;
  pixelArtMode: boolean;
  renderScale: number;
  tickMode: TickMode;
  maxOpcodePerFrame: number;
  collisionIntervalFrames: number;
  loggingLevel: LoggingLevel;
  unsupportedBlockPolicy: UnsupportedBlockPolicy;
}

export const SETTINGS_STORAGE_KEY = "entry-fast-runner:settings";

export const DEFAULT_SETTINGS: RunnerSettings = {
  resolutionPreset: "640x360",
  customWidth: 640,
  customHeight: 360,
  keepAspect: true,
  pixelArtMode: false,
  renderScale: 1,
  tickMode: "raf",
  maxOpcodePerFrame: 20000,
  collisionIntervalFrames: 2,
  loggingLevel: "warn",
  unsupportedBlockPolicy: "abort_script",
};

export function resolveOutputSize(settings: RunnerSettings): { width: number; height: number } {
  switch (settings.resolutionPreset) {
    case "640x360":
      return { width: 640, height: 360 };
    case "1280x720":
      return { width: 1280, height: 720 };
    case "1920x1080":
      return { width: 1920, height: 1080 };
    case "custom":
    default:
      return {
        width: Math.max(1, Math.floor(settings.customWidth || 640)),
        height: Math.max(1, Math.floor(settings.customHeight || 360)),
      };
  }
}