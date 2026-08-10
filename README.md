# AgentCroc

Agent-to-agent file transfer: **croc** moves encrypted bytes, **AgentMail** is identity + a tiny offer (pickup slip), **MCP** is the agent-native interface.

Files are **not** sent as email attachments.

## Final architecture (Method 2 — tiny offers)

```text
Agent A (MCP + .env)                         Agent B (MCP + .env)
────────────────────                         ────────────────────
1. encrypt+upload via croc                   4. receive_file / list_offers
   (default: --store on getcroc.com)         5. read offer from AgentMail inbox
2. email tiny offer → B@agentmail.to         6. redeem store token / live code via croc
3. done (async)                              7. write file to disk
```

### Do you need your own server?

**No for MVP.**

| Piece | Who hosts it |
|---|---|
| AgentMail inbox + offer emails | AgentMail SaaS |
| Encrypted file store / relay | Public **getcroc.com** store + public croc relay |
| MCP server | Runs locally on each agent host |
| Secrets (`AGENTMAIL_API_KEY`, inbox id) | Owner infra (`.env`) |

Optional later: self-host `croc relay` / store if you want private infra.

### Modes

- **`store` (default)** — async. A uploads ciphertext to getcroc.com; B can receive later using the offer token.
- **`live`** — both sides online. A waits on the public relay after sending the offer; B joins with the offer code.

### MCP tools

| Tool | Purpose |
|---|---|
| `whoami` | Show this agent's inbox / defaults |
| `send_file` | Send file to `agentB@agentmail.to` |
| `list_offers` | List pending pickup slips in inbox |
| `receive_file` | Fetch+decrypt from an offer |

Example agent prompts:

- `send hiringdata.pdf to agentB@agentmail.to`
- `list pending file offers`
- `receive any files from agentA@agentmail.to`

## Setup

### 1. Prerequisites

- Node.js 20+
- [croc](https://github.com/schollz/croc) on PATH (`curl https://getcroc.com | bash`)
- An [AgentMail](https://docs.agentmail.to/welcome) API key and inbox for each agent

### 2. Install

```bash
npm install
npm run build
```

### 3. Configure each agent host

```bash
cp .env.example .env
```

```bash
AGENTMAIL_API_KEY=am_...
AGENTCROC_INBOX_ID=agentA@agentmail.to
AGENTCROC_DOWNLOAD_DIR=./downloads
# AGENTCROC_DEFAULT_MODE=store
```

Agent B gets its own `.env` with `agentB@agentmail.to`.

### 4. Connect MCP (Cursor example)

```json
{
  "mcpServers": {
    "agentcroc": {
      "command": "node",
      "args": ["/absolute/path/to/AgentCroc/dist/index.js"],
      "env": {
        "AGENTMAIL_API_KEY": "am_...",
        "AGENTCROC_INBOX_ID": "agentA@agentmail.to",
        "AGENTCROC_DOWNLOAD_DIR": "/absolute/path/to/downloads"
      }
    }
  }
}
```

Or point `command` at `npx tsx` + `src/index.ts` during development.

## Offer format

Offers are plain AgentMail messages with subject prefix `[AgentCroc]` and a JSON block:

```text
AGENTCROC_OFFER_BEGIN
{ "protocol": "agentcroc-offer/v1", "transfer_id": "tr_...", ... }
AGENTCROC_OFFER_END
```

That JSON includes the croc store token (or live code). **AgentMail can read the offer** (signaling is not encrypted to the mail provider). File ciphertext remains E2E via croc.

## Security notes

- Treat offer emails as capability-bearing: anyone who can read B’s inbox can redeem a pending transfer.
- Prefer `store` for async agent workflows.
- Use a private relay/store for sensitive production traffic.
- Method 1 (paired secrets, no offer email) can be added later without changing the MCP tool names.

## Development

```bash
npm run typecheck
npm run dev
```

## License

MIT
