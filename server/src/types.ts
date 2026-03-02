export interface EntryGraphqlProject {
  id: string;
  hashId?: string;
  name?: string;
  isopen?: boolean;
  speed?: number;
  objects: unknown;
  variables: unknown;
  messages: unknown;
  functions?: unknown;
  tables?: unknown;
  scenes?: unknown;
  cloudVariable?: unknown;
  learning?: unknown;
  expansionBlocks?: unknown;
  aiUtilizeBlocks?: unknown;
  hardwareLiteBlocks?: unknown;
  blockCategoryUsage?: unknown;
  [key: string]: unknown;
}

export interface EntryProjectNormalized extends Omit<EntryGraphqlProject, "objects" | "variables" | "messages" | "functions" | "tables" | "scenes" | "learning" | "expansionBlocks" | "aiUtilizeBlocks" | "hardwareLiteBlocks" | "blockCategoryUsage" | "cloudVariable"> {
  objects: unknown[];
  variables: unknown[];
  messages: unknown[];
  functions: unknown[];
  tables: unknown[];
  scenes: unknown[];
  cloudVariable: unknown[];
  learning: unknown;
  expansionBlocks: string[];
  aiUtilizeBlocks: string[];
  hardwareLiteBlocks: string[];
  blockCategoryUsage: Record<string, unknown> | unknown[];
}

export type LoggingLevel = "silent" | "error" | "warn" | "info" | "debug";