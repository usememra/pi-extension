# Changelog

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
