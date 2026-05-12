# waveapps-mcp

## Purpose

This is an add-on that lets you ask **Claude** (or any other AI assistant that supports MCP) to do your **Wave Accounting** bookkeeping for you. Instead of clicking through the Wave website to draft an invoice, you tell Claude something like:

> "Draft an invoice for Acme Corp — 8 hours of design work at $150/hr."

…and Claude creates the invoice in Wave for you. Same for recording payments, adding customers, looking up old estimates, and so on.

It works by giving Claude a set of structured tools — 23 of them — that map onto real Wave operations. Claude picks the right tools and calls them with the right arguments based on your conversation.

> **What's "MCP"?** [Model Context Protocol](https://modelcontextprotocol.io) — a standard way for AI assistants to call external tools. Anthropic's Claude apps speak it natively; so do Cursor, Continue, and a growing list of others.

## What it can do

Once it's installed, you can ask Claude to:

**Look things up**
- List your Wave workspaces (businesses)
- List or search invoices, customers, estimates, bills, receipts
- List or look up products & services (the line items you put on invoices)
- Pull the full details of a single invoice (line items, payments, taxes, etc.)
- List your chart of accounts

**Create + edit things**
- Add a new customer
- Add, edit, archive, or delete a product/service
- Draft, edit, approve, send, mark-as-sent, or delete an invoice
- Record or remove a payment against an invoice
- Draft, edit, or delete an estimate

Everything happens in your real Wave account — Claude doesn't have its own sandbox. Be deliberate with mutating operations, especially deletes and "send invoice".

## Before you start

You'll need:

