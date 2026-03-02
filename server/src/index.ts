import cors from "cors";
import express, { type Request, type Response } from "express";
import { EntryApiError, fetchEntryProject } from "./entryApi";
import { normalizeProject, normalizeProjectId } from "./normalize";

const PORT = Number(process.env.PORT ?? 4000);
const app = express();

app.use(cors());

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, now: Date.now() });
});

app.get("/api/project/:id", async (req: Request, res: Response) => {
  try {
    const id = normalizeProjectId(String(req.params.id ?? ""));
    const raw = await fetchEntryProject(id);
    const project = normalizeProject(raw);

    if (project.isopen === false) {
      res.status(403).json({ error: "private project is not supported" });
      return;
    }

    res.json({ id, project });
  } catch (error) {
    if (error instanceof EntryApiError) {
      res.status(error.status).json({ error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "unknown error";
    const status = /invalid project id/i.test(message) ? 400 : /private|not found|Project not found/i.test(message) ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return true;
  }

  if (host.startsWith("10.") || host.startsWith("192.168.")) {
    return true;
  }

  if (host.startsWith("172.")) {
    const second = Number(host.split(".")[1] ?? "0");
    if (second >= 16 && second <= 31) {
      return true;
    }
  }

  return false;
}

function isAllowedAssetHost(hostname: string): boolean {
  if (isPrivateHost(hostname)) {
    return false;
  }

  return /(playentry|entrylabs|ntry)/i.test(hostname);
}

app.get("/asset", async (req: Request, res: Response) => {
  const rawUrl = String(req.query.url ?? "");
  if (!rawUrl) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: "invalid url" });
    return;
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    res.status(400).json({ error: "unsupported protocol" });
    return;
  }

  if (!isAllowedAssetHost(target.hostname)) {
    res.status(403).json({ error: "host not allowed" });
    return;
  }

  try {
    const upstream = await fetch(target.toString());
    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status || 502).json({ error: "asset fetch failed" });
      return;
    }

    const contentType = upstream.headers.get("content-type");
    if (contentType) {
      res.setHeader("content-type", contentType);
    }
    res.setHeader("cache-control", "public, max-age=86400");

    const chunks: Buffer[] = [];
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(Buffer.from(value));
    }

    res.send(Buffer.concat(chunks));
  } catch (error) {
    const message = error instanceof Error ? error.message : "asset fetch error";
    res.status(502).json({ error: message });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${PORT}`);
});
