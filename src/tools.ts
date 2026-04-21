import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { Backend, RecallResult } from "./backend.ts";
import type { MemraConfig } from "./config.ts";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@mariozechner/pi-coding-agent";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

type ToolResult = { content: Array<{ type: "text"; text: string }>; details?: unknown };

function ok(text: string, details?: unknown): ToolResult {
  return { content: [{ type: "text", text }], details };
}

function err(e: unknown): ToolResult {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text: `❌ Memra error: ${msg}` }] };
}

function formatRecall(result: RecallResult): string {
  const items = result.data ?? [];
  const meta = result.meta;
  if (items.length === 0) return "No memories found.";

  const lines = items.map((m, i) => {
    const score = m.score ? ` [${(m.score * 100).toFixed(0)}%]` : "";
    const imp = m.importance ? ` ⭐${m.importance}` : "";
    const tags = m.tags?.length ? ` #${m.tags.join(" #")}` : "";
    const type_ = m.type ? ` (${m.type})` : "";
    return `${i + 1}. ${m.content}${type_}${score}${imp}${tags}`;
  });

  let out = lines.join("\n");
  if (meta) {
    out += `\n\n— ${meta.returned ?? items.length} of ${meta.total_candidates ?? "?"} candidates`;
    if (meta.degraded) out += " (degraded: keyword fallback)";
  }
  return out;
}

