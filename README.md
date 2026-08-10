# AgentCroc

Send files between agents by AgentMail identity. Encrypted with [croc](https://github.com/schollz/croc). Exposed as an MCP server.

## Quick setup (like a normal MCP)

**1. One-time: install croc**

```bash
curl https://getcroc.com | bash
```

**2. Get AgentMail credentials**

From [console.agentmail.to](https://console.agentmail.to): API key + inbox (e.g. `you@agentmail.to`).

**3. Paste into Cursor MCP settings**

```json
{
  "mcpServers": {
    "agentcroc": {
      "command": "npx",
      "args": ["-y", "github:yashwanth-chennuru/AgentCroc"],
      "env": {
        "AGENTMAIL_API_KEY": "am_...",
        "AGENTCROC_INBOX_ID": "you@agentmail.to"
      }
    }
  }
}
```

That’s it. Restart MCP / Cursor, then try:

- `send ./notes.pdf to friend@agentmail.to`
- `receive files from friend@agentmail.to`

Downloads default to `~/Downloads/agentcroc` (override with `AGENTCROC_DOWNLOAD_DIR` if you want).

Each agent that sends/receives needs its own MCP entry with **its** API key + inbox.

---

## What it does

| Tool | Purpose |
|---|---|
| `send_file` | Upload via croc → email a tiny offer to the other agent |
| `list_offers` | See pending offers in your inbox |
| `receive_file` | Fetch + decrypt the file |
| `whoami` | Show your configured identity |

Files are **not** email attachments. AgentMail only carries a small pickup slip; croc moves the encrypted bytes (public getcroc.com store by default — no server of yours required).

## Local clone (optional)

```bash
git clone https://github.com/yashwanth-chennuru/AgentCroc.git
cd AgentCroc && npm install
```

```json
{
  "mcpServers": {
    "agentcroc": {
      "command": "node",
      "args": ["/absolute/path/to/AgentCroc/bin/agentcroc.js"],
      "env": {
        "AGENTMAIL_API_KEY": "am_...",
        "AGENTCROC_INBOX_ID": "you@agentmail.to"
      }
    }
  }
}
```

## Modes

- **`store` (default)** — async; recipient can download later
- **`live`** — both agents online at once on the public relay

## Security (short)

Offer emails contain redeem tokens. Anyone who can read that inbox can claim a pending transfer. File contents stay E2E via croc.

## License

MIT
