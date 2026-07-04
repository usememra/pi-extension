import { existsSync } from "node:fs";
import {
  loadConfig,
  saveConfig,
  saveLocalConfig,
  removeLocalConfig,
  probeLocalConfig,
  localOverrideExists,
  getConfigPath,
  getLegacyConfigPath,
  getLocalConfigPath,
  NAME_RE,
  type MemraConfig,
  type BackendMode,
  type LocalProjectConfig,
} from "./config.ts";
import { autoDetect, type Backend } from "./backend.ts";
import { BADGE_KEY, INSTALL_URL, MARKETING_URL, renderBadge } from "./ui.ts";

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
  config: MemraConfig; // the GLOBAL config — the persistable object saveConfig writes
  effective: MemraConfig; // config with the per-directory overlay applied (for routing/display)
  backend: Backend | null;
  localActive: boolean;
  rebuild: () => Promise<void>;
}

export function helpText(): string {
  return [
    "Memra — persistent memory for pi",
    "",
    "/memra             interactive hub",
    "/memra status      show active backend + health",
    "/memra switch      choose cloud or local",
    "/memra namespace [name] [--local]",
    "                   set project/namespace (--local saves a per-directory",
    "                   override; badge shows ‹.memra› while one is active)",
    "/memra tenant      set cloud tenant ID",
    "/memra setkey      set Memra API key (cloud)",
    "/memra autorecall  toggle auto-recall on new turns",
    "/memra signup      open signup page",
    "/memra reset       wipe local extension config",
    "",
    `Config: ${getConfigPath()}`,
    `Per-directory override: <workspace-root>/.memra/config.json (here: ${getLocalConfigPath()})`,
    `Legacy config (auto-migrated if found): ${getLegacyConfigPath()}`,
    `Docs: ${MARKETING_URL}`,
  ].join("\n");
}