function truncateAndSave(raw: string): string {
  const t = truncateHead(raw, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  if (!t.truncated) return t.content;
  const tmp = join(tmpdir(), `memra-${randomUUID()}.txt`);
  void writeFile(tmp, raw, "utf8").catch(() => {});
  return (
    t.content +
    `\n\n[Output truncated: ${t.outputLines} of ${t.totalLines} lines (${formatSize(t.outputBytes)} of ${formatSize(t.totalBytes)}). Full output: ${tmp}]`
  );
}

export interface ToolDef {
  name: string;
  label: string;
  description: string;
  parameters: ReturnType<typeof Type.Object>;
  promptSnippet?: string;
  promptGuidelines?: string[];
  execute: (params: any, signal?: AbortSignal) => Promise<ToolResult>;
}

const MEMORY_TYPES = ["fact", "event", "pattern", "working", "decision", "preference", "context", "entity"] as const;

export function buildTools(
  getBackend: () => Backend,
  getConfig: () => MemraConfig,
): ToolDef[] {
  const recallParams = Type.Object({
    query: Type.String({ description: "Natural-language search query" }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 10 })),
  });

  const recallExec = async ({ query, limit }: { query: string; limit?: number }) => {
    try {
      const result = await getBackend().search({ query, limit });
      return ok(formatRecall(result), result);
    } catch (e) {
      return err(e);
    }
  };

  const rememberParams = Type.Object({
    content: Type.String({ description: "Memory content (what to remember)" }),
    type: Type.Optional(
      StringEnum(MEMORY_TYPES, { default: "fact", description: "Memory type" }),
    ),
    importance: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 10, default: 5, description: "1=low, 10=critical" }),
    ),
    tags: Type.Optional(Type.Array(Type.String({ description: "Tags for categorization" }))),
  });

  const rememberExec = async ({
    content,
    type,
    importance,
    tags,
  }: {
    content: string;
    type?: string;
    importance?: number;
    tags?: string[];
  }) => {
    try {
      const result = await getBackend().add({ content, type, importance, tags });
      const id = (result as any)?.id ?? "unknown";
      return ok(`✓ Memory stored (id: ${id})`, { id, result });
    } catch (e) {
      return err(e);
    }
  };

  return [
    {
      name: "memra_recall",
      label: "Memra · Recall",
      description:
        "Semantic search across the user's persistent memory. Use when the user references prior work, past decisions, project context, or says 'remember'. Returns ranked memories with relevance scores.",
      promptSnippet: "memra_recall — recall memories by semantic query before answering from scratch",
      promptGuidelines: [
        "Always recall memory BEFORE answering questions about past decisions, architecture, or project context.",
        "Use specific, descriptive queries rather than vague ones for better results.",
      ],
      parameters: recallParams,
      execute: recallExec,
    },
    {
      name: "memra_remember",
      label: "Memra · Remember",
      description:
        "Store a new long-term memory. Use for decisions, facts, preferences, or context worth recalling in future sessions. Do not use for ephemeral state.",
      promptSnippet: "memra_remember — persist a fact, decision, or preference for future sessions",
      promptGuidelines: [
        "Store important decisions, architectural choices, and user preferences as they arise.",
        "Tag memories well — they improve search quality later.",
        "Don't store trivial or ephemeral info — only things worth recalling in future sessions.",
      ],
      parameters: rememberParams,
      execute: rememberExec,
    },
    {
      name: "memra_get",
      label: "Memra · Get",
      description: "Fetch a single memory by id.",
      parameters: Type.Object({
        id: Type.String({ description: "Memory ID" }),
      }),
      async execute({ id }, signal) {
        try {
          const result = await getBackend().get({ id });
          return ok(truncateAndSave(JSON.stringify(result, null, 2)), result);
        } catch (e) {
          return err(e);
        }
      },
    },
    {
      name: "memra_list",
      label: "Memra · List",
      description: "List memories, optionally filtered by type.",
      parameters: Type.Object({
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
        type: Type.Optional(Type.String({ description: "Filter by memory type" })),
      }),
      async execute({ limit, type }, signal) {
        try {
          const result = await getBackend().list({ limit, type });
          return ok(truncateAndSave(JSON.stringify(result, null, 2)), result);
        } catch (e) {
          return err(e);
        }
      },
    },
    {
      name: "memra_delete",
      label: "Memra · Delete",
      description: "Delete a memory permanently. Use with caution — this is irreversible.",
      parameters: Type.Object({
        id: Type.String({ description: "Memory ID to delete" }),
      }),
      async execute({ id }, signal) {
        try {
          await getBackend().delete({ id });
          return ok(`✓ Memory ${id} deleted`);
        } catch (e) {
          return err(e);
        }
      },
    },
    {
      name: "memra_supersede",
      label: "Memra · Supersede",
      description:
        "Replace an outdated memory with a new version. Preserves the audit trail. Use when correcting or updating an existing memory rather than duplicating.",
      parameters: Type.Object({
        id: Type.String({ description: "ID of the memory being superseded" }),
        content: Type.String({ description: "New replacement content" }),
        reason: Type.Optional(Type.String({ description: "Why this memory is being superseded" })),
      }),
      async execute({ id, content, reason }, signal) {
        try {
          const result = await getBackend().supersede({ id, content, reason });
          const newId = (result as any)?.id ?? (result as any)?.data?.id ?? "unknown";
          return ok(`✓ Memory ${id} superseded by ${newId}`, { oldId: id, newId, result });
        } catch (e) {
          return err(e);
        }
      },
    },
    {
      name: "memra_history",
      label: "Memra · History",
      description: "Get the supersession chain for a memory (audit trail of how knowledge evolved).",
      parameters: Type.Object({
        id: Type.String({ description: "Memory ID" }),
      }),
      async execute({ id }, signal) {
        try {
          const result = await getBackend().history({ id });
          return ok(truncateAndSave(JSON.stringify(result, null, 2)), result);
        } catch (e) {
          return err(e);
        }
      },
    },
    {
      name: "memra_health",
      label: "Memra · Health",
      description: "Check backend reachability and configuration.",
      parameters: Type.Object({}),
      async execute() {
        try {
          const backend = getBackend();
          const h = await backend.health();
          const cfg = getConfig();
          const info = {
            backend: backend.mode,
            healthy: h.ok,
            detail: h.detail,
            namespace: cfg.mode === "cloud" ? cfg.cloud?.projectId : cfg.local?.namespace,
            autoRecall: cfg.autoRecall,
          };
          return ok(h.ok ? `✓ ${backend.mode} backend healthy` : `✗ ${backend.mode} backend DOWN: ${h.detail}`, info);
        } catch (e) {
          return err(e);
        }
      },
    },
    // Deprecated aliases — kept callable through one minor version for
    // back-compat with prompts that still reference memra_search / memra_add.
    // The primary verbs (memra_recall / memra_remember) match Memra SaaS v4.3.
    {
      name: "memra_search",
      label: "Memra · Search (deprecated alias of memra_recall)",
      description: "Deprecated alias of memra_recall. Prefer memra_recall in new prompts.",
      parameters: recallParams,
      execute: recallExec,
    },
    {
      name: "memra_add",
      label: "Memra · Add (deprecated alias of memra_remember)",
      description: "Deprecated alias of memra_remember. Prefer memra_remember in new prompts.",
      parameters: rememberParams,
      execute: rememberExec,
    },
  ];
}
