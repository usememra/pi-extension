import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type BackendMode = "cloud" | "local";

export interface MemraConfig {
  mode: BackendMode;
  cloud?: {
    apiUrl: string;
    apiKey?: string;
    projectId: string;
    tenantId: string;
  };
  local?: {
    url: string;
    namespace: string;
  };
  welcomed: boolean;
  autoRecall: boolean;
}

const CONFIG_DIR = join(homedir(), ".memra");
const CONFIG_FILE = join(CONFIG_DIR, "pi-extension.json");
const LEGACY_CONFIG_FILE = join(CONFIG_DIR, "pi-memra-extension.json");

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

  if (!sourceFile) {
    const envKey = process.env.MEMRA_API_KEY?.trim();
    const envProject = process.env.MEMRA_PROJECT_ID?.trim();
    const envTenant = process.env.MEMRA_TENANT_ID?.trim();
    return {
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
  }
  try {
    const raw = await readFile(sourceFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<MemraConfig>;
    return {
      ...DEFAULTS,
      ...parsed,
      autoRecall: parsed.autoRecall ?? DEFAULTS.autoRecall,
      cloud: { ...DEFAULTS.cloud!, ...(parsed.cloud ?? {}) },
      local: { ...DEFAULTS.local!, ...(parsed.local ?? {}) },
    };
  } catch {
    return { ...DEFAULTS };
  }
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
