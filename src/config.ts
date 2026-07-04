import { readFile, writeFile, mkdir, chmod, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export type BackendMode = "cloud" | "local";

export interface MemraConfig {
  mode: BackendMode;
  cloud?: {
    apiUrl: string;
    apiKey?: string;
    projectId: string;
    tenantId: string;
    // Human-readable project name, resolved best-effort from the API and cached
    // here so the status badge can show a friendly name instead of the raw id.
    projectName?: string;
  };
  local?: {
    url: string;
    namespace: string;
  };
  welcomed: boolean;
  autoRecall: boolean;
}

const CONFIG_DIR = join(homedir(), ".memra");
// Historical filename kept from the @usememra/pi-extension era — renaming it
// would silently orphan every existing user's config on upgrade.
const CONFIG_FILE = join(CONFIG_DIR, "pi-extension.json");
const LEGACY_CONFIG_FILE = join(CONFIG_DIR, "pi-memra-extension.json");

// Shared by the override-file loader and commands.ts (setNamespace/setTenant)
// — segments of alphanumerics, hyphens, or underscores, optionally dotted.
export const NAME_RE = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/i;

/**
 * Per-project config: <workspace-root>/.memra/config.json
 *
 * {
 *   "projectId": "pi-temp",    // cloud project override
 *   "namespace": "pi-temp"     // local namespace override
 * }
 *
 * Only one of projectId/namespace is needed depending on mode.
 * Leave empty if you want to use the global config's project.
 *
 * The workspace root is the nearest ancestor of process.cwd() containing
 * `.git`, falling back to process.cwd() itself. When that directory is the
 * user's home, the override is ignored entirely — `~/.memra` is the GLOBAL
 * config dir, and a `~/.memra/config.json` must never silently override every
 * session launched from $HOME.
 *
 * This file overlays only the project/namespace onto the global config — every
 * other setting (mode, apiKey, tenantId, apiUrl, autoRecall) still comes from
 * the global config. Secrets (apiKey/tenantId) are never read from here.
 *
 * saveLocalConfig also drops a `.memra/.gitignore` containing `config.json`
 * (unless one already exists), so the override stays machine-local and a commit
 * can't silently repoint collaborators' routing.
 */
export interface LocalProjectConfig {
  projectId?: string; // for cloud
  namespace?: string; // for local
}

function workspaceRoot(): string {
  let dir = process.cwd();
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd(); // hit filesystem root — no repo found
    dir = parent;
  }
}

function localConfigPath(): string {
  return join(workspaceRoot(), ".memra", "config.json");
}

export function getLocalConfigPath(): string {
  return localConfigPath();
}

// True when an override file exists somewhere it is allowed to apply
// (i.e. the workspace root is not $HOME).
export function localOverrideExists(): boolean {
  return workspaceRoot() !== homedir() && existsSync(localConfigPath());
}

export interface LocalConfigProbe {
  config: LocalProjectConfig | null;
  // True when the override file exists but is unusable (malformed JSON, not an
  // object, or every provided value rejected) — lets `/memra status` tell an
  // invalid file apart from no file.
  invalid: boolean;
}

export async function probeLocalConfig(): Promise<LocalConfigProbe> {
  const file = localConfigPath();
  if (workspaceRoot() === homedir()) return { config: null, invalid: false };
  if (!existsSync(file)) return { config: null, invalid: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    console.error(`[memra] invalid project-local override ${file}: malformed JSON (${(e as Error).message})`);
    return { config: null, invalid: true };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error(`[memra] invalid project-local override ${file}: expected a JSON object`);
    return { config: null, invalid: true };
  }
  const candidate = parsed as Partial<LocalProjectConfig>;
  const out: LocalProjectConfig = {};
  let rejected = false;
  for (const key of ["projectId", "namespace"] as const) {
    const value = candidate[key];
    if (value === undefined) continue;
    if (typeof value === "string" && NAME_RE.test(value.trim())) {
      out[key] = value.trim();
    } else {
      rejected = true;
      console.error(
        `[memra] ignoring invalid "${key}" in ${file}: must use alphanumeric segments, dots, hyphens, or underscores`,
      );
    }
  }
  if (out.projectId || out.namespace) return { config: out, invalid: false };
  // No usable keys: an intentionally empty file means "use global" (not
  // invalid), but values that were present and rejected make the file invalid.
  return { config: null, invalid: rejected };
}

export async function loadLocalConfig(): Promise<LocalProjectConfig | null> {
  return (await probeLocalConfig()).config;
}

// The extension only writes the local config on an explicit /memra namespace
// "save to this project" action — never automatically. Merges with the file's
// existing (valid) keys so saving one mode's override never clobbers the
// other's.
export async function saveLocalConfig(local: LocalProjectConfig): Promise<void> {
  const root = workspaceRoot();
  if (root === homedir()) {
    throw new Error(
      `refusing to save a project-local override in your home directory — ` +
        `${localConfigPath()} is inside the global ~/.memra config dir. ` +
        `Run pi from inside a project, or save to the global config instead.`,
    );
  }
  const existing = (await probeLocalConfig()).config ?? {};
  const dir = join(root, ".memra");
  await mkdir(dir, { recursive: true });
  // Self-ignoring directory (the .ddev pattern): a committed override file
  // would silently repoint every collaborator's routing, so make git ignore it
  // by default. Never overwrite an existing .gitignore — a user who edited it
  // (e.g. to deliberately commit the file) has made that call. The repo's own
  // .gitignore is never touched.
  const ignoreFile = join(dir, ".gitignore");
  if (!existsSync(ignoreFile)) {
    await writeFile(ignoreFile, "config.json\n", "utf8");
  }
  await writeFile(localConfigPath(), JSON.stringify({ ...existing, ...local }, null, 2) + "\n", "utf8");
}