// Recompute the footer badge from the effective config + live health, exactly
// like session_start does. Always pass a string — index.ts warns that null can
// crash pi footer renderers mid-/reload.
async function refreshBadge(ctx: CommandCtx, state: State): Promise<void> {
  if (!state.backend) {
    ctx.ui.setStatus(BADGE_KEY, "Memra (unset)");
    return;
  }
  const h = await state.backend.health();
  ctx.ui.setStatus(BADGE_KEY, renderBadge(state.effective ?? state.config, state.localActive, !h.ok));
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
  // Show the EFFECTIVE config the backend was actually built with — never
  // re-read the override from disk here, or status could display a project the
  // tools are not routing to (stale until the next rebuild).
  const eff = state.effective ?? cfg;
  const lines = [
    `Backend: ${cfg.mode}`,
    cfg.mode === "cloud"
      ? `Project: ${eff.cloud?.projectId} · Tenant: ${eff.cloud?.tenantId}`
      : `Namespace: ${eff.local?.namespace}`,
    cfg.mode === "cloud"
      ? `URL: ${cfg.cloud?.apiUrl} (key: ${cfg.cloud?.apiKey ? "set" : "missing"})`
      : `URL: ${cfg.local?.url}`,
    `Auto-recall: ${cfg.autoRecall ? "on" : "off"}`,
  ];
  if (state.localActive) {
    lines.splice(2, 0, `  ↳ from ${getLocalConfigPath()} (project-local override)`);
  } else if ((await probeLocalConfig()).invalid) {
    lines.splice(2, 0, `  ⚠ ${getLocalConfigPath()} exists but is invalid — using global config`);
  }
  if (backend) {
    const h = await backend.health();
    lines.push(`Health: ${h.ok ? "✓ OK" : `✗ DOWN — ${h.detail ?? "unknown"}`}`);
    if (!h.ok && cfg.mode === "local") {
      lines.push("", "Start memra-local:", "  pipx install 'memra-local>=0.3.1' && memra serve", "Or switch to cloud: /memra switch");
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
  await refreshBadge(ctx, state);
  ctx.ui.notify(`Switched to ${mode}.`, "success");
}

async function setNamespace(ctx: CommandCtx, state: State, arg: string): Promise<void> {
  // `/memra namespace <name>` is a one-shot: it saves to the GLOBAL config with
  // no prompts (the historical behavior). `--local` (or `local`) after the name
  // one-shot-saves the per-directory override instead. The "Save where?" select
  // only appears in the interactive no-arg flow.
  const tokens = arg.split(/\s+/).filter(Boolean);
  const argLocal = tokens[1] === "--local" || tokens[1] === "local";
  if (tokens.length > 2 || (tokens.length === 2 && !argLocal)) {
    ctx.ui.notify("Usage: /memra namespace [name] [--local]", "error");
    return;
  }
  const oneShot = tokens.length > 0;

  const prompt = state.config.mode === "cloud" ? "Project ID:" : "Namespace:";
  const name = tokens[0] ?? (await ctx.ui.input(prompt, "e.g. memra-brain, project-x"));
  if (!name) return;
  if (!NAME_RE.test(name)) {
    ctx.ui.notify("Namespace/project must use alphanumeric segments, dots, hyphens, or underscores.", "error");
    return;
  }

  let toLocal = argLocal;
  if (!oneShot) {
    const localOpt = `This project only — ${getLocalConfigPath()}`;
    const removeOpt = "Remove project-local override (use global)";
    const options = [localOpt, "Global config (all projects)"];
    if (localOverrideExists()) options.push(removeOpt);
    const where = await ctx.ui.select(`Save "${name}" where?`, options);
    if (!where) {
      // Dismissed select (Esc, or headless select resolving undefined) — say so
      // instead of silently dropping the name the user already typed.
      ctx.ui.notify("Cancelled — nothing changed.", "info");
      return;
    }

    if (where === removeOpt) {
      await removeLocalConfig();
      await state.rebuild();
      await refreshBadge(ctx, state);
      ctx.ui.notify("Project-local override removed — using global config.", "success");
      return;
    }
    toLocal = where === localOpt;
  }

  if (toLocal) {
    // Write only ./.memra/config.json. state.config stays the GLOBAL config;
    // rebuild() re-applies the overlay so the new project takes effect now.
    const local: LocalProjectConfig =
      state.config.mode === "cloud" ? { projectId: name } : { namespace: name };
    await saveLocalConfig(local);
  } else {
    // Change the global default project. A directory override (if any) still wins
    // for this directory — only the global fallback changes.
    if (state.config.mode === "cloud") {
      state.config.cloud!.projectId = name;
      // Drop the cached friendly name — it belongs to the previous project.
      state.config.cloud!.projectName = undefined;
    } else {
      state.config.local!.namespace = name;
    }
    await saveConfig(state.config);
  }
  await state.rebuild();
  await refreshBadge(ctx, state);
  if (toLocal) {
    ctx.ui.notify(`Namespace → ${name} (project-local)`, "success");
  } else if (state.localActive) {
    // The rebuild re-applied the directory override, so this global save did
    // not change routing here — don't let the toast imply it did.
    ctx.ui.notify(`Global default → ${name} — ‹.memra› override still active here.`, "success");
  } else {
    ctx.ui.notify(`Namespace → ${name}`, "success");
  }
}

async function setTenant(ctx: CommandCtx, state: State, arg: string): Promise<void> {
  if (state.config.mode !== "cloud") {
    ctx.ui.notify("Tenant ID is a cloud-only setting.", "warning");
    return;
  }
  const name = arg.trim() || (await ctx.ui.input("Tenant ID:", "e.g. pi-agent, my-team"));
  if (!name) return;
  if (!NAME_RE.test(name)) {
    ctx.ui.notify("Tenant ID must use alphanumeric segments, dots, hyphens, or underscores.", "error");
    return;
  }
  state.config.cloud!.tenantId = name;
  await saveConfig(state.config);
  await state.rebuild();
  await refreshBadge(ctx, state);
  // The tenant itself is never overridden per-directory, but flag the active
  // ‹.memra› project pin so the user knows the project part still differs from
  // the global default they may be looking at.
  ctx.ui.notify(
    state.localActive
      ? `Tenant → ${name} (‹.memra› project override still active here.)`
      : `Tenant → ${name}`,
    "success",
  );
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
    await refreshBadge(ctx, state);
  }
  ctx.ui.notify("API key saved.", "success");
}

async function toggleAutoRecall(ctx: CommandCtx, state: State): Promise<void> {
  state.config.autoRecall = !state.config.autoRecall;
  await saveConfig(state.config);
  // Refresh state.effective too — under an override it is a detached clone, so
  // memra_health would otherwise report the stale autoRecall value.
  await state.rebuild();
  ctx.ui.notify(`Auto-recall ${state.config.autoRecall ? "enabled" : "disabled"}.`, "success");
}

async function reset(ctx: CommandCtx, state: State): Promise<void> {
  // Delete the legacy file too — loadConfig falls back to it, so leaving it
  // behind would resurrect old settings after a reset.
  const targets = [getConfigPath(), getLegacyConfigPath()];
  if (localOverrideExists()) targets.push(getLocalConfigPath());
  const shown = targets.filter((f) => existsSync(f));
  const ok = await ctx.ui.confirm(
    "Reset Memra config?",
    `Deletes:\n${(shown.length ? shown : [getConfigPath()]).join("\n")}`,
  );
  if (!ok) return;
  const { unlink } = await import("node:fs/promises");
  for (const file of targets) {
    try {
      await unlink(file);
    } catch {
      /* ignore */
    }
  }
  state.config = await loadConfig();
  await state.rebuild();
  await refreshBadge(ctx, state);
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
