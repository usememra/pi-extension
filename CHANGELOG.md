# Changelog

## 4.5.0

**Version jump (0.3.9 → 4.5.0):** the extension version now tracks the Memra platform release. No breaking changes — the tool surface, config format, and backend contract are unchanged from 0.3.9.

- Tolerate + surface Memra Cloud v4.5 response fields (all optional, so memra-local and older cloud versions keep working unchanged):
  - `memra_remember` now reports the write `revision` and a non-complete `embedding_status` in its confirmation, and warns when the API returns `conflicts[]` (suggesting `memra_supersede` over duplicating)
  - Recall results carry the new staleness metadata (`staleness_score`, `staleness_status`, `last_confirmed`); non-fresh memories are flagged inline in `memra_recall` output
- Add `npm test` (`tsc --noEmit` typecheck) and pin `typescript` as a devDependency so the check is reproducible

## 0.3.9

Second hardening pass on the per-directory override + badge plumbing, from code review:

- Saving a project-local override now also writes a **self-ignoring `.memra/.gitignore`** (containing `config.json`, unless one already exists — the `.ddev` pattern), so a committed override file can't silently repoint collaborators' routing to a foreign project. The repo's own `.gitignore` is never touched
- `applyOverlay` returns an explicit `{ config, overridden }` instead of signalling an override via reference identity — an override whose value **equals** the current global one is now correctly reported as active (`‹.memra›` badge + status line) instead of sitting invisible and activating later by surprise when the global default changes
- `/memra namespace <name>` is a **one-shot** again: with the name supplied as an argument it saves to the global config immediately, no "Save where?" select (which blocked, and silently did nothing when dismissed or headless). New `--local` (or `local`) argument one-shot-saves the per-directory override instead: `/memra namespace my-proj --local`
- In the interactive no-arg flow, dismissing the "Save where?" select now shows "Cancelled — nothing changed." instead of silently dropping the name you typed
- When a `‹.memra›` override is active, saving a **global** project/namespace no longer shows a toast implying routing changed — it now says the global default was updated but the override is still active here; `/memra tenant` similarly flags the active project pin
- Badge string is now owned by **one** helper (`formatLabel` in `ui.ts`, used by `renderBadge`): backend factories no longer format UI labels (`Backend.label` and the threaded `localActive` display params are gone — labels were only consumed by the badge), and the five config commands that bypassed `renderBadge` via `setStatus(backend.label)` now re-render the full badge — the friendly cloud project name, the `‹.memra›` marker, and the `· DOWN` health suffix all survive every command path, and `setStatus` is never passed `null` (which can crash pi footer renderers on `/reload`)
- `NAME_RE` (project/namespace/tenant validation) is exported from `config.ts` and reused by `commands.ts` instead of being triplicated inline
- Docs caught up with the product: README/USER-INSTALL now document the real badge strings (`☁ memra cloud · <project>`, ` ‹.memra›`, ` · DOWN`), a "Per-directory override" section (file location incl. workspace-root resolution and the `$HOME` guard, precedence, gitignore behavior, removal), and the corrected write-locations claim (the extension also writes `.memra/config.json` + `.memra/.gitignore` on explicit local saves); `/memra help` lists the override file path and the `--local` flag

## 0.3.8

Hardening pass on the per-directory project/namespace override (`.memra/config.json`), from code review:

