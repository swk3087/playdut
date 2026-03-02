import type { EntryObject, EntryPicture, EntryProject, EntrySound } from "../types/entry";

export interface RuntimeObjectState {
  id: string;
  name: string;
  objectType: string;
  x: number;
  y: number;
  rotation: number;
  direction: number;
  size: number;
  visible: boolean;
  costumeIndex: number;
  pictures: EntryPicture[];
  sounds: EntrySound[];
  sayText: string | null;
  sayExpireAt: number;
  baseWidth: number;
  baseHeight: number;
}

function toObjectState(object: EntryObject): RuntimeObjectState {
  const pictures = object.sprite?.pictures ?? [];
  const sounds = object.sprite?.sounds ?? [];
  const entity = object.entity ?? {};

  const firstPicture = pictures[0];
  const baseWidth = Number(entity.width ?? firstPicture?.dimension?.width ?? 80);
  const baseHeight = Number(entity.height ?? firstPicture?.dimension?.height ?? 80);

  const selectedPictureId = object.selectedPictureId;
  const costumeIndex = Math.max(
    0,
    pictures.findIndex((picture) => picture.id === selectedPictureId)
  );

  return {
    id: object.id,
    name: object.name,
    objectType: object.objectType ?? "sprite",
    x: Number(entity.x ?? 0),
    y: Number(entity.y ?? 0),
    rotation: Number(entity.rotation ?? 0),
    direction: Number(entity.direction ?? 90),
    size: Number(entity.scaleX != null ? Number(entity.scaleX) * 100 : 100),
    visible: Boolean(entity.visible ?? true),
    costumeIndex,
    pictures,
    sounds,
    sayText: null,
    sayExpireAt: 0,
    baseWidth,
    baseHeight,
  };
}

export class RuntimeWorld {
  readonly objects: RuntimeObjectState[];
  private objectMap: Map<string, RuntimeObjectState>;

  constructor(project: EntryProject) {
    this.objects = (project.objects ?? []).map(toObjectState);
    this.objectMap = new Map(this.objects.map((it) => [it.id, it]));
  }

  update(nowMs: number): void {
    for (const object of this.objects) {
      if (object.sayText && object.sayExpireAt > 0 && nowMs >= object.sayExpireAt) {
        object.sayText = null;
        object.sayExpireAt = 0;
      }
    }
  }

  getObject(id: string): RuntimeObjectState | undefined {
    return this.objectMap.get(id);
  }

  setX(id: string, value: number): void {
    const object = this.getObject(id);
    if (object) object.x = Number.isFinite(value) ? value : object.x;
  }

  setY(id: string, value: number): void {
    const object = this.getObject(id);
    if (object) object.y = Number.isFinite(value) ? value : object.y;
  }

  changeX(id: string, value: number): void {
    const object = this.getObject(id);
    if (object && Number.isFinite(value)) object.x += value;
  }

  changeY(id: string, value: number): void {
    const object = this.getObject(id);
    if (object && Number.isFinite(value)) object.y += value;
  }

  setRotation(id: string, value: number): void {
    const object = this.getObject(id);
    if (object) object.rotation = Number.isFinite(value) ? value : object.rotation;
  }

  changeRotation(id: string, value: number): void {
    const object = this.getObject(id);
    if (object && Number.isFinite(value)) object.rotation += value;
  }

  setSize(id: string, value: number): void {
    const object = this.getObject(id);
    if (object && Number.isFinite(value)) {
      object.size = Math.max(0, value);
    }
  }

  changeSize(id: string, value: number): void {
    const object = this.getObject(id);
    if (object && Number.isFinite(value)) {
      object.size = Math.max(0, object.size + value);
    }
  }

  setVisible(id: string, visible: boolean): void {
    const object = this.getObject(id);
    if (object) object.visible = visible;
  }

  setCostume(id: string, value: unknown): void {
    const object = this.getObject(id);
    if (!object || !object.pictures.length) {
      return;
    }

    const raw = typeof value === "string" ? value : String(value ?? "");
    if (raw === "__next__") {
      object.costumeIndex = (object.costumeIndex + 1) % object.pictures.length;
      return;
    }

    const byId = object.pictures.findIndex((picture) => picture.id === raw);
    if (byId >= 0) {
      object.costumeIndex = byId;
      return;
    }

    const byNumber = Number(raw);
    if (Number.isFinite(byNumber)) {
      const candidate = Math.floor(byNumber) - 1;
      if (candidate >= 0 && candidate < object.pictures.length) {
        object.costumeIndex = candidate;
      }
    }
  }

  say(id: string, text: string): void {
    const object = this.getObject(id);
    if (object) {
      object.sayText = text;
      object.sayExpireAt = 0;
    }
  }

  sayFor(id: string, text: string, seconds: number, nowMs: number): void {
    const object = this.getObject(id);
    if (object) {
      object.sayText = text;
      object.sayExpireAt = nowMs + Math.max(0, seconds) * 1000;
    }
  }

  getBounds(id: string): { x: number; y: number; width: number; height: number } | null {
    const object = this.getObject(id);
    if (!object) {
      return null;
    }

    const scale = object.size / 100;
    const width = Math.max(1, object.baseWidth * scale);
    const height = Math.max(1, object.baseHeight * scale);
    return {
      x: object.x - width / 2,
      y: object.y - height / 2,
      width,
      height,
    };
  }
}