# HANA Gateway MCP

An MCP server hosted on Render that lets any MCP client (ChatGPT Developer
Mode, Claude, Cursor, etc.) query SAP HANA (via ODBC) and/or SAP Business One
Service Layer on a local/on-prem machine — without ever exposing a port or IP
on the machine that holds the data. Same idea, and same underlying relay
mechanism, as the sibling project `../sql-gateway-mcp/` — this is a
HANA/Service-Layer-flavored variant, not a fork that shares code with it.

## Architecture

```
ChatGPT / Claude / any MCP client
        │  HTTPS, requires ?key=<MCP_ACCESS_TOKEN> or Authorization: Bearer
        ▼
Render: hana-gateway-mcp-server       <- always public, always on
        │  tools: list_connectors, run_named_query,
        │         run_sql_query, run_service_layer_query
        │
        │  WebSocket (outbound FROM the local PC side only)
        ▼
local-agent  (runs on any PC, identified by a CONNECTOR_ID + CONNECTOR_TOKEN)
        │  HANA jobs: enforces read-only (SELECT/WITH only) via ODBC,
        │  independent of what the server/client asked for
        │  Service Layer jobs: only ever issues GET - no create/update/delete
        ▼
SAP HANA (ODBC)              SAP B1 Service Layer (OData over HTTPS)
```

**Trust boundary, end to end:**

1. **Client → Render**: gated by `MCP_ACCESS_TOKEN` (a shared secret). Without
   it, anyone with the URL could call tools — this must be set for any real
   deployment.
2. **Render → local-agent**: gated by `CONNECTOR_TOKENS` — each PC has its own
   `connectorId:token` pair. Render only forwards a job to a connector that's
   currently online and matches the ID the tool call asked for.
3. **local-agent → SAP**: the agent decides what it's willing to run,
   *regardless* of what Render/the client sent.
   - HANA: named queries are limited to an explicit allowlist (`queries.js`);
     ad-hoc SQL (`run_sql_query`) is restricted to a single read-only
     `SELECT`/`WITH` statement, with DDL/DML keywords blocked (`sqlGuard.js`).
   - Service Layer: `serviceLayer.js` only exposes a GET function — there is
     no code path that issues POST/PATCH/DELETE against Service Layer, so a
     compromised/misbehaving server side can never turn a query into a write.
   This is defense in depth — even if the server side were ever compromised,
   the agent still won't run a write.

The local machine never opens an inbound port. It dials out over WebSocket
and stays connected; if it drops, it reconnects with exponential backoff.
One Render deployment serves **multiple connectors** at once (multiple
PCs/DBs/companies) — a tool call specifies which `connectorId` to target.

## Project structure

```
hana-gateway-mcp/
├── render-mcp-server/
│   ├── server.js            # MCP server + tool definitions + MCP_ACCESS_TOKEN auth gate
│   ├── agentRelay.js        # WebSocket hub: tracks connected connectors, routes jobs, matches replies
│   ├── package.json
│   └── render.yaml          # Render blueprint for one-click deploy
│
├── local-agent/
│   ├── agent.js              # Connects outbound to Render, listens for jobs, dispatches, replies
│   ├── hanaDb.js              # HANA ODBC driver (via the `odbc` npm package + SAP HANA ODBC driver)
│   ├── serviceLayer.js        # SAP B1 Service Layer client - cookie session, auto-renew, GET-only
│   ├── sqlGuard.js            # Read-only enforcement for ad-hoc HANA SQL (run_sql_query)
│   ├── queries.js             # ALLOWLIST — named, parameterized HANA queries (used by run_named_query)
│   ├── package.json
│   ├── .env.example
│   ├── install.bat            # One-touch setup for a brand-new Windows PC (generates its own token)
│   ├── start.bat / stop.bat   # Start/stop the connector as a background process
│   ├── install.ps1            # pm2-based installer, Windows (alternative to start/stop.bat)
│   └── install.sh             # pm2-based installer, Linux/macOS
│
└── README.md
```

## Tools exposed to the MCP client

- **`list_connectors`** — which PCs/connectors are currently online.
- **`run_named_query`** — run a pre-approved HANA query by name (`queryName` +
  `params`) from that connector's `queries.js` allowlist. Never accepts raw
  SQL.
- **`run_sql_query`** — run an ad-hoc HANA SQL `SELECT` the client writes
  itself (e.g. "list tables via `SYS.TABLES`, then query them"). Enforced
  read-only by the agent regardless of what's sent.
- **`run_service_layer_query`** — run a read-only GET against SAP B1 Service
  Layer: `path` (e.g. `"Items"`, `"Items('A001')"`) plus optional OData
  `query` options (`$filter`, `$select`, `$top`, `$orderby`, `$expand`). The
  agent logs into Service Layer itself and manages/renews the session cookie
  — the client never sees or needs credentials.

## Key rules to keep

- The agent decides what it's willing to run, independent of what the
  server/client asked for — defense in depth even if Render were compromised.
- Every connector has its own unique ID + strong random token; every client
  request needs `MCP_ACCESS_TOKEN`.
- Outbound-only from every local machine, always — no inbound ports, no port
  forwarding, no static IP requirement.
