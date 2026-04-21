import { loadConfig, saveConfig, getConfigPath, getLegacyConfigPath, type MemraConfig, type BackendMode } from "./config.ts";
import { createBackend, autoDetect, type Backend } from "./backend.ts";
import { BADGE_KEY, INSTALL_URL, MARKETING_URL } from "./ui.ts";

export interface CommandCtx {
  ui: {
    select: (prompt: string, options: string[]) => Promise<string | undefined>;
    confirm: (title: string, message: string) => Promise<boolean>;
    input: (prompt: string, placeholder?: string) => Promise<string | undefined>;
    notify: (message: string, level?: "info" | "success" | "warning" | "error") => void;
    setStatus: (key: string, text: string | null) => void;
  };
}

export interface State {
  config: MemraConfig;
  backend: Backend | null;
  rebuild: () => Promise<void>;
}

export function helpText(): string {
  return [
    "Memra — persistent memory for pi",
    "",
    "/memra             interactive hub",
    "/memra status      show active backend + health",
    "/memra switch      choose cloud or local",
    "/memra namespace   set project/namespace",
    "/memra tenant      set cloud tenant ID",
    "/memra setkey      set Memra API key (cloud)",
    "/memra autorecall  toggle auto-recall on new turns",
    "/memra signup      open signup page",
    "/memra reset       wipe local extension config",
    "",
    `Config: ${getConfigPath()}`,
    `Legacy config (auto-migrated if found): ${getLegacyConfigPath()}`,
    `Docs: ${MARKETING_URL}`,
  ].join("\n");
}

async function pickBackend(ctx: CommandCtx, cfg: MemraConfig): Promise<BackendMode | undefined> {
  const options = [
    `Cloud (usememra.com) — hosted, multi-device sync${cfg.cloud?.apiKey ? " ✓" : " (needs API key)"}`,
    "Local (memra-local) — on-device, private, offline",
  ];
  const pick = await ctx.ui.select("Pick Memra backend:", options);
  if (!pick) return undefined;
  return pick.startsWith("Cloud") ? "cloud" : "local";
}

async function ensureCloudKey(ctx: CommandCtx, cfg: MemraConfig): Promise<boolean> {
  if (cfg.cloud?.apiKey) return true;
  const envKey = process.env.MEMRA_API_KEY?.trim();
  if (envKey) {
    cfg.cloud!.apiKey = envKey;
    return true;
  }
  const key = await ctx.ui.input("Memra API key (memra_live_...):", "paste key, or leave blank to cancel");
  if (!key) return false;
  if (!key.startsWith("memra_live_")) {
    ctx.ui.notify("That doesn't look like a Memra API key (expected memra_live_...)", "error");
    return false;
  }
  cfg.cloud!.apiKey = key.trim();
  return true;
}

export async function runCommand(args: string, ctx: CommandCtx, state: State): Promise<void> {
  const [sub, ...rest] = args.trim().split(/\s+/);
  const arg = rest.join(" ");

  if (!sub) return openHub(ctx, state);
  switch (sub) {
    case "status":
    case "health":
    case "info":
      return showStatus(ctx, state);
    case "switch":
      return switchBackend(ctx, state);
    case "namespace":
      return setNamespace(ctx, state, arg);
    case "tenant":
      return setTenant(ctx, state, arg);
    case "setkey":
      return setKey(ctx, state);
    case "autorecall":
      return toggleAutoRecall(ctx, state);
    case "signup":
      ctx.ui.notify(`Sign up: ${INSTALL_URL}`, "info");
      return;
    case "reset":
      return reset(ctx, state);
    case "help":
      ctx.ui.notify(helpText(), "info");
      return;
    default:
      ctx.ui.notify(`Unknown subcommand: ${sub}\n\n${helpText()}`, "warning");
  }
}

async function openHub(ctx: CommandCtx, state: State): Promise<void> {
  const actions = [
    "Status",
    "Switch backend",
    "Set namespace/project",
    "Set tenant ID",
    "Set API key",
    "Toggle auto-recall",
    "Sign up",
    "Help",
  ];
  const pick = await ctx.ui.select("Memra:", actions);
  if (!pick) return;
  const map: Record<string, string> = {
    Status: "status",
    "Switch backend": "switch",
    "Set namespace/project": "namespace",
    "Set tenant ID": "tenant",
    "Set API key": "setkey",
    "Toggle auto-recall": "autorecall",
    "Sign up": "signup",
    Help: "help",
  };
  return runCommand(map[pick] ?? "help", ctx, state);
}

