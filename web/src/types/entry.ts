export interface EntryBlock {
  id?: string;
  type: string;
  x?: number;
  y?: number;
  params?: unknown[];
  statements?: EntryBlock[][];
  [key: string]: unknown;
}

export interface EntryPicture {
  id: string;
  fileurl: string;
  thumbUrl?: string;
  imageType?: string;
  name?: string;
  dimension?: {
    width: number;
    height: number;
  };
}

export interface EntrySound {
  id: string;
  fileurl: string;
  duration?: number;
  name?: string;
}

export interface EntryEntity {
  x: number;
  y: number;
  rotation: number;
  direction: number;
  scaleX: number;
  scaleY: number;
  width: number;
  height: number;
  regX: number;
  regY: number;
  visible: boolean;
}

export interface EntryObject {
  id: string;
  name: string;
  objectType?: string;
  script: EntryBlock[][] | string;
  scene?: string;
  selectedPictureId?: string;
  sprite?: {
    pictures?: EntryPicture[];
    sounds?: EntrySound[];
  };
  entity?: Partial<EntryEntity>;
}

export interface EntryVariable {
  id: string;
  name: string;
  value?: unknown;
  variableType?: string;
  array?: unknown[];
  object?: string | null;
  visible?: boolean;
}

export interface EntryMessage {
  id: string;
  name: string;
}

export interface EntryProject {
  id?: string;
  hashId?: string;
  name?: string;
  isopen?: boolean;
  speed?: number;
  objects: EntryObject[];
  variables: EntryVariable[];
  messages: EntryMessage[];
  functions?: unknown[];
  tables?: unknown[];
  scenes?: Array<{ id: string; name: string }>;
  learning?: unknown;
  cloudVariable?: unknown[];
  expansionBlocks?: string[];
  aiUtilizeBlocks?: string[];
  hardwareLiteBlocks?: string[];
  blockCategoryUsage?: Record<string, unknown> | unknown[];
  [key: string]: unknown;
}

export interface ProjectApiResponse {
  id: string;
  project: EntryProject;
}