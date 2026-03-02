import type { OpCode } from "./opcode";

export type TriggerType = "start" | "frame" | "key" | "mouse" | "message";

export interface Instruction {
  op: OpCode;
  a?: number;
  b?: number;
  s?: string;
}

export interface VariableSlot {
  id: string;
  name: string;
  initialValue: unknown;
  isList: boolean;
}

export interface MessageSlot {
  id: string;
  name: string;
}

export interface CompiledScript {
  id: string;
  objectId: string;
  trigger: TriggerType;
  keyCode?: number;
  messageId?: string;
  instructions: Instruction[];
  sourceBlockType: string;
}

export interface CompiledProgram {
  scripts: CompiledScript[];
  variables: VariableSlot[];
  messages: MessageSlot[];
  constants: unknown[];
  warnings: string[];
}