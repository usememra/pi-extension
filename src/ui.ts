export const BADGE_KEY = "memra";
export const INSTALL_URL = "https://usememra.com/install";
export const MARKETING_URL = "https://usememra.com";

export function welcomeMessage(mode: "cloud" | "local"): string {
  if (mode === "cloud") {
    return "Memra cloud active — your agent now has persistent, searchable memory across sessions.";
  }
  return `Memra local active — memories stored on this machine. Hosted sync at ${INSTALL_URL}`;
}
