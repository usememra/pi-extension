# Install for pi users

## Local development install

From the repository root:

```bash
pi install ./pi-extension
```

Then inside pi:

```text
/reload
```

## npm install

```bash
pi install npm:@usememra/pi-extension
```

## Recommended Memra Cloud env

```bash
export MEMRA_API_KEY="memra_live_..."
export MEMRA_PROJECT_ID="memra-brain"
export MEMRA_TENANT_ID="pi-agent"
```

Then start pi and run:

```text
/memra status
```

## Where config is written

- Global: `~/.memra/pi-extension.json` (mode `0600`) — mode, API key, tenant, default project/namespace.
- Per-directory override (opt-in): `<workspace-root>/.memra/config.json` — pins this repo's project/namespace only. Created by `/memra namespace <name> --local` (or the "This project only" option), together with a `.memra/.gitignore` containing `config.json` so the pin stays machine-local. The workspace root is the nearest ancestor with `.git`; an override in `$HOME` itself is ignored.

While an override is active the footer badge shows ` ‹.memra›` (e.g. `☁ memra cloud · my-project ‹.memra›`). The override wins over the global project/namespace; remove it via `/memra namespace` → "Remove project-local override", or `/memra reset`.
