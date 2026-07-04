import { readFileSync } from "node:fs";
import type { MemraConfig, BackendMode } from "./config.ts";

const DEFAULT_CLOUD_BASE_URL = "https://usememra.com/api";

// Read the version from package.json so the User-Agent never drifts from the
// published version. Best-effort — falls back to 0.0.0 if unreadable.
const VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
const USER_AGENT = `memra-pi-memory/${VERSION}`;

export class MemraError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Backend {
  mode: BackendMode;
  health(): Promise<{ ok: boolean; detail?: string }>;
  search(params: { query: string; limit?: number }): Promise<RecallResult>;
  add(params: {
    content: string;
    type?: string;
    importance?: number;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
  get(params: { id: string }): Promise<unknown>;
  list(params: { limit?: number; type?: string }): Promise<unknown>;
  delete(params: { id: string }): Promise<void>;
  history(params: { id: string }): Promise<unknown>;
  supersede(params: { id: string; content: string; reason?: string }): Promise<unknown>;
  bootstrap(): Promise<RecallResult>;
}

export interface RecallResult {
  data: Array<{
    id: string;
    content: string;
    score?: number;
    type?: string;
    importance?: number;
    tags?: string[];
    created_at?: string;
    // v4.5 staleness metadata (cloud only; absent on memra-local)
    staleness_score?: number;
    staleness_status?: string; // e.g. "fresh" | "aging" | "stale"
    last_confirmed?: string;
  }>;
  meta?: {
    total_candidates?: number;
    returned?: number;
    scoring?: string;
    degraded?: boolean;
  };
  estimated_tokens?: number;
}

/**
 * v4.5 write-response fields (cloud only; all optional so local/older servers
 * keep working). Responses may be flat or wrapped in `data` — pickWriteMeta
 * handles both.
 */
export interface WriteMeta {
  revision?: number;
  embedding_status?: string;
  conflicts?: Array<{ id?: string; content?: string; reason?: string } | string>;
}

export function pickWriteMeta(result: unknown): WriteMeta {
  const root = (result ?? {}) as any;
  const src = root?.data && typeof root.data === "object" ? root.data : root;
  const meta: WriteMeta = {};
  if (typeof src?.revision === "number") meta.revision = src.revision;
  if (typeof src?.embedding_status === "string") meta.embedding_status = src.embedding_status;
  const conflicts = src?.conflicts ?? root?.conflicts;
  if (Array.isArray(conflicts) && conflicts.length > 0) meta.conflicts = conflicts;
  return meta;
}

async function request<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: ctrl.signal });
    const text = await res.text();
    const body = text ? (tryJson(text) as any) : null;
    if (!res.ok) {
      const code = body?.error?.code ?? `http_${res.status}`;
      const msg = body?.error?.message ?? body?.message ?? res.statusText;
      throw new MemraError(res.status, code, msg);
    }
    return body as T;
  } catch (e) {
    if (e instanceof MemraError) throw e;
    if ((e as Error).name === "AbortError") {
      throw new MemraError(0, "timeout", `Request timed out after ${timeoutMs}ms`);
    }
    throw new MemraError(0, "network", (e as Error).message || "Network error");
  } finally {
    clearTimeout(timer);
  }
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function cloudHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
}

function localHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
}

function assertLoopback(url: string): void {
  const u = new URL(url);
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
    throw new MemraError(0, "unsafe_local", `Local backend must be loopback, got ${u.hostname}`);
  }
}

function assertHttps(url: string): void {
  const u = new URL(url);
  if (u.protocol !== "https:") {
    throw new MemraError(0, "unsafe_cloud", `Cloud backend must use HTTPS, got ${u.protocol}`);
  }
}

function normalizeCloudBaseUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) return trimmed.slice(0, -3);
  return trimmed;
}

