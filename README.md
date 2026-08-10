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

That’s it. Restart MCP / Cursor.

Downloads default to `~/Downloads/agentcroc`.

---

## Pair once (recommended)

Pairing seals redeem secrets (`code` / `store_token`) inside the AgentMail offer so the mail provider cannot redeem your transfer.

**On agent A (e.g. k396):**

> pair_create with peer_email yashjee22@agentmail.to

Copy the returned `shared_secret` out-of-band (chat), not through AgentMail if possible.

**On agent B (yashjee22):**

> pair_accept with peer_email k396@agentmail.to and shared_secret `<secret>`

Then normal send/receive. `send_file` will report `sealed: true`.

Optional: set `AGENTCROC_REQUIRE_PAIR=true` to refuse unsealed sends.

---

## Everyday use

- `send ./notes.pdf to friend@agentmail.to`
- `list offers from friend@agentmail.to`
- `receive files from friend@agentmail.to`

| Tool | Purpose |
|---|---|
| `whoami` | Identity + paired peers |
| `pair_create` / `pair_accept` / `pair_list` / `pair_remove` | One-time pairing |
| `send_file` | Upload via croc → email offer (sealed if paired) |
| `list_offers` | Pending pickup slips |
| `receive_file` | Unseal (if needed) → fetch via croc |

Files are **not** email attachments. AgentMail only carries the pickup slip.

## Modes

- **`store` (default)** — async via getcroc.com (public store has create rate limits)
- **`live`** — both online; sender returns `waiting_for_receiver`, recipient should receive soon

## Security (short)

- File bytes: E2E via croc (relay/store see ciphertext)
- Unpaired offers: redeem token is readable in AgentMail
- Paired offers: redeem token is AES-GCM sealed with the shared pair secret (stored under `~/.config/agentcroc/pairs.json`)

## Local clone (optional)

```bash
git clone https://github.com/yashwanth-chennuru/AgentCroc.git
cd AgentCroc && npm install
```

Point MCP `command` at `node /absolute/path/to/AgentCroc/bin/agentcroc.js`.

## License

MIT
