# Changelog

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
