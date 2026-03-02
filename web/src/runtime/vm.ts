import type { Instruction, CompiledProgram, CompiledScript } from "./ir";
import { OpCode } from "./opcode";
import type { RuntimeLogger } from "./logger";
import { RuntimeWorld } from "./world";

export interface VMThreadDebug {
  id: string;
  scriptId: string;
  objectId: string;
  pc: number;
  sleepUntilMs: number;
  waitingChildren: number;
  isDone: boolean;
}

export interface VMStatus {
  fps: number;
  threadCount: number;
  objectCount: number;
  opcodePerSec: number;
  threads: VMThreadDebug[];
}

interface VMThread {
  id: string;
  scriptId: string;
  objectId: string;
  pc: number;
  stack: unknown[];
  sleepUntilMs: number;
  waitingChildren: number;
  parentThreadId?: string;
  isDone: boolean;
}

interface VMInputState {
  pressedKeys: Set<number>;
  mouseDown: boolean;
  mouseClickedFrame: boolean;
  mouseX: number;
  mouseY: number;
  clickedObjectId: string | null;
}

function toNum(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function truthy(value: unknown): boolean {
  return Boolean(value);
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export class BytecodeVM {
  private readonly program: CompiledProgram;
  private readonly scriptsById = new Map<string, CompiledScript>();
  private readonly startScripts: CompiledScript[] = [];
  private readonly frameScripts: CompiledScript[] = [];
  private readonly mouseScripts: CompiledScript[] = [];
  private readonly keyScripts = new Map<number, CompiledScript[]>();
  private readonly messageScripts = new Map<string, CompiledScript[]>();
  private readonly world: RuntimeWorld;
  private readonly logger: RuntimeLogger;
  private maxOpcodePerFrame: number;

  private readonly values: unknown[];
  private readonly threads: VMThread[] = [];
  private readonly threadById = new Map<string, VMThread>();
  private input: VMInputState;
  private threadSeq = 0;

  private lastFrameMs = performance.now();
  private fps = 0;
  private opcodeWindowStartMs = performance.now();
  private opcodeWindowCount = 0;
  private opcodePerSec = 0;

  constructor(
    program: CompiledProgram,
    world: RuntimeWorld,
    logger: RuntimeLogger,
    maxOpcodePerFrame: number
  ) {
    this.program = program;
    this.world = world;
    this.logger = logger;
    this.maxOpcodePerFrame = Math.max(1000, maxOpcodePerFrame);

    this.values = program.variables.map((slot) => {
      if (slot.isList) {
        return Array.isArray(slot.initialValue) ? [...slot.initialValue] : [];
      }
      return slot.initialValue;
    });

    this.input = {
      pressedKeys: new Set<number>(),
      mouseDown: false,
      mouseClickedFrame: false,
      mouseX: 0,
      mouseY: 0,
      clickedObjectId: null,
    };

    for (const script of program.scripts) {
      this.scriptsById.set(script.id, script);
      if (script.trigger === "start") {
        this.startScripts.push(script);
      } else if (script.trigger === "frame") {
        this.frameScripts.push(script);
      } else if (script.trigger === "mouse") {
        this.mouseScripts.push(script);
      } else if (script.trigger === "key") {
        const key = script.keyCode ?? 0;
        const bucket = this.keyScripts.get(key);
        if (bucket) bucket.push(script);
        else this.keyScripts.set(key, [script]);
      } else if (script.trigger === "message") {
        const message = script.messageId ?? "";
        const bucket = this.messageScripts.get(message);
        if (bucket) bucket.push(script);
        else this.messageScripts.set(message, [script]);
      }
    }
  }

  setMaxOpcodePerFrame(value: number): void {
    this.maxOpcodePerFrame = Math.max(1000, Math.floor(value));
  }

  start(): void {
    this.spawnScripts(this.startScripts);
  }

  reset(): void {
    this.threads.length = 0;
    this.threadById.clear();
    this.threadSeq = 0;
    for (let i = 0; i < this.program.variables.length; i += 1) {
      const slot = this.program.variables[i];
      this.values[i] = slot.isList
        ? Array.isArray(slot.initialValue)
          ? [...slot.initialValue]
          : []
        : slot.initialValue;
    }
    this.start();
  }

  onKeyDown(keyCode: number): void {
    this.input.pressedKeys.add(keyCode);
    this.spawnScripts(this.keyScripts.get(keyCode) ?? []);
  }

  onKeyUp(keyCode: number): void {
    this.input.pressedKeys.delete(keyCode);
  }

  onPointerMove(worldX: number, worldY: number): void {
    this.input.mouseX = worldX;
    this.input.mouseY = worldY;
  }

  onPointerDown(worldX: number, worldY: number, clickedObjectId: string | null): void {
    this.input.mouseDown = true;
    this.input.mouseClickedFrame = true;
    this.input.mouseX = worldX;
    this.input.mouseY = worldY;
    this.input.clickedObjectId = clickedObjectId;
    this.spawnScripts(this.mouseScripts);
  }

  onPointerUp(): void {
    this.input.mouseDown = false;
  }

  tick(nowMs: number): number {
    this.spawnScripts(this.frameScripts);

    const delta = nowMs - this.lastFrameMs;
    if (delta > 0) {
      this.fps = 1000 / delta;
    }
    this.lastFrameMs = nowMs;

    let budget = this.maxOpcodePerFrame;
    let consumed = 0;

    const readyQueue = this.threads.filter(
      (thread) => !thread.isDone && thread.sleepUntilMs <= nowMs && thread.waitingChildren === 0
    );

    while (readyQueue.length > 0 && budget > 0) {
      const thread = readyQueue.shift()!;
      const script = this.scriptsById.get(thread.scriptId);
      if (!script) {
        thread.isDone = true;
        continue;
      }

      let localStep = 0;
      while (budget > 0 && localStep < 256) {
        if (thread.isDone || thread.waitingChildren > 0 || thread.sleepUntilMs > nowMs) {
          break;
        }

        const instruction = script.instructions[thread.pc];
        if (!instruction) {
          this.finishThread(thread);
          break;
        }

        thread.pc += 1;
        budget -= 1;
        consumed += 1;
        localStep += 1;

        this.executeInstruction(thread, instruction, nowMs);
      }

      if (!thread.isDone && thread.waitingChildren === 0 && thread.sleepUntilMs <= nowMs) {
        readyQueue.push(thread);
      }
    }

    this.opcodeWindowCount += consumed;
    if (nowMs - this.opcodeWindowStartMs >= 1000) {
      this.opcodePerSec = this.opcodeWindowCount;
      this.opcodeWindowCount = 0;
      this.opcodeWindowStartMs = nowMs;
    }

    this.world.update(nowMs);
    this.input.mouseClickedFrame = false;
    this.input.clickedObjectId = null;

    return consumed;
  }

  status(): VMStatus {
    return {
      fps: this.fps,
      threadCount: this.threads.filter((thread) => !thread.isDone).length,
      objectCount: this.world.objects.length,
      opcodePerSec: this.opcodePerSec,
      threads: this.threads.map((thread) => ({
        id: thread.id,
        scriptId: thread.scriptId,
        objectId: thread.objectId,
        pc: thread.pc,
        sleepUntilMs: thread.sleepUntilMs,
        waitingChildren: thread.waitingChildren,
        isDone: thread.isDone,
      })),
    };
  }

  private spawnScripts(scripts: CompiledScript[], parentThreadId?: string): VMThread[] {
    const created: VMThread[] = [];
    for (const script of scripts) {
      const thread: VMThread = {
        id: `t${this.threadSeq++}`,
        scriptId: script.id,
        objectId: script.objectId,
        pc: 0,
        stack: [],
        sleepUntilMs: 0,
        waitingChildren: 0,
        parentThreadId,
        isDone: false,
      };
      created.push(thread);
      this.threads.push(thread);
      this.threadById.set(thread.id, thread);
    }
    return created;
  }

  private executeInstruction(thread: VMThread, inst: Instruction, nowMs: number): void {
    const stack = thread.stack;

    switch (inst.op) {
      case OpCode.NOP:
        return;
      case OpCode.PUSH_CONST:
        stack.push(this.program.constants[inst.a ?? 0]);
        return;
      case OpCode.DUP:
        stack.push(stack[stack.length - 1]);
        return;
      case OpCode.POP:
        stack.pop();
        return;
      case OpCode.LOAD_VAR:
        stack.push(this.values[inst.a ?? -1]);
        return;
      case OpCode.STORE_VAR: {
        const value = stack.pop();
        const idx = inst.a ?? -1;
        if (idx >= 0 && idx < this.values.length) {
          this.values[idx] = value;
        }
        return;
      }
      case OpCode.LOAD_LIST:
        if ((inst.a ?? -1) < 0 || (inst.a ?? -1) >= this.values.length) {
          stack.push([]);
        } else {
          stack.push(listOf(this.values[inst.a ?? -1]));
        }
        return;
      case OpCode.STORE_LIST: {
        const value = stack.pop();
        const idx = inst.a ?? -1;
        if (idx >= 0 && idx < this.values.length && Array.isArray(value)) {
          this.values[idx] = value;
        }
        return;
      }
      case OpCode.LIST_APPEND: {
        const value = stack.pop();
        const idx = inst.a ?? -1;
        if (idx < 0 || idx >= this.values.length) {
          return;
        }
        const list = listOf(this.values[idx]);
        list.push(value);
        this.values[idx] = list;
        return;
      }
      case OpCode.LIST_INSERT: {
        const value = stack.pop();
        const rawIndex = toNum(stack.pop(), 0);
        const idx = inst.a ?? -1;
        if (idx < 0 || idx >= this.values.length) {
          return;
        }
        const list = listOf(this.values[idx]);
        const index = Math.max(0, Math.min(list.length, Math.floor(rawIndex)));
        list.splice(index, 0, value);
        this.values[idx] = list;
        return;
      }
      case OpCode.LIST_REMOVE: {
        const rawIndex = toNum(stack.pop(), 0);
        const idx = inst.a ?? -1;
        if (idx < 0 || idx >= this.values.length) {
          return;
        }
        const list = listOf(this.values[idx]);
        const index = Math.floor(rawIndex);
        if (index >= 0 && index < list.length) {
          list.splice(index, 1);
        }
        this.values[idx] = list;
        return;
      }
      case OpCode.LIST_SET: {
        const value = stack.pop();
        const rawIndex = toNum(stack.pop(), 0);
        const idx = inst.a ?? -1;
        if (idx < 0 || idx >= this.values.length) {
          return;
        }
        const list = listOf(this.values[idx]);
        const index = Math.floor(rawIndex);
        if (index >= 0 && index < list.length) {
          list[index] = value;
        }
        this.values[idx] = list;
        return;
      }
      case OpCode.LIST_GET: {
        const rawIndex = toNum(stack.pop(), 0);
        const idx = inst.a ?? -1;
        if (idx < 0 || idx >= this.values.length) {
          stack.push("");
          return;
        }
        const list = listOf(this.values[idx]);
        const index = Math.floor(rawIndex);
        stack.push(index >= 0 && index < list.length ? list[index] : "");
        return;
      }
      case OpCode.LIST_LENGTH: {
        const idx = inst.a ?? -1;
        if (idx < 0 || idx >= this.values.length) {
          stack.push(0);
          return;
        }
        const list = listOf(this.values[idx]);
        stack.push(list.length);
        return;
      }
      case OpCode.LIST_CONTAINS: {
        const target = stack.pop();
        const idx = inst.a ?? -1;
        if (idx < 0 || idx >= this.values.length) {
          stack.push(false);
          return;
        }
        const list = listOf(this.values[idx]);
        const result = list.some((item) => String(item) === String(target));
        stack.push(result);
        return;
      }
      case OpCode.ADD: {
        const right = stack.pop();
        const left = stack.pop();
        if (typeof left === "string" || typeof right === "string") {
          stack.push(`${left ?? ""}${right ?? ""}`);
        } else {
          stack.push(toNum(left) + toNum(right));
        }
        return;
      }
      case OpCode.SUB: {
        const right = toNum(stack.pop());
        const left = toNum(stack.pop());
        stack.push(left - right);
        return;
      }
      case OpCode.MUL: {
        const right = toNum(stack.pop());
        const left = toNum(stack.pop());
        stack.push(left * right);
        return;
      }
      case OpCode.DIV: {
        const right = toNum(stack.pop(), 1);
        const left = toNum(stack.pop());
        stack.push(right === 0 ? 0 : left / right);
        return;
      }
      case OpCode.MOD: {
        const right = toNum(stack.pop(), 1);
        const left = toNum(stack.pop());
        stack.push(right === 0 ? 0 : ((left % right) + right) % right);
        return;
      }
      case OpCode.EQ: {
        const right = stack.pop();
        const left = stack.pop();
        stack.push(left == right);
        return;
      }
      case OpCode.GT: {
        const right = stack.pop();
        const left = stack.pop();
        stack.push(toNum(left) > toNum(right));
        return;
      }
      case OpCode.LT: {
        const right = stack.pop();
        const left = stack.pop();
        stack.push(toNum(left) < toNum(right));
        return;
      }
      case OpCode.AND: {
        const right = stack.pop();
        const left = stack.pop();
        stack.push(truthy(left) && truthy(right));
        return;
      }
      case OpCode.OR: {
        const right = stack.pop();
        const left = stack.pop();
        stack.push(truthy(left) || truthy(right));
        return;
      }
      case OpCode.NOT:
        stack.push(!truthy(stack.pop()));
        return;
      case OpCode.MATH_UNARY: {
        const value = toNum(stack.pop());
        const op = inst.s ?? "";
        switch (op) {
          case "root":
            stack.push(Math.sqrt(Math.max(0, value)));
            break;
          case "sin":
            stack.push(Math.sin((value * Math.PI) / 180));
            break;
          case "cos":
            stack.push(Math.cos((value * Math.PI) / 180));
            break;
          case "tan":
            stack.push(Math.tan((value * Math.PI) / 180));
            break;
          case "asin":
            stack.push((Math.asin(value) * 180) / Math.PI);
            break;
          case "acos":
            stack.push((Math.acos(value) * 180) / Math.PI);
            break;
          case "atan":
            stack.push((Math.atan(value) * 180) / Math.PI);
            break;
          case "log":
            stack.push(Math.log10(Math.max(0.000001, value)));
            break;
          case "ln":
            stack.push(Math.log(Math.max(0.000001, value)));
            break;
          case "unnatural":
            stack.push(value - Math.floor(value));
            break;
          case "floor":
            stack.push(Math.floor(value));
            break;
          case "ceil":
            stack.push(Math.ceil(value));
            break;
          case "round":
            stack.push(Math.round(value));
            break;
          case "factorial": {
            let acc = 1;
            const n = Math.max(0, Math.floor(value));
            for (let i = 2; i <= n; i += 1) acc *= i;
            stack.push(acc);
            break;
          }
          case "abs":
            stack.push(Math.abs(value));
            break;
          default:
            stack.push(value);
            break;
        }
        return;
      }
      case OpCode.IS_MOUSE_DOWN:
        stack.push(this.input.mouseClickedFrame || this.input.mouseDown);
        return;
      case OpCode.IS_OBJECT_CLICKED:
        stack.push(this.input.clickedObjectId === thread.objectId);
        return;
      case OpCode.IS_KEY_DOWN:
        stack.push(this.input.pressedKeys.has(inst.a ?? 0));
        return;
      case OpCode.MOUSE_COORD:
        stack.push(inst.a === 1 ? this.input.mouseY : this.input.mouseX);
        return;
      case OpCode.JMP:
        thread.pc = inst.a ?? thread.pc;
        return;
      case OpCode.JMP_IF_FALSE: {
        const condition = stack.pop();
        if (!truthy(condition)) {
          thread.pc = inst.a ?? thread.pc;
        }
        return;
      }
      case OpCode.WAIT_MS: {
        const ms = Math.max(0, toNum(stack.pop()));
        thread.sleepUntilMs = nowMs + ms;
        return;
      }
      case OpCode.STOP:
        this.stopByMode(inst.s ?? "thisThread", thread);
        return;
      case OpCode.SET_X:
        this.world.setX(thread.objectId, toNum(stack.pop()));
        return;
      case OpCode.SET_Y:
        this.world.setY(thread.objectId, toNum(stack.pop()));
        return;
      case OpCode.CHANGE_X:
        this.world.changeX(thread.objectId, toNum(stack.pop()));
        return;
      case OpCode.CHANGE_Y:
        this.world.changeY(thread.objectId, toNum(stack.pop()));
        return;
      case OpCode.SET_ROTATION:
        this.world.setRotation(thread.objectId, toNum(stack.pop()));
        return;
      case OpCode.CHANGE_ROTATION:
        this.world.changeRotation(thread.objectId, toNum(stack.pop()));
        return;
      case OpCode.SET_SIZE:
        this.world.setSize(thread.objectId, toNum(stack.pop()));
        return;
      case OpCode.CHANGE_SIZE:
        this.world.changeSize(thread.objectId, toNum(stack.pop()));
        return;
      case OpCode.SET_VISIBLE:
        this.world.setVisible(thread.objectId, Boolean(inst.a));
        return;
      case OpCode.SET_COSTUME:
        this.world.setCostume(thread.objectId, stack.pop());
        return;
      case OpCode.SAY:
        this.world.say(thread.objectId, String(stack.pop() ?? ""));
        return;
      case OpCode.SAY_FOR: {
        const seconds = toNum(stack.pop());
        const text = String(stack.pop() ?? "");
        this.world.sayFor(thread.objectId, text, seconds, nowMs);
        return;
      }
      case OpCode.BROADCAST: {
        const messageId = inst.s ?? "";
        const spawned = this.spawnScripts(this.messageScripts.get(messageId) ?? []);
        this.logger.pushBroadcast({
          at: nowMs,
          messageId,
          waiting: false,
          spawned: spawned.length,
        });
        return;
      }
      case OpCode.BROADCAST_WAIT: {
        const messageId = inst.s ?? "";
        const spawned = this.spawnScripts(this.messageScripts.get(messageId) ?? [], thread.id);
        thread.waitingChildren += spawned.length;
        this.logger.pushBroadcast({
          at: nowMs,
          messageId,
          waiting: true,
          spawned: spawned.length,
        });
        return;
      }
      case OpCode.END:
        this.finishThread(thread);
        return;
      default:
        return;
    }
  }

  private stopByMode(mode: string, current: VMThread): void {
    switch (mode) {
      case "all":
        for (const thread of this.threads) {
          this.finishThread(thread);
        }
        break;
      case "thisOnly":
        for (const thread of this.threads) {
          if (thread.objectId === current.objectId) {
            this.finishThread(thread);
          }
        }
        break;
      case "otherThread":
        for (const thread of this.threads) {
          if (thread.objectId === current.objectId && thread.id !== current.id) {
            this.finishThread(thread);
          }
        }
        break;
      case "other_objects":
        for (const thread of this.threads) {
          if (thread.objectId !== current.objectId) {
            this.finishThread(thread);
          }
        }
        break;
      case "thisThread":
      default:
        this.finishThread(current);
        break;
    }
  }

  private finishThread(thread: VMThread): void {
    if (thread.isDone) {
      return;
    }

    thread.isDone = true;
    if (thread.parentThreadId) {
      const parent = this.threadById.get(thread.parentThreadId);
      if (parent && !parent.isDone) {
        parent.waitingChildren = Math.max(0, parent.waitingChildren - 1);
      }
    }
  }
}
