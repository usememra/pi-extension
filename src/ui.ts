import type { MemraConfig, BackendMode } from "./config.ts";

export const BADGE_KEY = "memra";
export const INSTALL_URL = "https://usememra.com/install";
export const MARKETING_URL = "https://usememra.com";

/**
 * The ONE place that owns the badge string format:
 *   "☁ memra cloud · <name>" / "⌂ memra local · <name>"
 * with " ‹.memra›" appended when a per-directory override is active.
 */
export function formatLabel(mode: BackendMode, name: string, overridden: boolean): string {
  const prefix = mode === "cloud" ? "☁ memra cloud" : "⌂ memra local";
  return `${prefix} · ${name}${overridden ? " ‹.memra›" : ""}`;
}

/**
 * Build the status-bar badge text from the EFFECTIVE config (global config with
 * any per-directory override applied). Prefers a resolved cloud project name
 * over the raw project id when one is cached and no override is active — the
 * cached name belongs to the global project, and under an override the raw id
 * shows exactly what the pin routes to. Appends " · DOWN" when the backend
 * health check is failing.
 */
export function renderBadge(config: MemraConfig, overridden: boolean, isDown: boolean): string {
  const name =
    config.mode === "cloud"
      ? (overridden ? undefined : config.cloud?.projectName) ?? config.cloud?.projectId ?? "?"
      : (config.local?.namespace ?? "?");
  const text = formatLabel(config.mode, name, overridden);
  return isDown ? `${text} · DOWN` : text;
}

export function welcomeMessage(mode: "cloud" | "local"): string {
  if (mode === "cloud") {
    return "Memra cloud active — your agent now has persistent, searchable memory across sessions.";
  }
  return `Memra local active — memories stored on this machine. Hosted sync at ${INSTALL_URL}`;
}