- Anchor the override file to the **workspace root** (nearest ancestor of cwd containing `.git`, falling back to cwd) instead of bare `process.cwd()` — it is now found when pi is launched from a repo subdirectory
- Never treat `~/.memra/config.json` as a project override: when the resolved directory is `$HOME` the file is ignored, and saving a project-local override there is refused with a clear error (the path sits inside the global `~/.memra` config dir and would silently override every home-launched session)
- `applyOverlay` no longer lets `MEMRA_PROJECT_ID` veto the directory override — env vars are only read by `loadConfig`, and only when no global config file exists; the doc comment now states the real precedence (override file > global config)
- Saving a project-local override now **merges** with the file's existing keys instead of overwriting the whole file, so setting a cloud `projectId` no longer destroys a local-mode `namespace` override (and vice versa)
- Invalid override files are no longer silent: malformed JSON / rejected values log a `[memra]` console error with the path and reason, and `/memra status` shows "exists but is invalid — using global config"
- `/memra status` reports the effective config the backend was actually built with (`state.effective`) instead of re-reading the override from disk, so status can never show a project the tools aren't routing to
- `/memra namespace` offers a "Remove project-local override" option when an override file exists
- `/memra reset` also deletes the legacy config (`~/.memra/pi-memra-extension.json`) — previously the fallback loader resurrected old settings — and the project-local override; the confirm prompt lists every file it will delete
- Changing the **global** cloud project via `/memra namespace` clears the cached `projectName`, so the badge can't show the old project's friendly name while routing to the new id
- `/memra autorecall` rebuilds the backend so `memra_health` reports the new value immediately when an override is active
- Fix corrupt-config recovery aliasing the in-memory defaults (`{ ...DEFAULTS }` shared the nested `cloud`/`local` objects; later mutations polluted the process-wide defaults)

## 0.3.7

- Require **memra-local >= 0.3.1** in the local-mode setup instructions. 0.3.1 caches the embedding model in `~/.cache/fastembed` (survives reboots — no ~90MB re-download that silently degraded recall to FTS-only), and ships the FTS5 query-escaping fix. No extension code changes; the REST API it consumes is unchanged
- Fix the in-app `/memra status` hint, which still printed `memra-local serve` (no such binary) — corrected to `memra serve`. The README was fixed in 0.3.3 but the `src/commands.ts` string was missed

## 0.3.6

- Fix stale `User-Agent` header (was hardcoded `memra-pi-extension/0.2.1`). It now reads the version from `package.json` at load time, so it tracks the real version automatically and won't drift again

## 0.3.5

- Migrate pi peer dependencies + imports from the deprecated `@mariozechner/*` scope to `@earendil-works/*` (`pi-ai`, `pi-coding-agent`) — the upstream packages were renamed
- Migrate `@sinclair/typebox` → `typebox` (the new pi packages' `StringEnum` returns the renamed `typebox` types; mixing the two scopes breaks the type contract)
- No behavior change; same exports used (`StringEnum`, `truncateHead`, `DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES`, `formatSize`, `Type`). Typechecks clean (`tsc --noEmit`) and loads cleanly under the pi runtime

## 0.3.4

- Status badge now shows the cloud **project name** instead of the raw project id, resolved best-effort from `GET /v1/projects/{id}` on session start and cached in config (`fetchProjectName` + `renderBadge`)
- Removed an unused/duplicate entry-point draft (`src/memra.ts`); folded its project-name feature into the canonical `index.ts` while keeping the `memra_recall` tool name and the config guard

## 0.3.3

- Fix README: the local server command is `memra serve`, not `memra-local serve` (the console script is `memra`; there is no `memra-local` binary)
- Note that memra-local's local embeddings now use fastembed/ONNX (no PyTorch) — no extension changes; the REST API it consumes is unchanged

## 0.3.0

- Add `memra_recall` + `memra_remember` as primary tools (match Memra SaaS v4.3 canonical verb names)
- Keep `memra_search` + `memra_add` callable as deprecated aliases for one minor version
- Auto-recall hook prompt text updated: "search for more with memra_recall" (calls `backend.search` directly — no behaviour change)
- Other tools (`memra_get`, `memra_list`, `memra_delete`, `memra_supersede`, `memra_history`, `memra_health`) unchanged

## 0.2.1

- restore extension package for local/project installs
- default cloud base URL to `https://usememra.com/api`
- normalize cloud base URLs with or without `/v1`
- validate namespace / project / tenant values before saving
- support legacy config file migration fallback
- document local install flow and recommended Memra Cloud env vars
