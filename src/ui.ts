import type { MemraConfig } from "./config.ts";

export const BADGE_KEY = "memra";
export const INSTALL_URL = "https://usememra.com/install";
export const MARKETING_URL = "https://usememra.com";

/**
 * Build the status-bar badge text. Defaults to the backend's own label, but
 * prefers a resolved cloud project name over the raw project id when one is
 * cached. Appends " · DOWN" when the backend health check is failing.
 */
export function renderBadge(config: MemraConfig, label: string, isDown: boolean): string {
  let text = label;
  if (config.mode === "cloud" && config.cloud?.projectName) {
    text = `☁ cloud · ${config.cloud.projectName}`;
  }
  return isDown ? `${text} · DOWN` : text;
}

export function welcomeMessage(mode: "cloud" | "local"): string {
  if (mode === "cloud") {
    return "Memra cloud active — your agent now has persistent, searchable memory across sessions.";
  }
  return `Memra local active — memories stored on this machine. Hosted sync at ${INSTALL_URL}`;
}