- Use a **least-privilege HANA login** for the connector, not `SYSTEM` — the
  read-only guard is software-level defense, not a substitute for real
  database permissions. Same for the Service Layer user: a role scoped to
  what it actually needs to read.
- Service Layer access is GET-only by design — do not add a write path to
  `serviceLayer.js` without deliberately deciding this project should allow
  writes (and adding an equivalent allowlist/guard layer for them).

## Hosting on Render

1. Push this repo (or just this `hana-gateway-mcp/` folder as its own repo)
   to GitHub.
2. Render → New → Blueprint (uses `render-mcp-server/render.yaml`), or
   manually: New Web Service, root directory `render-mcp-server`, build
   command `npm install`, start command `npm start`.
3. Set env vars in the Render dashboard:
   - `CONNECTOR_TOKENS` = `id1:token1,id2:token2,...` (one pair per connector)
   - `MCP_ACCESS_TOKEN` = a single strong random secret (required for any
     real deployment — without it the endpoint is unauthenticated)
4. Deploy. Endpoints become:
   - MCP: `https://<your-app>.onrender.com/mcp?key=<MCP_ACCESS_TOKEN>`
   - Agent relay: `wss://<your-app>.onrender.com/agent`
   - Health check: `https://<your-app>.onrender.com/healthz` (not gated —
     reveals only which connector IDs are online, no data)

## Setting up a local connector (new PC)

The simplest path: copy the `local-agent/` folder to the target PC (zip it,
USB drive, whatever) and double-click **`install.bat`**. It will:

1. Check Node.js is installed.
2. Ask for a `Connector ID` (unique name for that PC), then walk through two
   optional blocks — HANA and Service Layer — either or both, whichever this
   connector should serve.
3. **Generate a secure `CONNECTOR_TOKEN` itself** — no need to invent one.
4. Write `.env`, run `npm install`, and start the connector via `start.bat`.
5. Print (and save to `ADD_TO_RENDER.txt`) the `id:token` line to append to
   Render's `CONNECTOR_TOKENS`.

After that:
- **Start**: double-click `start.bat` (refuses to double-start if already
  running).
- **Stop**: double-click `stop.bat`.
- **Logs**: `agent.log` / `agent.err.log` in the same folder.

(`install.ps1`/`install.sh` are an older, `pm2`-based alternative — functionally
equivalent, kept for Linux/macOS or if you prefer a process manager.)

### HANA ODBC prerequisite

Unlike a pure-JS HANA client, ODBC needs the **SAP HANA ODBC driver**
(`HDBODBC` / `HDBODBC32`) installed and registered with the OS before
`npm install` will successfully build the `odbc` npm package's native
bindings:
- Windows: install the SAP HANA Client, which registers `HDBODBC` in ODBC
  Data Source Administrator. On Windows you'll also need the usual native
  build toolchain (Visual Studio Build Tools with the "Desktop development
  with C++" workload, or `npm install --global windows-build-tools`
  equivalent) for `node-gyp` to compile `odbc`.
- Linux/macOS: install the SAP HANA Client, ensure `odbcinst.ini` registers
  `HDBODBC`, and that `unixODBC` is present.

If a connector only needs Service Layer, leave the HANA block blank in
`install.bat` — `odbc` is an `optionalDependency`, so `npm install` won't
fail the whole install if it can't build (you just won't be able to use
`run_sql_query`/`run_named_query` on that connector).

### Adding real named queries

Edit `queries.js` on that PC — HANA uses positional `?` placeholders, see the
comment at the top of the file. This only matters for `run_named_query`;
`run_sql_query` doesn't need any predefined queries.

## Adding a new connector later

Run `install.bat` on the new machine, add the printed `id:token` to Render's
`CONNECTOR_TOKENS`, save. Render redeploys automatically. No code changes
needed on either side.

## Connecting an MCP client

- **ChatGPT**: Settings → Connectors → enable Developer Mode → Add custom
  connector → URL = `https://<your-app>.onrender.com/mcp?key=<MCP_ACCESS_TOKEN>`.
- **Claude**: claude.ai/Claude Desktop → Settings → Connectors → Add custom
  connector → same URL.
- Any other MCP client that supports a custom `Authorization: Bearer` header
  can use the bare `/mcp` URL with that header instead of the `?key=` query
  param — functionally identical, just avoids the token sitting in a URL.

Once connected, ask the client to `list_connectors` to confirm which PCs are
online, then `run_named_query` / `run_sql_query` (HANA) or
`run_service_layer_query` (SAP B1) against a specific `connectorId`.

## Known gaps / things to harden further

- No per-query audit log yet — can't currently tell who ran what after the
  fact. Worth adding if this is used by more than one trusted person.
- No rate limiting on Render's side.
- `run_sql_query`'s guard is a keyword blocklist, not a full SQL parser —
  reasonable defense in depth, but the real backstop against damage is the
  HANA login's own permissions, which should be read-only/least-privilege.
- `run_service_layer_query` is GET-only by construction (no write method
  exists in `serviceLayer.js`), which is the equivalent backstop on that
  side — same "software guard, not a substitute for real permissions"
  caveat applies to the Service Layer user's authorizations too.
