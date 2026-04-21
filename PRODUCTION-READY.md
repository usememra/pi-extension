# Production-ready checklist for @usememra/pi-extension

## What was fixed in 0.2.1

- restored the missing extension package files from the `pi-extension/v0.2.0` branch
- fixed cloud default base URL to `https://usememra.com/api`
- normalized cloud base URLs with or without `/v1`
- health check now resolves correctly against `/api/health`
- added validation for project / namespace / tenant values before saving config
- supports reading a legacy config file if present
- documented local install and recommended cloud env vars

## Recommended user install

```bash
pi install npm:@usememra/pi-extension
```

Until published, local developers can use:

```bash
pi install ./pi-extension
```

Then in pi:

```text
/reload
/memra status
```

## Recommended cloud env

```bash
export MEMRA_API_KEY="memra_live_..."
export MEMRA_PROJECT_ID="memra-brain"
export MEMRA_TENANT_ID="pi-agent"
```

## Smoke test

- `/memra status` shows cloud or local backend healthy
- `memra_health` succeeds
- `memra_add` stores a memory
- `memra_search` can find it
- auto-recall can be toggled with `/memra autorecall`
