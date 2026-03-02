import type { LoggingLevel } from "./settings";

const LEVEL_WEIGHT: Record<LoggingLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export interface BroadcastLog {
  at: number;
  messageId: string;
  waiting: boolean;
  spawned: number;
}

export class RuntimeLogger {
  private level: LoggingLevel;
  readonly warnings: string[] = [];
  readonly broadcastLogs: BroadcastLog[] = [];

  constructor(level: LoggingLevel) {
    this.level = level;
  }

  setLevel(level: LoggingLevel): void {
    this.level = level;
  }

  pushWarning(msg: string): void {
    this.warnings.push(msg);
    this.warn(msg);
  }

  pushBroadcast(log: BroadcastLog): void {
    this.broadcastLogs.push(log);
    if (this.broadcastLogs.length > 300) {
      this.broadcastLogs.splice(0, this.broadcastLogs.length - 300);
    }
    this.debug(`[broadcast] ${log.messageId} wait=${log.waiting} spawned=${log.spawned}`);
  }

  error(msg: string): void {
    if (LEVEL_WEIGHT[this.level] >= LEVEL_WEIGHT.error) {
      // eslint-disable-next-line no-console
      console.error(`[runtime:error] ${msg}`);
    }
  }

  warn(msg: string): void {
    if (LEVEL_WEIGHT[this.level] >= LEVEL_WEIGHT.warn) {
      // eslint-disable-next-line no-console
      console.warn(`[runtime:warn] ${msg}`);
    }
  }

  info(msg: string): void {
    if (LEVEL_WEIGHT[this.level] >= LEVEL_WEIGHT.info) {
      // eslint-disable-next-line no-console
      console.info(`[runtime:info] ${msg}`);
    }
  }

  debug(msg: string): void {
    if (LEVEL_WEIGHT[this.level] >= LEVEL_WEIGHT.debug) {
      // eslint-disable-next-line no-console
      console.debug(`[runtime:debug] ${msg}`);
    }
  }
}