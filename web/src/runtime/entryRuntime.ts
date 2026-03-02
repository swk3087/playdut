import type { EntryProject } from "../types/entry";
import { SpatialHashCollision } from "./collision";
import { compileProject } from "./compiler";
import { RuntimeLogger, type BroadcastLog } from "./logger";
import { PixiRenderer } from "./renderer";
import type { RunnerSettings } from "./settings";
import { BytecodeVM, type VMStatus } from "./vm";
import { RuntimeWorld } from "./world";

const FIXED_STEP_MS = 1000 / 60;

export interface RuntimeSnapshot extends VMStatus {
  warnings: string[];
  broadcastLogs: BroadcastLog[];
}

export class EntryFastRuntime {
  private readonly host: HTMLElement;
  private settings: RunnerSettings;

  private project: EntryProject | null = null;
  private world: RuntimeWorld | null = null;
  private renderer: PixiRenderer | null = null;
  private collision: SpatialHashCollision | null = null;
  private vm: BytecodeVM | null = null;
  private logger: RuntimeLogger;

  private running = false;
  private started = false;
  private paused = true;
  private rafId = 0;
  private lastFrameMs = 0;
  private accumulatorMs = 0;
  private frameCount = 0;

  private pointerDown = false;

  constructor(host: HTMLElement, settings: RunnerSettings) {
    this.host = host;
    this.settings = settings;
    this.logger = new RuntimeLogger(settings.loggingLevel);
    this.bindInputEvents();
  }

  async loadProject(project: EntryProject): Promise<void> {
    const wasRunning = this.running && !this.paused;

    this.project = project;
    this.logger = new RuntimeLogger(this.settings.loggingLevel);

    const compiled = compileProject(project, this.settings, this.logger);
    this.world = new RuntimeWorld(project);
    this.collision = new SpatialHashCollision(64);

    if (!this.renderer) {
      this.renderer = new PixiRenderer(this.host, this.settings);
      await this.renderer.init(this.world);
    } else {
      await this.renderer.destroy();
      this.renderer = new PixiRenderer(this.host, this.settings);
      await this.renderer.init(this.world);
    }

    this.vm = new BytecodeVM(compiled, this.world, this.logger, this.settings.maxOpcodePerFrame);
    this.started = false;
    this.paused = true;

    if (wasRunning) {
      this.play();
    }
  }

  play(): void {
    if (!this.vm) {
      return;
    }

    if (!this.started) {
      this.vm.start();
      this.started = true;
    }

    this.paused = false;
    if (!this.running) {
      this.running = true;
      this.lastFrameMs = performance.now();
      this.accumulatorMs = 0;
      this.loop(this.lastFrameMs);
    }
  }

  pause(): void {
    this.paused = true;
  }

  async reset(): Promise<void> {
    if (!this.project) {
      return;
    }

    await this.loadProject(this.project);
  }

  async dispose(): Promise<void> {
    this.running = false;
    this.paused = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    if (this.renderer) {
      await this.renderer.destroy();
      this.renderer = null;
    }

    this.vm = null;
    this.world = null;
    this.collision = null;
    this.unbindInputEvents();
  }

  async updateSettings(nextSettings: RunnerSettings): Promise<void> {
    const compileOptionChanged =
      nextSettings.unsupportedBlockPolicy !== this.settings.unsupportedBlockPolicy;

    this.settings = nextSettings;
    this.logger.setLevel(nextSettings.loggingLevel);
    this.renderer?.applySettings(nextSettings);
    this.vm?.setMaxOpcodePerFrame(nextSettings.maxOpcodePerFrame);

    if (compileOptionChanged && this.project) {
      await this.loadProject(this.project);
    }
  }

  getSnapshot(): RuntimeSnapshot {
    const base =
      this.vm?.status() ?? {
        fps: 0,
        threadCount: 0,
        objectCount: this.world?.objects.length ?? 0,
        opcodePerSec: 0,
        threads: [],
      };

    return {
      ...base,
      warnings: [...this.logger.warnings],
      broadcastLogs: [...this.logger.broadcastLogs],
    };
  }

  private loop = (nowMs: number): void => {
    if (!this.running) {
      return;
    }

    const delta = nowMs - this.lastFrameMs;
    this.lastFrameMs = nowMs;

    if (!this.paused && this.vm && this.world && this.renderer) {
      if (this.settings.tickMode === "fixed") {
        this.accumulatorMs += delta;
        while (this.accumulatorMs >= FIXED_STEP_MS) {
          this.step(nowMs);
          this.accumulatorMs -= FIXED_STEP_MS;
        }
      } else {
        this.step(nowMs);
      }

      this.renderer.render(this.world);
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private step(nowMs: number): void {
    if (!this.vm || !this.world) {
      return;
    }

    this.vm.tick(nowMs);

    if (this.collision) {
      this.frameCount += 1;
      if (this.frameCount % Math.max(1, this.settings.collisionIntervalFrames) === 0) {
        this.collision.rebuild(this.world);
      }
    }
  }

  private bindInputEvents(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.host.addEventListener("pointermove", this.onPointerMove);
    this.host.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  private unbindInputEvents(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.host.removeEventListener("pointermove", this.onPointerMove);
    this.host.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    this.vm?.onKeyDown(event.keyCode || event.which || 0);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.vm?.onKeyUp(event.keyCode || event.which || 0);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const pos = this.toWorldCoord(event.clientX, event.clientY);
    this.vm?.onPointerMove(pos.x, pos.y);
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.pointerDown = true;
    const pos = this.toWorldCoord(event.clientX, event.clientY);
    const clickedObjectId = this.pickObjectId(pos.x, pos.y);
    this.vm?.onPointerDown(pos.x, pos.y, clickedObjectId);
  };

  private onPointerUp = (): void => {
    this.pointerDown = false;
    this.vm?.onPointerUp();
  };

  private toWorldCoord(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.host.getBoundingClientRect();
    const xNorm = rect.width ? (clientX - rect.left) / rect.width : 0;
    const yNorm = rect.height ? (clientY - rect.top) / rect.height : 0;

    return {
      x: xNorm * 640 - 320,
      y: 180 - yNorm * 360,
    };
  }

  private pickObjectId(worldX: number, worldY: number): string | null {
    if (!this.world) {
      return null;
    }

    const objects = this.world.objects;
    for (let i = objects.length - 1; i >= 0; i -= 1) {
      const object = objects[i];
      if (!object.visible) {
        continue;
      }

      const bounds = this.world.getBounds(object.id);
      if (!bounds) {
        continue;
      }

      const inside =
        worldX >= bounds.x &&
        worldX <= bounds.x + bounds.width &&
        worldY >= bounds.y &&
        worldY <= bounds.y + bounds.height;

      if (inside) {
        return object.id;
      }
    }

    return null;
  }
}