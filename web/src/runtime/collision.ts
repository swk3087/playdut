import { RuntimeWorld } from "./world";

interface AABB {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersects(a: AABB, b: AABB): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export class SpatialHashCollision {
  private readonly cellSize: number;
  private cells = new Map<string, AABB[]>();
  private pairs = new Map<string, Set<string>>();

  constructor(cellSize = 64) {
    this.cellSize = cellSize;
  }

  rebuild(world: RuntimeWorld): void {
    this.cells.clear();
    this.pairs.clear();

    const bounds: AABB[] = [];
    for (const object of world.objects) {
      const box = world.getBounds(object.id);
      if (!box || !object.visible) {
        continue;
      }
      bounds.push({ id: object.id, ...box });
    }

    for (const box of bounds) {
      const keys = this.getCellKeys(box);
      for (const key of keys) {
        const list = this.cells.get(key);
        if (list) {
          list.push(box);
        } else {
          this.cells.set(key, [box]);
        }
      }
    }

    for (const list of this.cells.values()) {
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i];
          const b = list[j];
          if (a.id === b.id || !intersects(a, b)) {
            continue;
          }
          if (!this.pairs.has(a.id)) this.pairs.set(a.id, new Set<string>());
          if (!this.pairs.has(b.id)) this.pairs.set(b.id, new Set<string>());
          this.pairs.get(a.id)!.add(b.id);
          this.pairs.get(b.id)!.add(a.id);
        }
      }
    }
  }

  isColliding(aId: string, bId: string): boolean {
    return this.pairs.get(aId)?.has(bId) ?? false;
  }

  getColliders(id: string): string[] {
    return [...(this.pairs.get(id) ?? [])];
  }

  private getCellKeys(box: AABB): string[] {
    const minX = Math.floor(box.x / this.cellSize);
    const maxX = Math.floor((box.x + box.width) / this.cellSize);
    const minY = Math.floor(box.y / this.cellSize);
    const maxY = Math.floor((box.y + box.height) / this.cellSize);

    const keys: string[] = [];
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        keys.push(`${x}:${y}`);
      }
    }
    return keys;
  }
}