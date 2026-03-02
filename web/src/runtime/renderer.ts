import {
  Application,
  Assets,
  Container,
  Sprite,
  Text,
  Texture,
  type TextStyleOptions,
} from "pixi.js";
import type { RunnerSettings } from "./settings";
import { resolveOutputSize } from "./settings";
import type { RuntimeObjectState, RuntimeWorld } from "./world";

const LOGICAL_WIDTH = 640;
const LOGICAL_HEIGHT = 360;

interface RenderNode {
  sprite: Sprite;
  bubble: Text;
  costumeIndex: number;
}

function toCanvasX(x: number): number {
  return LOGICAL_WIDTH / 2 + x;
}

function toCanvasY(y: number): number {
  return LOGICAL_HEIGHT / 2 - y;
}

function safeAssetUrl(url: string): string {
  return `/asset?url=${encodeURIComponent(url)}`;
}

export class PixiRenderer {
  private readonly host: HTMLElement;
  private app: Application | null = null;
  private stageLayer: Container | null = null;
  private nodes = new Map<string, RenderNode>();
  private settings: RunnerSettings;

  constructor(host: HTMLElement, settings: RunnerSettings) {
    this.host = host;
    this.settings = settings;
  }

  async init(world: RuntimeWorld): Promise<void> {
    if (this.app) {
      return;
    }

    const app = new Application();
    await app.init({
      width: LOGICAL_WIDTH,
      height: LOGICAL_HEIGHT,
      antialias: true,
      backgroundColor: 0x111316,
      resolution: Math.max(0.5, this.settings.renderScale),
      autoDensity: true,
    });

    this.app = app;
    this.stageLayer = new Container();
    app.stage.addChild(this.stageLayer);

    this.host.innerHTML = "";
    this.host.appendChild(app.canvas);

    for (const object of world.objects) {
      await this.addObject(object);
    }

    this.applySettings(this.settings);
    this.render(world);
  }

  applySettings(settings: RunnerSettings): void {
    this.settings = settings;
    if (!this.app) {
      return;
    }

    const output = resolveOutputSize(settings);
    const canvas = this.app.canvas;
    canvas.style.width = `${output.width}px`;
    canvas.style.height = `${output.height}px`;
    canvas.style.maxWidth = "100%";
    canvas.style.maxHeight = "100%";
    canvas.style.objectFit = settings.keepAspect ? "contain" : "fill";

    for (const node of this.nodes.values()) {
      node.sprite.texture.source.scaleMode = settings.pixelArtMode ? "nearest" : "linear";
    }
  }

  render(world: RuntimeWorld): void {
    if (!this.app || !this.stageLayer) {
      return;
    }

    for (const object of world.objects) {
      const node = this.nodes.get(object.id);
      if (!node) {
        continue;
      }

      this.syncSprite(node, object);
      this.syncBubble(node, object);
    }
  }

  resize(): void {
    if (!this.app) {
      return;
    }
    const rect = this.host.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
  }

  async destroy(): Promise<void> {
    if (!this.app) {
      return;
    }

    this.nodes.clear();
    this.app.destroy(true, { children: true, texture: false });
    this.app = null;
    this.stageLayer = null;
  }

  private async addObject(object: RuntimeObjectState): Promise<void> {
    if (!this.stageLayer) {
      return;
    }

    const texture = await this.loadTextureForObject(object);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);

    const bubbleStyle: TextStyleOptions = {
      fill: "#f6f8fa",
      fontSize: 14,
      fontFamily: "Consolas, 'Courier New', monospace",
      stroke: { color: 0x111111, width: 3 },
    };
    const bubble = new Text({ text: "", style: bubbleStyle });
    bubble.anchor.set(0.5, 1);
    bubble.visible = false;

    this.stageLayer.addChild(sprite);
    this.stageLayer.addChild(bubble);

    this.nodes.set(object.id, {
      sprite,
      bubble,
      costumeIndex: object.costumeIndex,
    });
  }

  private syncSprite(node: RenderNode, object: RuntimeObjectState): void {
    if (node.costumeIndex !== object.costumeIndex) {
      node.costumeIndex = object.costumeIndex;
      this.updateTexture(node, object).catch(() => {
        // ignore texture load errors
      });
    }

    node.sprite.visible = object.visible;
    node.sprite.position.set(toCanvasX(object.x), toCanvasY(object.y));
    node.sprite.rotation = (object.rotation * Math.PI) / 180;

    const scale = object.size / 100;
    node.sprite.width = Math.max(1, object.baseWidth * scale);
    node.sprite.height = Math.max(1, object.baseHeight * scale);
  }

  private syncBubble(node: RenderNode, object: RuntimeObjectState): void {
    if (!object.sayText) {
      node.bubble.visible = false;
      return;
    }

    node.bubble.visible = true;
    node.bubble.text = object.sayText;
    node.bubble.position.set(toCanvasX(object.x), toCanvasY(object.y) - 12 - object.baseHeight * 0.5);
  }

  private async updateTexture(node: RenderNode, object: RuntimeObjectState): Promise<void> {
    const texture = await this.loadTextureForObject(object);
    node.sprite.texture = texture;
  }

  private async loadTextureForObject(object: RuntimeObjectState): Promise<Texture> {
    const picture = object.pictures[object.costumeIndex] ?? object.pictures[0];
    if (!picture?.fileurl) {
      return Texture.WHITE;
    }

    try {
      const loaded = await Assets.load<Texture>(safeAssetUrl(picture.fileurl));
      loaded.source.scaleMode = this.settings.pixelArtMode ? "nearest" : "linear";
      return loaded;
    } catch {
      return Texture.WHITE;
    }
  }
}
