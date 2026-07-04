import { loadConfig, saveConfig, loadLocalConfig, applyOverlay, type MemraConfig } from "./config.ts";
import { createBackend, fetchProjectName, type Backend } from "./backend.ts";
import { buildTools } from "./tools.ts";
import { runCommand, initialConfigure, helpText, type State } from "./commands.ts";
import { BADGE_KEY, INSTALL_URL, renderBadge, welcomeMessage } from "./ui.ts";

// Structural types — we bind to the pi ExtensionAPI surface by shape
// so the extension stays resilient across minor pi versions.
interface ExtensionAPI {
  on: (event: string, handler: (event: any, ctx: any) => any) => void;
  registerTool: (def: any) => void;
  registerCommand: (name: string, opts: any) => void;
  sendMessage?: (msg: any, opts?: any) => void;
}

export default function memraExtension(pi: ExtensionAPI) {
  try {
    return memraExtensionUnsafe(pi);
  } catch (e) {
    // Never let factory-time errors escape. A hard failure during /reload can
    // leave the TUI in a bad state, so log and fail closed instead.
    console.error("[memra] factory error:", (e as Error).stack ?? (e as Error).message);
  }
}

function memraExtensionUnsafe(pi: ExtensionAPI) {
  const state: State = {
    config: undefined as unknown as MemraConfig,
    effective: undefined as unknown as MemraConfig,
    backend: null,
    localActive: false,
    rebuild: async () => {
      try {
        // `overridden` is applyOverlay's explicit flag — true whenever the
        // override file contributed the active mode's key, even when its value
        // equals the global one (an equal-value pin must still show ‹.memra›).
        const { config: effective, overridden } = applyOverlay(state.config, await loadLocalConfig());
        state.effective = effective;
        state.localActive = overridden;
        state.backend = createBackend(effective);
      } catch (e) {
        state.backend = null;
        console.error("[memra] backend init failed:", (e as Error).message);
      }
    },
  };

  const getBackendOrThrow = (): Backend => {
    if (!state.backend) {
      throw new Error("Memra backend not configured. Run /memra to set up.");
    }
    return state.backend;
  };

  // ── Register tools ──────────────────────────────────────────────
  // Tools are always visible to the LLM; they fail gracefully if unconfigured.
  const tools = buildTools(getBackendOrThrow, () => state.effective ?? state.config);
  for (const t of tools) {
    pi.registerTool({
      name: t.name,
      label: t.label,
      description: t.description,
      parameters: t.parameters,
      promptSnippet: t.promptSnippet,
      promptGuidelines: t.promptGuidelines,
      async execute(_id: string, params: any, signal?: AbortSignal) {
        return t.execute(params, signal);
      },
    });
  }

  // ── /memra command ──────────────────────────────────────────────
  pi.registerCommand("memra", {
    description: "Manage Memra memory backend (cloud / local)",
    handler: async (args: string, ctx: any) => {
      try {
        await runCommand(args ?? "", ctx, state);
      } catch (e) {
        ctx.ui.notify(`/memra failed: ${(e as Error).message}`, "error");
      }
    },
  });

  // ── Session lifecycle ───────────────────────────────────────────
  pi.on("session_start", async (_ev: any, ctx: any) => {
    try {
      state.config = await loadConfig();
      await state.rebuild();

      // Resolve the cloud project name if missing (best-effort, don't block)
      // so the badge can show a friendly name instead of the raw project id.
      if (
        state.config.mode === "cloud" &&
        state.config.cloud?.apiKey &&
        state.config.cloud?.projectId &&
        !state.config.cloud.projectName
      ) {
        void fetchProjectName(state.config.cloud).then((name) => {
          if (name && state.config.cloud) {
            state.config.cloud.projectName = name;
            void saveConfig(state.config);
          }
        });
      }

      // Auto-detect and configure if needed
      const cloudMissingKey =
        state.config.mode === "cloud" && !state.config.cloud?.apiKey && !process.env.MEMRA_API_KEY;
      const health = state.backend ? await state.backend.health() : { ok: false };
      const needsSetup = cloudMissingKey || !state.backend || !health.ok;

      if (needsSetup && ctx.hasUI) {
        await initialConfigure(ctx, state);
      }

      // Update badge
      const finalHealth = state.backend ? await state.backend.health() : { ok: false };
      const badge = state.backend
        ? renderBadge(state.effective ?? state.config, state.localActive, !finalHealth.ok)
        : "Memra (unset)";
      ctx.ui.setStatus(BADGE_KEY, badge);

      // Welcome message
      if (!state.config.welcomed) {
        ctx.ui.notify(welcomeMessage(state.config.mode), "success");
        state.config.welcomed = true;
        await saveConfig(state.config);
      }

      // Warm up bootstrap (best-effort, don't block)
      if (state.backend && finalHealth.ok) {
        void state.backend.bootstrap().catch(() => {});
      }
    } catch (e) {
      console.error("[memra] session_start error:", (e as Error).message);
    }
  });

  pi.on("session_shutdown", async (_ev: any, ctx: any) => {
    try {
      // Use an empty string instead of null. Some pi footer/status renderers
      // are stricter than the type surface suggests, and null can crash /reload
      // flows mid-render.
      ctx.ui.setStatus(BADGE_KEY, "");
    } catch {
      /* ignore */
    }
  });

  // ── Auto-recall: inject relevant memories before each agent turn ──
  pi.on("before_agent_start", async (event: any, ctx: any) => {
    if (!state.config) return;
    if (!state.config.autoRecall) return;
    if (!state.backend) return;

    try {
      const health = await state.backend.health();
      if (!health.ok) return;

      const prompt = event.prompt ?? "";
      // Skip tiny prompts (likely just commands)
      if (prompt.length < 10) return;

      // Build a focused recall query from the user's prompt
      const query = prompt.slice(0, 200);
      const result = await state.backend.search({ query, limit: 5 });

      if (!result.data || result.data.length === 0) return;

      // Format memories for injection
      const memLines = result.data.map((m, i) => {
        const imp = m.importance ? ` [importance: ${m.importance}]` : "";
        const type_ = m.type ? ` [${m.type}]` : "";
        return `${i + 1}. ${m.content}${type_}${imp}`;
      });

      const contextBlock = [
        "## Relevant Memories (auto-recalled)",
        "The following memories from your persistent memory store may be relevant to the user's request. Use them as context — but always verify against the current conversation.",
        "",
        ...memLines,
        "",
        "If these memories are relevant, use them. If not, ignore them. You can always search for more with memra_recall.",
      ].join("\n");

      return {
        message: {
          customType: "memra-context",
          content: contextBlock,
          display: false, // Don't show in TUI — just inject into LLM context
        },
      };
    } catch {
      // Best-effort — never block the agent if recall fails
    }
  });
}

export { helpText, INSTALL_URL };
