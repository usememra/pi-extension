# @usememra/pi-memory

Persistent memory for [pi](https://github.com/badlogic/pi-mono) — the coding agent. Works with any LLM pi supports (Anthropic, OpenAI, Google, and more). Pick **cloud** ([Memra](https://usememra.com)) or **local** (memra-local) — same tools, same API, your choice.

> Your agent forgets everything between sessions. Memra is the memory layer that fixes that.

## Install

### From a local repo checkout

```bash
pi install ./pi-extension
```

### From npm (recommended for end users)

```bash
pi install npm:@usememra/pi-memory
```

Reload with `/reload`.

## Setup

On first session start the extension auto-detects:

1. `MEMRA_API_KEY` in env → **cloud** mode.
2. A running memra-local on `http://127.0.0.1:8765` → **local** mode.
3. Otherwise it asks you.

Cloud defaults to `https://usememra.com/api` and automatically talks to the public API at `/v1/...` and `/health`.

Config lives at `~/.memra/pi-extension.json` (mode `0600`). The only other thing ever written is the opt-in per-directory override (`<workspace-root>/.memra/config.json` plus a self-ignoring `.memra/.gitignore`) — see [Per-directory override](#per-directory-override).

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MEMRA_API_KEY` | Cloud API key (memra_live_...) |
| `MEMRA_PROJECT_ID` | Cloud project ID / namespace (default: `default`) |
| `MEMRA_TENANT_ID` | Cloud tenant ID / namespace root (default: `pi-agent`) |

## Commands

| Command | Action |
|--|--|
| `/memra` | Interactive hub |
| `/memra status` | Active backend + health |
| `/memra switch` | Pick cloud or local |
| `/memra namespace <name>` | Set the global project/namespace (one-shot, no prompts) |
| `/memra namespace <name> --local` | Pin a project/namespace for this directory only (one-shot) |
| `/memra namespace` | Interactive: asks for a name, then where to save (global / this project / remove override) |
| `/memra tenant <id>` | Set cloud tenant ID |
| `/memra setkey` | Set cloud API key |
| `/memra autorecall` | Toggle auto-recall on new turns |
| `/memra signup` | Open signup page |
| `/memra reset` | Wipe extension config |

A footer badge (`☁ memra cloud · <project>` or `⌂ memra local · <namespace>`) shows the active backend at all times. In cloud mode it prefers the project's human-readable name when one has been resolved. The badge appends ` ‹.memra›` while a per-directory override is active, and ` · DOWN` when the backend health check is failing.

## Per-directory override

You can pin a different project (cloud) or namespace (local) for a single repo without touching your global config:

```bash
/memra namespace my-project --local
```

This writes `<workspace-root>/.memra/config.json`:

```json
{
  "projectId": "my-project",   // used in cloud mode
  "namespace": "my-project"    // used in local mode
}
```

- **Location:** the workspace root is the nearest ancestor of pi's working directory containing `.git` (falling back to the working directory itself). If that directory is your home, the override is ignored — `~/.memra` is the global config dir and must never silently repoint every session launched from `$HOME`.
- **Precedence:** override file > global config. Only the project/namespace is overlaid; mode, API key, tenant, URL, and auto-recall always come from the global config (secrets are never read from the override file).
- **Visibility:** the badge shows ` ‹.memra›` whenever an override is active — even when its value equals the current global one (it's still a pin) — and `/memra status` names the override file.
- **Git:** the extension also writes a `.memra/.gitignore` containing `config.json` (unless one already exists), so the override stays machine-local instead of repointing collaborators' routing via a commit. Your repo's own `.gitignore` is never touched.
- **Removing it:** run `/memra namespace` and pick "Remove project-local override (use global)", or `/memra reset` (which deletes it along with the global config).

## Auto-Recall

When **auto-recall** is enabled (default), the extension automatically searches your memory store before each agent turn and injects relevant memories into the LLM context. This means your agent **remembers** across sessions without you having to ask.

Toggle with `/memra autorecall`.

## Tools (LLM-facing)

Every tool mirrors the Memra API surface:

| Tool | Description |
|------|-------------|
| `memra_recall` | Semantic recall by natural-language query (primary read verb) |
| `memra_remember` | Store a fact, decision, preference, or context (primary write verb) |
| `memra_get` | Fetch a single memory by ID |
| `memra_list` | List memories, optionally filtered by type |
| `memra_delete` | Delete a memory permanently |
| `memra_supersede` | Replace an outdated memory (preserves audit trail) |
| `memra_history` | View the supersession chain for a memory |
| `memra_health` | Check backend reachability |
| `memra_search` | Deprecated alias of `memra_recall` (still callable) |
| `memra_add` | Deprecated alias of `memra_remember` (still callable) |

The LLM picks tools automatically based on your conversation. The extension routes every call to the active backend (cloud or local).

## Security

- API key read from `MEMRA_API_KEY` → `~/.memra/pi-extension.json` → interactive prompt. Never logged.
- Local mode is bound to loopback (`127.0.0.1` / `localhost`) only.
- Cloud mode refuses non-HTTPS URLs.
- Namespace / project / tenant inputs are validated before saving.
- Writes confined to `~/.memra/pi-extension.json` plus — only on an explicit `--local` / "this project only" save — `<workspace-root>/.memra/config.json` and its self-ignoring `.memra/.gitignore`.

## Cloud vs Local

| | Cloud | Local |
|--|--|--|
| Storage | Managed (EU, Hetzner Helsinki) | Your machine |
| Sync | Multi-device | None (use cloud for sync) |
| Offline | No | Yes |
| Setup | API key | `pip install 'memra-local>=0.3.1' && memra serve` |
| Price | Free tier + paid plans | Free, BUSL-1.1 (memra-local) |

Get a cloud key: **[usememra.com/install](https://usememra.com/install)**

## Recommended config for Memra Cloud

For shared persistent memory across pi sessions, set:

```bash
export MEMRA_API_KEY="memra_live_..."
export MEMRA_PROJECT_ID="memra-brain"
export MEMRA_TENANT_ID="pi-agent"
```

Then run `pi` and `/reload`.

## License

MIT. Use it anywhere. The Memra backend (usememra.com) and memra-local server have their own licenses.