export function createCloudBackend(cfg: NonNullable<MemraConfig["cloud"]>): Backend {
  if (!cfg.apiKey) {
    throw new MemraError(
      401,
      "no_api_key",
      "No Memra API key configured. Run /memra to set one, or export MEMRA_API_KEY.",
    );
  }
  assertHttps(cfg.apiUrl);
  const base = normalizeCloudBaseUrl(cfg.apiUrl || DEFAULT_CLOUD_BASE_URL);
  const v1 = base.endsWith("/api") ? `${base}/v1` : `${base}/api/v1`;
  const headers = cloudHeaders(cfg.apiKey);

  // Cloud API requires tenant_id + project_id on every call
  const identity = () => ({
    tenant_id: cfg.tenantId,
    project_id: cfg.projectId,
  });

  // No display strings here — the badge/label text is owned by ui.ts
  // (formatLabel/renderBadge), built from the effective config.
  return {
    mode: "cloud",

    async health() {
      try {
        const healthUrl = base.endsWith("/api") ? `${base}/health` : `${base}/api/health`;
        await request(healthUrl, { timeoutMs: 5000 });
        return { ok: true };
      } catch (e) {
        return { ok: false, detail: (e as Error).message };
      }
    },

    async search({ query, limit = 10 }) {
      return request<RecallResult>(`${v1}/memories/recall`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, limit, ...identity() }),
      });
    },

    async add({ content, type, importance, tags, metadata }) {
      return request(`${v1}/memories`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          content,
          type: type ?? "fact",
          importance: importance ?? 5,
          tags: tags ?? [],
          metadata: metadata ?? {},
          ...identity(),
        }),
      });
    },

    async get({ id }) {
      return request(`${v1}/memories/${encodeURIComponent(id)}`, {
        method: "GET",
        headers,
      });
    },

    async list({ limit = 50, type }) {
      const qs = new URLSearchParams({
        ...identity(),
        limit: String(limit),
      });
      if (type) qs.set("type", type);
      return request(`${v1}/memories?${qs.toString()}`, { headers });
    },

    async delete({ id }) {
      await request(`${v1}/memories/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
      });
    },

    async history({ id }) {
      return request(`${v1}/memories/${encodeURIComponent(id)}/chain`, {
        method: "GET",
        headers,
      });
    },

    async supersede({ id, content, reason }) {
      return request(`${v1}/memories/${encodeURIComponent(id)}/supersede`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content, reason }),
      });
    },

    async bootstrap() {
      return request<RecallResult>(`${v1}/memories/recall`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: "important context decisions preferences patterns",
          limit: 20,
          min_importance: 5,
          ...identity(),
        }),
      });
    },
  };
}

export function createLocalBackend(cfg: NonNullable<MemraConfig["local"]>): Backend {
  assertLoopback(cfg.url);
  const base = cfg.url.replace(/\/+$/, "");
  const v1 = `${base}/v1`; // memra-local routes are mounted under /v1
  const headers = localHeaders();

  return {
    mode: "local",

    async health() {
      try {
        await request(`${base}/health`, { timeoutMs: 3000 });
        return { ok: true };
      } catch (e) {
        return { ok: false, detail: (e as Error).message };
      }
    },

    async search({ query, limit = 10 }) {
      // memra-local has both /search (FTS5) and /recall — use recall for semantic
      return request<RecallResult>(`${v1}/memories/recall`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, limit, project_id: cfg.namespace }),
      });
    },

    async add({ content, type, importance, tags, metadata }) {
      return request(`${v1}/memories`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          content,
          project_id: cfg.namespace,
          type: type ?? "fact",
          importance: importance ?? 5,
          tags: tags ?? [],
          metadata: metadata ?? {},
        }),
      });
    },

    async get({ id }) {
      return request(`${v1}/memories/${encodeURIComponent(id)}?project_id=${encodeURIComponent(cfg.namespace)}`, {
        headers,
      });
    },

    async list({ limit = 50, type }) {
      const qs = new URLSearchParams({ project_id: cfg.namespace, limit: String(limit) });
      if (type) qs.set("type", type);
      return request(`${v1}/memories?${qs.toString()}`, { headers });
    },

    async delete({ id }) {
      await request(`${v1}/memories/${encodeURIComponent(id)}?project_id=${encodeURIComponent(cfg.namespace)}`, {
        method: "DELETE",
        headers,
      });
    },

    async history({ id }) {
      return request(
        `${v1}/memories/${encodeURIComponent(id)}/chain?project_id=${encodeURIComponent(cfg.namespace)}`,
        { headers },
      );
    },

    async supersede({ id, content, reason }) {
      return request(`${v1}/memories/${encodeURIComponent(id)}/supersede`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content, reason }),
      });
    },

    async bootstrap() {
      return request<RecallResult>(`${v1}/bootstrap`, {
        method: "POST",
        headers,
        body: JSON.stringify({ project_id: cfg.namespace, limit: 20 }),
      });
    },
  };
}

export function createBackend(cfg: MemraConfig): Backend {
  if (cfg.mode === "cloud") return createCloudBackend(cfg.cloud!);
  return createLocalBackend(cfg.local!);
}

/**
 * Best-effort lookup of a cloud project's human-readable name from its id.
 * Returns undefined on any failure (no key/id, network, 404) — callers fall
 * back to showing the raw project id, so this must never throw.
 */
export async function fetchProjectName(
  cfg: NonNullable<MemraConfig["cloud"]>,
): Promise<string | undefined> {
  if (!cfg.apiKey || !cfg.projectId) return undefined;
  try {
    const base = normalizeCloudBaseUrl(cfg.apiUrl || DEFAULT_CLOUD_BASE_URL);
    const v1 = base.endsWith("/api") ? `${base}/v1` : `${base}/api/v1`;
    const res = await request<{ name?: string }>(
      `${v1}/projects/${encodeURIComponent(cfg.projectId)}`,
      { headers: cloudHeaders(cfg.apiKey), timeoutMs: 5000 },
    );
    const name = res?.name?.trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

export async function autoDetect(cfg: MemraConfig): Promise<BackendMode | null> {
  if (cfg.cloud?.apiKey) return "cloud";
  try {
    const local = createLocalBackend(cfg.local!);
    const h = await local.health();
    if (h.ok) return "local";
  } catch {
    /* ignore */
  }
  return null;
}
