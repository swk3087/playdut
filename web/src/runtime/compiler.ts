import type { EntryBlock, EntryObject, EntryProject, EntryVariable } from "../types/entry";
import type { RuntimeLogger } from "./logger";
import { OpCode } from "./opcode";
import type { CompiledProgram, CompiledScript, Instruction, MessageSlot, TriggerType, VariableSlot } from "./ir";
import type { RunnerSettings } from "./settings";

const CORE_TRIGGER_TYPES = new Set([
  "when_run_button_click",
  "when_some_key_pressed",
  "mouse_clicked",
  "when_object_click",
  "when_message_cast",
  "when_scene_start",
  "when_frame",
  "when_every_frame",
]);

const KNOWN_STATEMENTS = new Set([
  "wait_second",
  "repeat_basic",
  "repeat_inf",
  "_if",
  "if_else",
  "wait_until_true",
  "stop_object",
  "message_cast",
  "message_cast_wait",
  "set_variable",
  "change_variable",
  "add_value_to_list",
  "remove_value_from_list",
  "insert_value_to_list",
  "change_value_list_index",
  "move_x",
  "move_y",
  "locate_x",
  "locate_y",
  "locate_xy",
  "rotate_relative",
  "rotate_absolute",
  "change_scale_size",
  "set_scale_size",
  "show",
  "hide",
  "change_to_some_shape",
  "change_to_next_shape",
  "dialog",
  "dialog_time",
]);

const SUPPORTED_EXPR_TYPES = new Set([
  "number",
  "text",
  "angle",
  "True",
  "False",
  "boolean_shell",
  "positive_number",
  "negative_number",
  "wildcard_string",
  "wildcard_boolean",
  "get_variable",
  "value_of_index_from_list",
  "length_of_list",
  "is_included_in_list",
  "calc_basic",
  "quotient_and_mod",
  "calc_operation",
  "boolean_basic_operator",
  "boolean_and_or",
  "boolean_not",
  "is_clicked",
  "is_object_clicked",
  "is_press_some_key",
  "coordinate_mouse",
]);

class ScriptAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptAbort";
  }
}

interface CompileContext {
  constants: unknown[];
  constMap: Map<string, number>;
  variableIndexById: Map<string, number>;
  variableIndexByName: Map<string, number>;
  listIndexById: Map<string, number>;
  listIndexByName: Map<string, number>;
  messageById: Map<string, string>;
  messageByName: Map<string, string>;
  warnings: string[];
  settings: RunnerSettings;
  logger: RuntimeLogger;
}

function serializeConst(value: unknown): string {
  return `${typeof value}:${JSON.stringify(value)}`;
}

function addConst(ctx: CompileContext, value: unknown): number {
  const key = serializeConst(value);
  const hit = ctx.constMap.get(key);
  if (hit != null) {
    return hit;
  }
  const index = ctx.constants.length;
  ctx.constants.push(value);
  ctx.constMap.set(key, index);
  return index;
}

function emit(instructions: Instruction[], inst: Instruction): number {
  const index = instructions.length;
  instructions.push(inst);
  return index;
}