async function showStatus(ctx: CommandCtx, state: State): Promise<void> {
  const cfg = state.config;
  const backend = state.backend;
  const lines = [
    `Backend: ${cfg.mode}`,
    cfg.mode === "cloud"
      ? `Project: ${cfg.cloud?.projectId} · Tenant: ${cfg.cloud?.tenantId}`
      : `Namespace: ${cfg.local?.namespace}`,
    cfg.mode === "cloud"
      ? `URL: ${cfg.cloud?.apiUrl} (key: ${cfg.cloud?.apiKey ? "set" : "missing"})`
      : `URL: ${cfg.local?.url}`,
    `Auto-recall: ${cfg.autoRecall ? "on" : "off"}`,
  ];
  if (backend) {
    const h = await backend.health();
    lines.push(`Health: ${h.ok ? "✓ OK" : `✗ DOWN — ${h.detail ?? "unknown"}`}`);
    if (!h.ok && cfg.mode === "local") {
      lines.push("", "Start memra-local:", "  pipx install memra-local && memra-local serve", "Or switch to cloud: /memra switch");
    }
    if (!h.ok && cfg.mode === "cloud" && !cfg.cloud?.apiKey) {
      lines.push("", `No API key set — get one at ${INSTALL_URL}`, "Then run: /memra setkey");
    }
  } else {
    lines.push("Health: no backend initialized");
  }
  ctx.ui.notify(lines.join("\n"), "info");
}

async function switchBackend(ctx: CommandCtx, state: State): Promise<void> {
  const mode = await pickBackend(ctx, state.config);
  if (!mode) return;
  state.config.mode = mode;
  if (mode === "cloud" && !(await ensureCloudKey(ctx, state.config))) return;
  await saveConfig(state.config);
  await state.rebuild();
  ctx.ui.setStatus(BADGE_KEY, state.backend?.label ?? null);
  ctx.ui.notify(`Switched to ${mode}.`, "success");
}

async function setNamespace(ctx: CommandCtx, state: State, arg: string): Promise<void> {
  const prompt = state.config.mode === "cloud" ? "Project ID:" : "Namespace:";
  const name = arg.trim() || (await ctx.ui.input(prompt, "e.g. memra-brain, project-x"));
  if (!name) return;
  if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/i.test(name)) {
    ctx.ui.notify("Namespace/project must use alphanumeric segments, dots, hyphens, or underscores.", "error");
    return;
  }
  if (state.config.mode === "cloud") {
    state.config.cloud!.projectId = name;
  } else {
    state.config.local!.namespace = name;
  }
  await saveConfig(state.config);
  await state.rebuild();
  ctx.ui.setStatus(BADGE_KEY, state.backend?.label ?? null);
  ctx.ui.notify(`Namespace → ${name}`, "success");
}

async function setTenant(ctx: CommandCtx, state: State, arg: string): Promise<void> {
  if (state.config.mode !== "cloud") {
    ctx.ui.notify("Tenant ID is a cloud-only setting.", "warning");
    return;
  }
  const name = arg.trim() || (await ctx.ui.input("Tenant ID:", "e.g. pi-agent, my-team"));
  if (!name) return;
  if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/i.test(name)) {
    ctx.ui.notify("Tenant ID must use alphanumeric segments, dots, hyphens, or underscores.", "error");
    return;
  }
  state.config.cloud!.tenantId = name;
  await saveConfig(state.config);
  await state.rebuild();
  ctx.ui.setStatus(BADGE_KEY, state.backend?.label ?? null);
  ctx.ui.notify(`Tenant → ${name}`, "success");
}

async function setKey(ctx: CommandCtx, state: State): Promise<void> {
  const key = await ctx.ui.input("Memra API key:", "memra_live_...");
  if (!key || !key.startsWith("memra_live_")) {
    ctx.ui.notify("Cancelled or invalid key.", "warning");
    return;
  }
  state.config.cloud!.apiKey = key.trim();
  await saveConfig(state.config);
  if (state.config.mode === "cloud") {
    await state.rebuild();
    ctx.ui.setStatus(BADGE_KEY, state.backend?.label ?? null);
  }
  ctx.ui.notify("API key saved.", "success");
}

async function toggleAutoRecall(ctx: CommandCtx, state: State): Promise<void> {
  state.config.autoRecall = !state.config.autoRecall;
  await saveConfig(state.config);
  ctx.ui.notify(`Auto-recall ${state.config.autoRecall ? "enabled" : "disabled"}.`, "success");
}

async function reset(ctx: CommandCtx, state: State): Promise<void> {
  const ok = await ctx.ui.confirm("Reset Memra config?", `Deletes ${getConfigPath()}`);
  if (!ok) return;
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(getConfigPath());
  } catch {
    /* ignore */
  }
  state.config = await loadConfig();
  try {
    state.backend = createBackend(state.config);
  } catch {
    state.backend = null;
  }
  ctx.ui.setStatus(BADGE_KEY, state.backend?.label ?? null);
  ctx.ui.notify("Config reset.", "success");
}

export async function initialConfigure(ctx: CommandCtx, state: State): Promise<void> {
  const detected = await autoDetect(state.config);
  if (detected) {
    state.config.mode = detected;
  } else {
    const mode = await pickBackend(ctx, state.config);
    if (!mode) return;
    state.config.mode = mode;
    if (mode === "cloud" && !(await ensureCloudKey(ctx, state.config))) return;
  }
  await saveConfig(state.config);
  await state.rebuild();
}