export async function removeLocalConfig(): Promise<void> {
  try {
    await unlink(localConfigPath());
  } catch {
    /* already gone */
  }
}

const DEFAULTS: MemraConfig = {
  mode: "local",
  cloud: {
    apiUrl: "https://usememra.com/api",
    projectId: "default",
    tenantId: "pi-agent",
  },
  local: {
    url: "http://127.0.0.1:8765",
    namespace: "default",
  },
  welcomed: false,
  autoRecall: true,
};

export async function loadConfig(): Promise<MemraConfig> {
  const sourceFile = existsSync(CONFIG_FILE)
    ? CONFIG_FILE
    : existsSync(LEGACY_CONFIG_FILE)
      ? LEGACY_CONFIG_FILE
      : null;

  let cfg: MemraConfig;
  if (!sourceFile) {
    const envKey = process.env.MEMRA_API_KEY?.trim();
    const envProject = process.env.MEMRA_PROJECT_ID?.trim();
    const envTenant = process.env.MEMRA_TENANT_ID?.trim();
    cfg = {
      ...DEFAULTS,
      mode: envKey ? "cloud" : DEFAULTS.mode,
      cloud: {
        ...DEFAULTS.cloud!,
        apiKey: envKey,
        projectId: envProject ?? DEFAULTS.cloud!.projectId,
        tenantId: envTenant ?? DEFAULTS.cloud!.tenantId,
      },
      local: { ...DEFAULTS.local! },
    };
  } else {
    try {
      const raw = await readFile(sourceFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<MemraConfig>;
      cfg = {
        ...DEFAULTS,
        ...parsed,
        autoRecall: parsed.autoRecall ?? DEFAULTS.autoRecall,
        cloud: { ...DEFAULTS.cloud!, ...(parsed.cloud ?? {}) },
        local: { ...DEFAULTS.local!, ...(parsed.local ?? {}) },
      };
    } catch {
      // Clone nested objects too — `{ ...DEFAULTS }` alone would alias
      // cfg.cloud/cfg.local to the module-level DEFAULTS, so later mutations
      // would pollute the defaults for the rest of the process.
      cfg = { ...DEFAULTS, cloud: { ...DEFAULTS.cloud! }, local: { ...DEFAULTS.local! } };
    }
  }

  // loadConfig returns the GLOBAL config only — it is the persistable object that
  // saveConfig() writes back. The per-directory overlay is applied separately via
  // applyOverlay() at backend-build time, so an override can never leak into the
  // global file.
  return cfg;
}

export interface OverlayResult {
  // The effective config for the current directory: the global `cfg` with the
  // per-directory project/namespace overlaid.
  config: MemraConfig;
  // True when the override file contributed the active mode's key — regardless
  // of whether its value happens to equal the global one. An equal-value pin is
  // still a pin: it must show the ‹.memra› marker, or it would sit invisible
  // and activate later by surprise when the global default changes.
  overridden: boolean;
}

/**
 * Overlay the per-directory project/namespace onto the global `cfg`.
 *
 * Never mutates `cfg` — the overlay lives only in the returned clone, keeping the
 * global config (and therefore saveConfig) free of directory-local values. When
 * the override value equals the global one, `config` is returned as-is but
 * `overridden` is still true — callers must use the explicit flag, never a
 * reference-identity check.
 *
 * Precedence: override file > global config. Env vars (MEMRA_PROJECT_ID etc.)
 * are only read by loadConfig, and only when no global config file exists —
 * they seed the defaults there and play no part in the overlay.
 */
export function applyOverlay(cfg: MemraConfig, local: LocalProjectConfig | null): OverlayResult {
  if (!local) return { config: cfg, overridden: false };
  if (cfg.mode === "cloud" && local.projectId) {
    const config =
      local.projectId === cfg.cloud!.projectId
        ? cfg
        : // Drop the cached projectName: it belongs to the global project, not the
          // overridden one, so the badge would otherwise show a stale friendly name.
          { ...cfg, cloud: { ...cfg.cloud!, projectId: local.projectId, projectName: undefined } };
    return { config, overridden: true };
  }
  if (cfg.mode === "local" && local.namespace) {
    const config =
      local.namespace === cfg.local!.namespace
        ? cfg
        : { ...cfg, local: { ...cfg.local!, namespace: local.namespace } };
    return { config, overridden: true };
  }
  return { config: cfg, overridden: false };
}

export async function saveConfig(cfg: MemraConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
  try {
    await chmod(CONFIG_FILE, 0o600);
    await chmod(CONFIG_DIR, 0o700);
  } catch {
    /* best-effort */
  }
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function getLegacyConfigPath(): string {
  return LEGACY_CONFIG_FILE;
}
