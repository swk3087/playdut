import type { EntryGraphqlProject } from "./types";

const ENTRY_BASE_URL = "https://playentry.org";
const ENTRY_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
const GRAPHQL_ENDPOINTS = ["/graphql/SELECT_PROJECT", "/graphql"] as const;

const SELECT_PROJECT_QUERY = /* GraphQL */ `
query SELECT_PROJECT($id: ID!, $groupId: ID) {
  project(id: $id, groupId: $groupId) {
    id
    name
    isopen
    speed
    objects
    variables
    messages
    functions
    tables
    scenes
    cloudVariable
    learning
    expansionBlocks
    aiUtilizeBlocks
    hardwareLiteBlocks
    blockCategoryUsage
  }
}
`;

interface GraphqlResponse {
  data?: {
    project?: EntryGraphqlProject | null;
  };
  errors?: Array<{ message?: string }>;
}

interface EntrySession {
  csrfToken: string;
  cookieHeader: string;
}

type HeadersWithCookieHelpers = Headers & {
  getSetCookie?: () => string[];
  raw?: () => Record<string, string[]>;
};

export class EntryApiError extends Error {
  readonly status: number;
  readonly upstreamStatus?: number;
  readonly details?: string;

  constructor(message: string, options?: { status?: number; upstreamStatus?: number; details?: string }) {
    super(message);
    this.name = "EntryApiError";
    this.status = options?.status ?? 500;
    this.upstreamStatus = options?.upstreamStatus;
    this.details = options?.details;
  }
}

function splitSetCookieHeader(value: string): string[] {
  const result: string[] = [];
  let inExpires = false;
  let start = 0;

  for (let i = 0; i < value.length; i += 1) {
    if (!inExpires && value.slice(i, i + 8).toLowerCase() === "expires=") {
      inExpires = true;
      i += 7;
      continue;
    }

    const char = value[i];
    if (inExpires && char === ";") {
      inExpires = false;
      continue;
    }

    if (!inExpires && char === ",") {
      const chunk = value.slice(start, i).trim();
      if (chunk) {
        result.push(chunk);
      }
      start = i + 1;
    }
  }

  const tail = value.slice(start).trim();
  if (tail) {
    result.push(tail);
  }

  return result;
}

function readSetCookieHeaders(headers: Headers): string[] {
  const helperHeaders = headers as HeadersWithCookieHelpers;

  if (typeof helperHeaders.getSetCookie === "function") {
    const cookies = helperHeaders.getSetCookie();
    if (cookies.length > 0) {
      return cookies;
    }
  }

  if (typeof helperHeaders.raw === "function") {
    const rawHeaders = helperHeaders.raw();
    const rawSetCookie = rawHeaders["set-cookie"];
    if (Array.isArray(rawSetCookie) && rawSetCookie.length > 0) {
      return rawSetCookie;
    }
  }

  const singleHeader = headers.get("set-cookie");
  if (!singleHeader) {
    return [];
  }

  return splitSetCookieHeader(singleHeader);
}

function toCookieHeader(setCookieHeaders: string[]): string {
  const pairs: string[] = [];
  for (const setCookie of setCookieHeaders) {
    const pair = setCookie.split(";", 1)[0]?.trim();
    if (pair) {
      pairs.push(pair);
    }
  }
  return pairs.join("; ");
}

function extractCsrfToken(html: string): string | null {
  const metaTag = html.match(/<meta[^>]*name=["']csrf-token["'][^>]*>/i)?.[0];
  if (!metaTag) {
    return null;
  }

  const content = metaTag.match(/content=["']([^"']+)["']/i)?.[1];
  return content ?? null;
}

async function createSession(id: string): Promise<EntrySession> {
  const projectUrl = `${ENTRY_BASE_URL}/project/${id}`;
  const res = await fetch(projectUrl, {
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": ENTRY_USER_AGENT,
    },
  });

  if (!res.ok) {
    throw new EntryApiError(`Entry project page failed with HTTP ${res.status}`, {
      status: res.status === 404 ? 404 : 502,
      upstreamStatus: res.status,
    });
  }

  const html = await res.text();
  const csrfToken = extractCsrfToken(html);
  if (!csrfToken) {
    throw new EntryApiError("Entry csrf-token was not found on project page", { status: 502 });
  }

  const cookieHeader = toCookieHeader(readSetCookieHeaders(res.headers));
  if (!cookieHeader) {
    throw new EntryApiError("Entry session cookie was not provided by project page", { status: 502 });
  }

  return { csrfToken, cookieHeader };
}

async function requestProjectByGraphql(id: string, session: EntrySession, endpoint: string): Promise<EntryGraphqlProject> {
  const referer = `${ENTRY_BASE_URL}/project/${id}`;
  const res = await fetch(`${ENTRY_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      accept: "*/*",
      "content-type": "application/json",
      "x-client-type": "Client",
      referer,
      origin: ENTRY_BASE_URL,
      "user-agent": ENTRY_USER_AGENT,
      "csrf-token": session.csrfToken,
      cookie: session.cookieHeader,
    },
    body: JSON.stringify({
      operationName: "SELECT_PROJECT",
      variables: { id },
      query: SELECT_PROJECT_QUERY,
    }),
  });

  const text = await res.text();
  let body: GraphqlResponse;
  try {
    body = JSON.parse(text) as GraphqlResponse;
  } catch {
    throw new EntryApiError(`Entry GraphQL returned non-JSON (status=${res.status})`, {
      status: 502,
      upstreamStatus: res.status,
      details: text.slice(0, 300),
    });
  }

  if (!res.ok) {
    if (/form tampered with/i.test(text)) {
      throw new EntryApiError("Entry rejected request: form tampered with", {
        status: 502,
        upstreamStatus: res.status,
      });
    }
    throw new EntryApiError(`Entry GraphQL failed with HTTP ${res.status}`, {
      status: 502,
      upstreamStatus: res.status,
      details: text.slice(0, 300),
    });
  }

  if (body.errors?.length) {
    const msg = body.errors.map((it) => it.message || "unknown").join(" | ");
    throw new EntryApiError(`Entry GraphQL errors: ${msg}`, {
      status: /private|not found/i.test(msg) ? 404 : 502,
    });
  }

  const project = body.data?.project;
  if (!project) {
    throw new EntryApiError("Project not found or private", { status: 404 });
  }

  return project;
}

export async function fetchEntryProject(id: string): Promise<EntryGraphqlProject> {
  const session = await createSession(id);

  let lastError: unknown;
  for (const endpoint of GRAPHQL_ENDPOINTS) {
    try {
      return await requestProjectByGraphql(id, session, endpoint);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof EntryApiError) {
    throw lastError;
  }
  if (lastError instanceof Error) {
    throw new EntryApiError(lastError.message, { status: 502 });
  }
  throw new EntryApiError("Entry project fetch failed", { status: 502 });
}
