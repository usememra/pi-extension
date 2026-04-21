# Deep audit — @usememra/pi-extension (2026-04-20)

## Summary

This extension was recovered from the `pi-extension/v0.2.0` branch and audited against the current Memra Cloud and memra-local APIs.

## Findings

### Fixed

1. **Missing package path**
   - The local pi package path existed in `~/.pi/agent/settings.json` but the `pi-extension/` directory no longer existed.
   - Restored from the `pi-extension/v0.2.0` branch.

2. **Cloud base URL drift**
   - Extension defaulted to `https://api.usememra.com`, while the current product surfaces and health checks are based around `https://usememra.com/api`.
   - Fixed by defaulting to `https://usememra.com/api` and normalizing both `/api` and `/api/v1` forms.

3. **Cloud health route mismatch risk**
   - `health()` now correctly resolves to `/api/health` when needed.

4. **Legacy config compatibility**
   - Extension now reads legacy `~/.memra/pi-memra-extension.json` if present.

5. **Namespace / tenant validation**
   - User-entered namespace, project, and tenant values are now validated before saving.

### Still intentionally unchanged

1. **Cloud bootstrap implementation uses recall, not the dedicated bootstrap endpoint**
   - This is a design compromise, not a runtime bug.
   - It is acceptable for now because it is best-effort warmup only.
   - Could be improved later to call the Cloud bootstrap endpoint directly.

2. **Local bootstrap endpoint shape differs from Cloud MCP bootstrap semantics**
   - Extension currently treats bootstrap as a best-effort prewarm path, not a user-visible API guarantee.

3. **No automated extension test harness yet**
   - The package is installable and structurally valid, but runtime behavior inside pi still needs manual smoke verification.

## Recommended smoke test

1. `pi install ./pi-extension`
2. Start pi
3. `/reload`
4. `/memra status`
5. `/memra switch`
6. `/memra setkey`
7. Ask pi to store a memory
8. Ask pi to search that memory
9. Toggle `/memra autorecall`

## Release recommendation

Safe to continue with local/manual user verification.
Publish to npm only after at least one full smoke test in real pi confirms:
- `/memra` command available
- cloud backend healthy
- `memra_add` works
- `memra_search` works
- auto-recall does not error during normal turns
