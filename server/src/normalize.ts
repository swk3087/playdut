import type { EntryGraphqlProject, EntryProjectNormalized } from "./types";

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function normalizeProjectId(input: string): string {
  const trimmed = input.trim();
  if (!ID_RE.test(trimmed)) {
    throw new Error("invalid project id");
  }
  return trimmed;
}

function parseMaybeJson<T>(value: unknown, fallback: T): T {
  if (value == null) {
    return fallback;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function ensureArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return [];
}

export function normalizeProject(project: EntryGraphqlProject): EntryProjectNormalized {
  const objects = ensureArray(parseMaybeJson(project.objects, []));
  const variables = ensureArray(parseMaybeJson(project.variables, []));
  const messages = ensureArray(parseMaybeJson(project.messages, []));
  const functions = ensureArray(parseMaybeJson(project.functions, []));
  const tables = ensureArray(parseMaybeJson(project.tables, []));
  const scenes = ensureArray(parseMaybeJson(project.scenes, []));
  const learning = parseMaybeJson(project.learning, {});
  const cloudVariable = ensureArray(parseMaybeJson(project.cloudVariable, []));
  const expansionBlocks = ensureArray(parseMaybeJson(project.expansionBlocks, [])).map(String);
  const aiUtilizeBlocks = ensureArray(parseMaybeJson(project.aiUtilizeBlocks, [])).map(String);
  const hardwareLiteBlocks = ensureArray(parseMaybeJson(project.hardwareLiteBlocks, [])).map(String);
  const blockCategoryUsage = parseMaybeJson(project.blockCategoryUsage, {} as Record<string, unknown>);

  return {
    ...project,
    objects,
    variables,
    messages,
    functions,
    tables,
    scenes,
    learning,
    cloudVariable,
    expansionBlocks,
    aiUtilizeBlocks,
    hardwareLiteBlocks,
    blockCategoryUsage,
  };
}