function patchJump(instructions: Instruction[], at: number, target: number): void {
  instructions[at].a = target;
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toStringValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function isBlock(value: unknown): value is EntryBlock {
  return Boolean(value) && typeof value === "object" && "type" in (value as EntryBlock);
}

function getParam(block: EntryBlock, index: number): unknown {
  return Array.isArray(block.params) ? block.params[index] : undefined;
}

function warn(ctx: CompileContext, message: string): void {
  ctx.warnings.push(message);
  ctx.logger.pushWarning(message);
}

function isHardwareBlockType(type: string): boolean {
  return /(arduino|robot|microbit|bluetooth|iot|sensor|hardware|camera|voice|speech|wearable|neobot|codewiz|drone|bot|ai_utilize_(audio|video|object|face|pose|gesture))/i.test(
    type
  );
}

function unsupported(ctx: CompileContext, type: string): never | void {
  const category = isHardwareBlockType(type) ? "hardware" : "unsupported";
  const message = `[compile] ${category} block: ${type}`;
  warn(ctx, message);
  if (ctx.settings.unsupportedBlockPolicy === "abort_script") {
    throw new ScriptAbort(message);
  }
}

function findVariableIndex(ctx: CompileContext, raw: unknown): number {
  const key = toStringValue(raw);
  if (!key) {
    return -1;
  }

  const byId = ctx.variableIndexById.get(key);
  if (byId != null) {
    return byId;
  }

  const byName = ctx.variableIndexByName.get(key);
  if (byName != null) {
    return byName;
  }

  return -1;
}

function findListIndex(ctx: CompileContext, raw: unknown): number {
  const key = toStringValue(raw);
  if (!key) {
    return -1;
  }

  const byId = ctx.listIndexById.get(key);
  if (byId != null) {
    return byId;
  }

  const byName = ctx.listIndexByName.get(key);
  if (byName != null) {
    return byName;
  }

  return -1;
}

function resolveMessageId(ctx: CompileContext, raw: unknown): string {
  const key = toStringValue(raw);
  if (!key) {
    return "";
  }
  const byId = ctx.messageById.get(key);
  if (byId) {
    return byId;
  }
  const byName = ctx.messageByName.get(key);
  if (byName) {
    return byName;
  }
  return key;
}

function compileExpression(ctx: CompileContext, expr: unknown, instructions: Instruction[]): void {
  if (!isBlock(expr)) {
    emit(instructions, { op: OpCode.PUSH_CONST, a: addConst(ctx, expr) });
    return;
  }

  const type = expr.type;

  if (!SUPPORTED_EXPR_TYPES.has(type)) {
    unsupported(ctx, type);
    emit(instructions, { op: OpCode.PUSH_CONST, a: addConst(ctx, undefined) });
    return;
  }

  switch (type) {
    case "number":
    case "text":
    case "angle":
    case "positive_number":
    case "negative_number":
    case "wildcard_string":
    case "wildcard_boolean": {
      emit(instructions, { op: OpCode.PUSH_CONST, a: addConst(ctx, getParam(expr, 0)) });
      return;
    }
    case "True": {
      emit(instructions, { op: OpCode.PUSH_CONST, a: addConst(ctx, true) });
      return;
    }
    case "False": {
      emit(instructions, { op: OpCode.PUSH_CONST, a: addConst(ctx, false) });
      return;
    }
    case "boolean_shell": {
      compileExpression(ctx, getParam(expr, 0), instructions);
      return;
    }
    case "get_variable": {
      const index = findVariableIndex(ctx, getParam(expr, 0));
      if (index < 0) {
        warn(ctx, `[compile] unknown variable in get_variable: ${toStringValue(getParam(expr, 0))}`);
        emit(instructions, { op: OpCode.PUSH_CONST, a: addConst(ctx, 0) });
        return;
      }
      emit(instructions, { op: OpCode.LOAD_VAR, a: index });
      return;
    }
    case "value_of_index_from_list": {
      const listIndex = findListIndex(ctx, getParam(expr, 1));
      compileExpression(ctx, getParam(expr, 3), instructions);
      emit(instructions, { op: OpCode.PUSH_CONST, a: addConst(ctx, 1) });
      emit(instructions, { op: OpCode.SUB });
      emit(instructions, { op: OpCode.LIST_GET, a: listIndex });
      return;
    }
    case "length_of_list": {
      const listIndex = findListIndex(ctx, getParam(expr, 1));
      emit(instructions, { op: OpCode.LIST_LENGTH, a: listIndex });
      return;
    }
    case "is_included_in_list": {
      const listIndex = findListIndex(ctx, getParam(expr, 1));
      compileExpression(ctx, getParam(expr, 3), instructions);
      emit(instructions, { op: OpCode.LIST_CONTAINS, a: listIndex });
      return;
    }
    case "calc_basic": {
      compileExpression(ctx, getParam(expr, 0), instructions);
      compileExpression(ctx, getParam(expr, 2), instructions);
      const op = toStringValue(getParam(expr, 1));
      if (op === "PLUS") emit(instructions, { op: OpCode.ADD });
      else if (op === "MINUS") emit(instructions, { op: OpCode.SUB });
      else if (op === "MULTI") emit(instructions, { op: OpCode.MUL });
      else emit(instructions, { op: OpCode.DIV });
      return;
    }
    case "quotient_and_mod": {
      compileExpression(ctx, getParam(expr, 1), instructions);
      compileExpression(ctx, getParam(expr, 3), instructions);
      const op = toStringValue(getParam(expr, 5));
      if (op === "MOD") {
        emit(instructions, { op: OpCode.MOD });
      } else {
        emit(instructions, { op: OpCode.DIV });
      }
      return;
    }
    case "calc_operation": {
      compileExpression(ctx, getParam(expr, 1), instructions);
      const rawOp = toStringValue(getParam(expr, 3));
      const op = rawOp.includes("_") ? rawOp.split("_")[0] : rawOp;
      switch (op) {
        case "square":
          emit(instructions, { op: OpCode.DUP });
          emit(instructions, { op: OpCode.MUL });
          break;
        default:
          emit(instructions, { op: OpCode.MATH_UNARY, s: op });
          break;
      }
      return;
    }
    case "boolean_basic_operator": {
      compileExpression(ctx, getParam(expr, 0), instructions);
      compileExpression(ctx, getParam(expr, 2), instructions);
      const op = toStringValue(getParam(expr, 1));
      switch (op) {
        case "EQUAL":
          emit(instructions, { op: OpCode.EQ });
          break;
        case "NOT_EQUAL":
          emit(instructions, { op: OpCode.EQ });
          emit(instructions, { op: OpCode.NOT });
          break;
        case "GREATER":
          emit(instructions, { op: OpCode.GT });
          break;
        case "LESS":
          emit(instructions, { op: OpCode.LT });
          break;
        case "GREATER_OR_EQUAL":
          emit(instructions, { op: OpCode.LT });
          emit(instructions, { op: OpCode.NOT });
          break;
        case "LESS_OR_EQUAL":
          emit(instructions, { op: OpCode.GT });
          emit(instructions, { op: OpCode.NOT });
          break;
        default:
          emit(instructions, { op: OpCode.EQ });
          break;
      }
      return;
    }
    case "boolean_and_or": {
      compileExpression(ctx, getParam(expr, 0), instructions);
      compileExpression(ctx, getParam(expr, 2), instructions);
      const op = toStringValue(getParam(expr, 1));
      emit(instructions, { op: op === "OR" ? OpCode.OR : OpCode.AND });
      return;
    }
    case "boolean_not": {
      compileExpression(ctx, getParam(expr, 1), instructions);
      emit(instructions, { op: OpCode.NOT });
      return;
    }
    case "is_clicked": {
      emit(instructions, { op: OpCode.IS_MOUSE_DOWN });
      return;
    }
    case "is_object_clicked": {
      emit(instructions, { op: OpCode.IS_OBJECT_CLICKED });
      return;
    }
    case "is_press_some_key": {
      emit(instructions, { op: OpCode.IS_KEY_DOWN, a: toNumber(getParam(expr, 0), 0) });
      return;
    }
    case "coordinate_mouse": {
      const axis = toStringValue(getParam(expr, 1));
      emit(instructions, { op: OpCode.MOUSE_COORD, a: axis === "y" ? 1 : 0 });
      return;
    }
    default:
      emit(instructions, { op: OpCode.PUSH_CONST, a: addConst(ctx, undefined) });
      return;
  }
}

function compileStatementList(
  ctx: CompileContext,
  blocks: EntryBlock[],
  instructions: Instruction[]
): void {
  for (const block of blocks) {
    compileStatement(ctx, block, instructions);
  }
}

function compileStopMode(block: EntryBlock): string {
  const raw = getParam(block, 0);
  return toStringValue(raw) || "thisThread";
}

function compileStatement(ctx: CompileContext, block: EntryBlock, instructions: Instruction[]): void {
  const type = block.type;

  if (!KNOWN_STATEMENTS.has(type)) {
    unsupported(ctx, type);
    emit(instructions, { op: OpCode.NOP });
    return;
  }

  switch (type) {
    case "wait_second": {
      compileExpression(ctx, getParam(block, 0), instructions);
      emit(instructions, { op: OpCode.PUSH_CONST, a: addConst(ctx, 1000) });
      emit(instructions, { op: OpCode.MUL });
      emit(instructions, { op: OpCode.WAIT_MS });
      return;
    }
    case "repeat_basic": {
      compileExpression(ctx, getParam(block, 0), instructions);
      const loopStart = instructions.length;
      emit(instructions, { op: OpCode.DUP });
      emit(instructions, { op: OpCode.PUSH_CONST, a: addConst(ctx, 0) });
      emit(instructions, { op: OpCode.GT });
      const jmpEnd = emit(instructions, { op: OpCode.JMP_IF_FALSE, a: -1 });
      compileStatementList(ctx, (block.statements?.[0] ?? []) as EntryBlock[], instructions);
      emit(instructions, { op: OpCode.PUSH_CONST, a: addConst(ctx, 1) });
      emit(instructions, { op: OpCode.SUB });
      emit(instructions, { op: OpCode.JMP, a: loopStart });
      patchJump(instructions, jmpEnd, instructions.length);
      emit(instructions, { op: OpCode.POP });
      return;
    }
    case "repeat_inf": {
      const loopStart = instructions.length;
      compileStatementList(ctx, (block.statements?.[0] ?? []) as EntryBlock[], instructions);
      emit(instructions, { op: OpCode.JMP, a: loopStart });
      return;
    }
    case "_if": {
      compileExpression(ctx, getParam(block, 0), instructions);
      const jmpElse = emit(instructions, { op: OpCode.JMP_IF_FALSE, a: -1 });
      compileStatementList(ctx, (block.statements?.[0] ?? []) as EntryBlock[], instructions);
      patchJump(instructions, jmpElse, instructions.length);
      return;
    }
    case "if_else": {
      compileExpression(ctx, getParam(block, 0), instructions);
      const jmpElse = emit(instructions, { op: OpCode.JMP_IF_FALSE, a: -1 });
      compileStatementList(ctx, (block.statements?.[0] ?? []) as EntryBlock[], instructions);
      const jmpEnd = emit(instructions, { op: OpCode.JMP, a: -1 });
      patchJump(instructions, jmpElse, instructions.length);
      compileStatementList(ctx, (block.statements?.[1] ?? []) as EntryBlock[], instructions);
      patchJump(instructions, jmpEnd, instructions.length);
      return;
    }
    case "wait_until_true": {
      const loopStart = instructions.length;
      compileExpression(ctx, getParam(block, 0), instructions);
      const done = emit(instructions, { op: OpCode.JMP_IF_FALSE, a: -1 });
      const jumpExit = emit(instructions, { op: OpCode.JMP, a: -1 });
      patchJump(instructions, done, instructions.length);
      emit(instructions, { op: OpCode.PUSH_CONST, a: addConst(ctx, 0) });
      emit(instructions, { op: OpCode.WAIT_MS });
      emit(instructions, { op: OpCode.JMP, a: loopStart });
      patchJump(instructions, jumpExit, instructions.length);
      return;
    }
    case "stop_object": {
      emit(instructions, { op: OpCode.STOP, s: compileStopMode(block) });
      return;
    }
    case "message_cast": {
      const messageId = resolveMessageId(ctx, getParam(block, 0));
      emit(instructions, { op: OpCode.BROADCAST, s: messageId });
      return;
    }
    case "message_cast_wait": {
      const messageId = resolveMessageId(ctx, getParam(block, 0));
      emit(instructions, { op: OpCode.BROADCAST_WAIT, s: messageId });
      return;
    }
    case "set_variable": {
      const index = findVariableIndex(ctx, getParam(block, 0));
      compileExpression(ctx, getParam(block, 1), instructions);
      emit(instructions, { op: OpCode.STORE_VAR, a: index });
      return;
    }
    case "change_variable": {
      const index = findVariableIndex(ctx, getParam(block, 0));
      emit(instructions, { op: OpCode.LOAD_VAR, a: index });
      compileExpression(ctx, getParam(block, 1), instructions);
      emit(instructions, { op: OpCode.ADD });
      emit(instructions, { op: OpCode.STORE_VAR, a: index });
      return;
    }
    case "add_value_to_list": {
      const index = findListIndex(ctx, getParam(block, 1));
      compileExpression(ctx, getParam(block, 0), instructions);
      emit(instructions, { op: OpCode.LIST_APPEND, a: index });
      return;
    }
    case "remove_value_from_list": {
      const index = findListIndex(ctx, getParam(block, 1));
      compileExpression(ctx, getParam(block, 0), instructions);
      emit(instructions, { op: OpCode.PUSH_CONST, a: addConst(ctx, 1) });
      emit(instructions, { op: OpCode.SUB });
      emit(instructions, { op: OpCode.LIST_REMOVE, a: index });
      return;
    }
    case "insert_value_to_list": {
      const index = findListIndex(ctx, getParam(block, 1));
      compileExpression(ctx, getParam(block, 2), instructions);
      emit(instructions, { op: OpCode.PUSH_CONST, a: addConst(ctx, 1) });
      emit(instructions, { op: OpCode.SUB });
      compileExpression(ctx, getParam(block, 0), instructions);
      emit(instructions, { op: OpCode.LIST_INSERT, a: index });
      return;
    }
    case "change_value_list_index": {
      const index = findListIndex(ctx, getParam(block, 0));
      compileExpression(ctx, getParam(block, 1), instructions);
      emit(instructions, { op: OpCode.PUSH_CONST, a: addConst(ctx, 1) });
      emit(instructions, { op: OpCode.SUB });
      compileExpression(ctx, getParam(block, 2), instructions);
      emit(instructions, { op: OpCode.LIST_SET, a: index });
      return;
    }
    case "move_x": {
      compileExpression(ctx, getParam(block, 0), instructions);
      emit(instructions, { op: OpCode.CHANGE_X });
      return;
    }
    case "move_y": {
      compileExpression(ctx, getParam(block, 0), instructions);
      emit(instructions, { op: OpCode.CHANGE_Y });
      return;
    }
    case "locate_x": {
      compileExpression(ctx, getParam(block, 0), instructions);
      emit(instructions, { op: OpCode.SET_X });
      return;
    }
    case "locate_y": {
      compileExpression(ctx, getParam(block, 0), instructions);
      emit(instructions, { op: OpCode.SET_Y });
      return;
    }
    case "locate_xy": {
      compileExpression(ctx, getParam(block, 0), instructions);
      emit(instructions, { op: OpCode.SET_X });
      compileExpression(ctx, getParam(block, 1), instructions);
      emit(instructions, { op: OpCode.SET_Y });
      return;
    }
    case "rotate_relative": {
      compileExpression(ctx, getParam(block, 0), instructions);
      emit(instructions, { op: OpCode.CHANGE_ROTATION });
      return;
    }
    case "rotate_absolute": {
      compileExpression(ctx, getParam(block, 0), instructions);
      emit(instructions, { op: OpCode.SET_ROTATION });
      return;
    }
    case "change_scale_size": {
      compileExpression(ctx, getParam(block, 0), instructions);
      emit(instructions, { op: OpCode.CHANGE_SIZE });
      return;
    }
    case "set_scale_size": {
      compileExpression(ctx, getParam(block, 0), instructions);
      emit(instructions, { op: OpCode.SET_SIZE });
      return;
    }
    case "show": {
      emit(instructions, { op: OpCode.SET_VISIBLE, a: 1 });
      return;
    }
    case "hide": {
      emit(instructions, { op: OpCode.SET_VISIBLE, a: 0 });
      return;
    }
    case "change_to_some_shape": {
      compileExpression(ctx, getParam(block, 0), instructions);
      emit(instructions, { op: OpCode.SET_COSTUME });
      return;
    }
    case "change_to_next_shape": {
      emit(instructions, { op: OpCode.PUSH_CONST, a: addConst(ctx, "__next__") });
      emit(instructions, { op: OpCode.SET_COSTUME });
      return;
    }
    case "dialog": {
      compileExpression(ctx, getParam(block, 0), instructions);
      emit(instructions, { op: OpCode.SAY });
      return;
    }
    case "dialog_time": {
      compileExpression(ctx, getParam(block, 0), instructions);
      compileExpression(ctx, getParam(block, 1), instructions);
      emit(instructions, { op: OpCode.SAY_FOR });
      return;
    }
    default:
      emit(instructions, { op: OpCode.NOP });
      return;
  }
}

function parseTrigger(block: EntryBlock, ctx: CompileContext): {
  trigger: TriggerType;
  keyCode?: number;
  messageId?: string;
} | null {
  if (!CORE_TRIGGER_TYPES.has(block.type)) {
    return null;
  }

  switch (block.type) {
    case "when_run_button_click":
      return { trigger: "start" };
    case "when_some_key_pressed":
      return { trigger: "key", keyCode: toNumber(getParam(block, 1) ?? getParam(block, 0), 0) };
    case "mouse_clicked":
    case "when_object_click":
      return { trigger: "mouse" };
    case "when_message_cast":
      return { trigger: "message", messageId: resolveMessageId(ctx, getParam(block, 1)) };
    case "when_frame":
    case "when_every_frame":
      return { trigger: "frame" };
    case "when_scene_start":
      return { trigger: "start" };
    default:
      return { trigger: "start" };
  }
}

function normalizeThreads(script: EntryObject["script"]): EntryBlock[][] {
  if (Array.isArray(script)) {
    return script as EntryBlock[][];
  }

  if (typeof script === "string") {
    try {
      const parsed = JSON.parse(script) as unknown;
      if (Array.isArray(parsed)) {
        return parsed as EntryBlock[][];
      }
    } catch {
      return [];
    }
  }

  return [];
}

function buildVariableSlots(variables: EntryVariable[]): {
  slots: VariableSlot[];
  byId: Map<string, number>;
  byName: Map<string, number>;
  listById: Map<string, number>;
  listByName: Map<string, number>;
} {
  const slots: VariableSlot[] = [];
  const byId = new Map<string, number>();
  const byName = new Map<string, number>();
  const listById = new Map<string, number>();
  const listByName = new Map<string, number>();

  for (const variable of variables) {
    const isList = variable.variableType === "list" || Array.isArray(variable.array);
    const initialValue = isList
      ? Array.isArray(variable.array)
        ? variable.array.map((item) => {
            if (item && typeof item === "object" && "data" in (item as Record<string, unknown>)) {
              return (item as Record<string, unknown>).data;
            }
            return item;
          })
        : []
      : variable.value ?? 0;

    const slot: VariableSlot = {
      id: variable.id,
      name: variable.name,
      initialValue,
      isList,
    };

    const idx = slots.length;
    slots.push(slot);
    byId.set(variable.id, idx);
    byName.set(variable.name, idx);
    if (isList) {
      listById.set(variable.id, idx);
      listByName.set(variable.name, idx);
    }
  }

  return { slots, byId, byName, listById, listByName };
}

function buildMessageSlots(project: EntryProject): { slots: MessageSlot[]; byId: Map<string, string>; byName: Map<string, string> } {
  const messages = Array.isArray(project.messages) ? project.messages : [];
  const slots = messages.map((message) => ({ id: message.id, name: message.name }));
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();

  for (const message of slots) {
    byId.set(message.id, message.id);
    byName.set(message.name, message.id);
  }

  return { slots, byId, byName };
}

export function compileProject(
  project: EntryProject,
  settings: RunnerSettings,
  logger: RuntimeLogger
): CompiledProgram {
  const variables = buildVariableSlots(Array.isArray(project.variables) ? project.variables : []);
  const messages = buildMessageSlots(project);

  const ctx: CompileContext = {
    constants: [],
    constMap: new Map<string, number>(),
    variableIndexById: variables.byId,
    variableIndexByName: variables.byName,
    listIndexById: variables.listById,
    listIndexByName: variables.listByName,
    messageById: messages.byId,
    messageByName: messages.byName,
    warnings: [],
    settings,
    logger,
  };

  const scripts: CompiledScript[] = [];

  for (const object of project.objects ?? []) {
    const threads = normalizeThreads(object.script);
    for (let threadIndex = 0; threadIndex < threads.length; threadIndex += 1) {
      const thread = threads[threadIndex];
      if (!Array.isArray(thread) || thread.length === 0) {
        continue;
      }

      const triggerBlock = thread[0];
      if (!isBlock(triggerBlock)) {
        continue;
      }

      const trigger = parseTrigger(triggerBlock, ctx);
      if (!trigger) {
        continue;
      }

      const instructions: Instruction[] = [];
      try {
        compileStatementList(ctx, thread.slice(1), instructions);
      } catch (error) {
        if (error instanceof ScriptAbort) {
          warn(
            ctx,
            `[compile] script aborted object=${object.id} thread=${threadIndex} reason=${error.message}`
          );
          continue;
        }
        throw error;
      }

      emit(instructions, { op: OpCode.END });

      scripts.push({
        id: `${object.id}:${threadIndex}`,
        objectId: object.id,
        trigger: trigger.trigger,
        keyCode: trigger.keyCode,
        messageId: trigger.messageId,
        instructions,
        sourceBlockType: triggerBlock.type,
      });
    }
  }

  return {
    scripts,
    variables: variables.slots,
    messages: messages.slots,
    constants: ctx.constants,
    warnings: ctx.warnings,
  };
}