- A **Mac, Linux, or Windows computer** with a terminal
- **[Node.js](https://nodejs.org)** version 20 or newer (run `node --version` to check; if you don't have it, install the LTS version from nodejs.org)
- A **[Wave](https://www.waveapps.com)** account you can sign in to in any browser
- An AI client that supports MCP — [Claude Desktop](https://claude.ai/download) is the easiest starting point for non-developers. [Claude Code](https://docs.claude.com/claude-code) works too.

## Installation

In a terminal, somewhere you keep your projects:

```bash
git clone https://github.com/your-username/waveapps-mcp.git
cd waveapps-mcp
npm install
npm run build
```

This downloads the code, installs its dependencies, and compiles it into a `dist/` folder. The compiled entry point is `dist/server.js` — you'll point Claude at that file in a moment.

Take note of the **full absolute path** to that file. You'll need it. On a Mac it might look like `/Users/yourname/code/waveapps-mcp/dist/server.js`. Get it by running:

```bash
echo "$(pwd)/dist/server.js"
```

## Sign in to Wave

The MCP needs to know how to talk to Wave on your behalf. Wave doesn't give regular users an API key, so instead we **borrow your browser's session cookie**. This sounds scary but is the same kind of thing many Wave-related browser extensions do — and the cookie stays on your machine.

```bash
npx waveapps-mcp paste
```

The command prompts you for three values:

1. The `waveapps` cookie value — your session token.
2. The `identity-csrftoken` cookie value — needed when you want Claude to *change* things in Wave (create invoices, record payments, etc.). Skip with Enter if you only want read access.
3. The business UUID — optional; lets Claude default to a specific workspace.

Here's how to get them:

1. Open `https://next.waveapps.com` in any browser. Sign in normally.
2. Open Developer Tools:
   - **macOS**: `Cmd + Option + I`
   - **Windows / Linux**: `Ctrl + Shift + I`
3. Find the **Application** tab (Chrome/Brave/Edge) or **Storage** tab (Firefox/Safari).
4. In the left sidebar, find **Cookies** → `https://next.waveapps.com`.
5. Find `waveapps` in the list and copy its **Value** column. Paste it when the command asks.
6. Repeat for `identity-csrftoken`.
7. For the business UUID, look at the URL in your browser — after sign-in it looks like `next.waveapps.com/c2cb3afe-5a24-41b2-add7-d1c6982d75a9/dashboard/`. The long string in the middle is the UUID. Copy it. (Or skip with Enter and tell Claude which workspace each time.)

The values are saved to `~/.config/waveapps-mcp/credentials.json` with restrictive file permissions (`0600` — only your user can read it).

> **Wave's session expires after a few days.** When that happens, tools will start returning a "WaveAuthError". Just run `npx waveapps-mcp paste` again with fresh cookies. You can also check what's stored at any time with `npx waveapps-mcp whoami` (token values are masked).

### Optional: auto-refresh on expiry

If re-pasting cookies a few times a week sounds annoying, you can opt into having the server log itself back into Wave whenever the session expires. **Read the security caveats first — they're meaningful.**

```bash
npx waveapps-mcp save-password
```

The command prompts for:

1. **Your Wave email** (defaults to the previous value if you've run it before).
2. **Your Wave password** (input hidden).
3. **Whether you have 2FA enabled.** If yes, it asks for your **TOTP secret** (the base32 string from your authenticator-app setup screen). You can usually re-export this from your authenticator app's "show secret" / "export" menu. If you don't have it, set up 2FA again temporarily and copy the secret when the QR code shows.

Once stored, the server uses a headless browser to silently re-log-in against Wave's own username/password form (no Google in the path, so no "browser may not be secure" issue) whenever a tool call returns 401. The retry happens transparently — the model just sees the original call succeed after ~5-10 seconds.

#### ⚠ Security trade-offs

- **Plaintext password.** Stored at `~/.config/waveapps-mcp/credentials.json` with mode 0600 (only your user can read it). Any process running as you (sketchy extensions, malware) can lift it. The trade-off is convenience for risk.
- **Storing the TOTP secret defeats 2FA.** Two-factor auth's whole point is that the second factor lives somewhere other than the first factor. Putting both in the same file collapses that protection. Only do this if your threat model already accepts machine compromise (single-user dev machine, FileVault/full-disk encryption on, no shared access).
- **Wave may flag the IP / send security emails** if it sees the same account log in from a headless browser at unusual times. Heads-up — you may get a "new sign-in" notification.

To remove the auto-refresh later: re-run `save-password` and leave email/password blank, OR `npx waveapps-mcp logout` to wipe everything and start over with `paste`.

## Wire it into Claude Desktop

Find your config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

If the file doesn't exist yet, create it. Open it in any text editor and add a `waveapps` entry under `mcpServers`. If you already have other MCP servers configured, just add `waveapps` to the existing list — don't replace the whole file.

```json
{
  "mcpServers": {
    "waveapps": {
      "command": "node",
      "args": ["/absolute/path/to/waveapps-mcp/dist/server.js"]
    }
  }
}
```

Replace `/absolute/path/to/waveapps-mcp/dist/server.js` with the path from earlier.

Quit Claude Desktop and reopen it. You should see a small 🔌 icon in the chat input — clicking it lists the available tools. If you see `wave_list_businesses`, `wave_create_invoice`, etc., it's wired up.

## Wire it into Claude Code

Run this in any project directory (or in your home directory for a global setup):

```bash
claude mcp add waveapps -- node /absolute/path/to/waveapps-mcp/dist/server.js
```

Then start a Claude Code session. The Wave tools become available automatically.

## Try it

Once wired up, try asking Claude:

- *"Show me my Wave businesses."*
- *"List my draft invoices."*
- *"Who's my most overdue customer?"*
- *"Draft an invoice for [customer name] — 6 hours of consulting at $200/hr, dated today."*
- *"Record a $500 cash payment against invoice #218."*

Claude will figure out which tools to call. If it doesn't have enough info (e.g. you didn't say which customer), it'll ask.

## When something goes wrong

| Symptom | Fix |
| --- | --- |
| Claude says "I don't have a tool for that" | Restart your Claude app — it only picks up MCP servers at startup. Confirm the path in your config points at a real file. |
| Tools error with "WaveAuthError" | Wave session expired. Run `npx waveapps-mcp paste` with fresh cookies — or set up `save-password` for invisible auto-refresh. |
| Tools error with "CSRF token configured" | You skipped the CSRF cookie when pasting. Re-run `npx waveapps-mcp paste` and provide it this time. |
| Claude tries to use a tool but says it can't find your business | Either pass `businessId` explicitly in your message, or re-run `paste` and provide the business UUID. |
| Auto-refresh fires but still fails | Check Wave's email for "new sign-in" notifications. Common causes: password changed, 2FA enabled (run `save-password` again with the TOTP secret), or Wave is rate-limiting from your IP. |
| Want to wipe everything | `npx waveapps-mcp logout` removes the credentials file. |

## Important caveats

- **This uses Wave's internal API, not a public/documented one.** Wave doesn't promise to keep its internal endpoints stable. If something breaks one day, it's probably because Wave changed something on their end — open an issue and we'll patch it.
- **Treat your credentials file as a password.** Anyone with read access to `~/.config/waveapps-mcp/credentials.json` can act as you in Wave. Don't commit it to git, don't paste it into shared chats, don't sync it to a public folder.
- **Be careful with destructive tools.** `wave_delete_invoice`, `wave_delete_customer`, `wave_send_invoice` etc. take real action against your live workspace. Claude usually confirms before destructive operations, but double-check what it's about to do.
- **Vendors aren't wrapped yet.** They live on Wave's older `accounting.waveapps.com` frontend. If you need to bill a new vendor on a Wave Bill, you'll have to add them through Wave's website first.

## License

MIT — see [LICENSE](./LICENSE).

You can use, modify, and redistribute this freely. There's no warranty; if it breaks your invoicing workflow that's on you. (Read: keep eyes on what Claude is doing in your Wave account, especially for the first few days.)

## For developers / contributors

Brief pointers if you want to hack on this:

- Source layout, API map, and captured GraphQL operations: see [docs/api-map.md](./docs/api-map.md) and [docs/captured-queries.md](./docs/captured-queries.md)
- Run the test suite: `npm test` (or `npm run test:coverage` for an HTML coverage report in `coverage/`)
- Smoke-test against a live Wave account: `WAVE_AUTH_TOKEN=... npm run smoke`
- An experimental browser-driven login flow is available via `npx waveapps-mcp login` — it uses puppeteer-core + the stealth plugin to try to get past Google's OAuth check. Often blocked; the manual `paste` flow above is more reliable.

Pull requests welcome — especially for Products & Services, Vendors, recurring invoices, and bill mutations, which are the main unwrapped surfaces.
