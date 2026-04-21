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
