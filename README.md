# waveapps-mcp

[![Test](https://github.com/LunaParker/waveapps-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/LunaParker/waveapps-mcp/actions/workflows/test.yml)
[![Build](https://github.com/LunaParker/waveapps-mcp/actions/workflows/build.yml/badge.svg)](https://github.com/LunaParker/waveapps-mcp/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node 20+](https://img.shields.io/badge/node-%3E%3D20.18-brightgreen.svg)](https://nodejs.org)

## Purpose

This is an add-on that lets you ask **Claude** (or any other AI assistant that supports MCP) to do your **Wave Accounting** bookkeeping for you. Instead of clicking through the Wave website to draft an invoice, you tell Claude something like:

> "Draft an invoice for Acme Corp: 8 hours of design work at $150/hr."

…and Claude creates the invoice in Wave for you. Same for recording payments, adding customers, looking up old estimates, and so on.

It works by giving Claude a set of 58 structured tools that map onto real Wave operations. Claude picks the right tools and calls them with the right arguments based on your conversation.

> **What's "MCP"?** [Model Context Protocol](https://modelcontextprotocol.io) is a standard way for AI assistants to call external tools. Anthropic's Claude apps speak it natively; so do Cursor, Continue, and a growing list of others.

## What it can do

Once it's installed, you can ask Claude to:

**Look things up**
- List your Wave workspaces (businesses)
- List invoices, estimates, bills and receipts; list or search customers by name or email
- List or look up products & services (the line items you put on invoices)
- Pull the full details of a single invoice or estimate (line items, payments, taxes, etc.)
- List your chart of accounts
- List and look up recurring invoices (read only: Wave can't delete one, so this doesn't create them)
- List your sales taxes (HST, GST and so on), with the tax ids invoices and estimates need
- Run reports: profit and loss, balance sheet, cash flow, trial balance, sales tax, income by customer, purchases by vendor, account balances, and aged receivables and payables, on an accrual or cash basis
- Export any of those reports as a CSV or PDF file, the same files Wave's own Export menu produces
- Answers are trimmed to what matters (names, dates, amounts, statuses and the ids other tools need); ask for the "raw" invoice if you ever need Wave's full record

**Create + edit things**
- Add, look up, or edit a customer (edits keep the stored address, shipping details and contacts unless you change them)
- Create a customer statement (outstanding invoices, or account activity over a date range) as a shareable link, and email it
- Add, edit, archive, or delete a product/service
- Draft, edit (one field at a time if you like), approve, send, mark-as-sent, or delete an invoice; new invoices follow your workspace's currency, payment terms, column headings, footer and memo unless you say otherwise
- Duplicate an invoice, send a payment reminder or a payment receipt, and fetch an invoice's PDF as a file Claude can read or hand back to you
- Record or remove a payment against an invoice
- Record, look up, edit or delete bank and cash transactions (money in or out, categorised to an income or expense account), and create tags to label them
- Draft, edit, approve, send, mark as sent or accepted, duplicate, or delete an estimate, turn one into an invoice, and fetch its PDF as a file

Everything happens in your real Wave account. Claude doesn't have its own sandbox. Be deliberate with mutating operations, especially deletes and "send invoice", or switch them off entirely with [read-only mode](#read-only-mode).

## Read-only mode

Start the server with `WAVE_MCP_READ_ONLY=1` and Claude gets only the 24 tools that read: lists, lookups, reports, report exports and PDFs. The 34 tools that mutate data (ie, creating, changing, sending or deleting) are never registered, so they don't appear in the client's tool list and Claude won't be able to call them. That holds however Claude is prompted, including by text it reads along the way: even if a customer note or a pasted email were to attempt prompt injection (although we try to mitigate this danger), the read-only flag is a hard stop that would prevent it from sending an invoice, given that there's no tool to send it with.

In Claude Desktop, add an `env` block to the `waveapps` entry:

```json
{
  "mcpServers": {
    "waveapps": {
      "command": "node",
      "args": ["/absolute/path/to/waveapps-mcp/dist/server.js"],
      "env": { "WAVE_MCP_READ_ONLY": "1" }
    }
  }
}
```

In Claude Code:

```bash
claude mcp add waveapps -e WAVE_MCP_READ_ONLY=1 -- node /absolute/path/to/waveapps-mcp/dist/server.js
```

Behind the [claude.ai gateway](#using-it-from-claudeai), set it on the server process, not the gateway.

Read-only mode limits what Claude can change, not what it can see: customer names, emails and addresses, invoice amounts and reports are all still readable. It doesn't limit the session either. Wave has no read-only API keys, so the token in `credentials.json` can still do anything you can do in Wave; keep it as private as a password.

## Before you start

You'll need:

- A **Mac, Linux, or Windows computer** with a terminal
- **[Node.js](https://nodejs.org)** version 20 or newer (run `node --version` to check; if you don't have it, install the LTS version from nodejs.org)
- A **[Wave](https://www.waveapps.com)** account you can sign in to in any browser
- An AI client that supports MCP. [Claude Desktop](https://claude.ai/download) is the easiest starting point for non-developers. [Claude Code](https://docs.claude.com/claude-code) works too.

## Installation

In a terminal, somewhere you keep your projects:

```bash
git clone https://github.com/LunaParker/waveapps-mcp.git
cd waveapps-mcp
npm install
npm run build
```

This downloads the code, installs its dependencies, and compiles it into a `dist/` folder. The compiled entry point is `dist/server.js`, which you'll point Claude at in a moment.

Take note of the **full absolute path** to that file. You'll need it. On a Mac it might look like `/Users/yourname/code/waveapps-mcp/dist/server.js`. Get it by running:

```bash
echo "$(pwd)/dist/server.js"
```

## Sign in to Wave

Wave doesn't give regular users an API key, so the MCP uses the same session your browser gets when you sign in. Wave's sign-in pages sit behind Cloudflare bot protection that turns away scripted requests, so signing in happens in a real Chromium window driven by [Playwright](https://playwright.dev). The session cookie stays on your machine.

Run the commands in this section from the `waveapps-mcp` folder you just built. The package isn't on npm, so `npx waveapps-mcp` only finds it there. Errors from the server spell out the full `node …/dist/server.js` command instead, so they work from any folder.

Install Playwright's Chromium once (about 150 MB):

```bash
npx playwright install chromium
```

Then sign in:

```bash
npx waveapps-mcp login
```

A Chromium window opens on Wave's sign-in page. Sign in as you normally would, including any CAPTCHA and your 2FA code. When the Wave dashboard loads, the session is saved to `~/.config/waveapps-mcp/credentials.json` with restrictive file permissions (`0600`, only your user can read it) and the window closes. The window uses its own profile at `~/.config/waveapps-mcp/chromium-profile`, so your everyday browser is never touched.

> **Wave sessions last at most 18 hours, and end after 8 hours without use.** When one expires, tools return a "WaveAuthError". Run `npx waveapps-mcp login` again, or set up automatic sign-in below. Check what's stored at any time with `npx waveapps-mcp whoami` (token values are masked).

<details>
<summary>Fallback: paste the cookies by hand (no browser on this machine, e.g. over SSH)</summary>

```bash
npx waveapps-mcp paste
```

The command prompts you for three values:

1. The `waveapps` cookie value (your session token).
2. The `identity-csrftoken` cookie value, needed when you want Claude to *change* things in Wave (create invoices, record payments, etc.). Skip with Enter if you only want read access.
3. The business UUID (optional), which lets Claude default to a specific workspace.

Here's how to get them:

1. Open `https://next.waveapps.com` in any browser. Sign in normally.
2. Open Developer Tools:
   - **macOS**: `Cmd + Option + I`
   - **Windows / Linux**: `Ctrl + Shift + I`
3. Find the **Application** tab (Chrome/Brave/Edge) or **Storage** tab (Firefox/Safari).
4. In the left sidebar, find **Cookies** → `https://next.waveapps.com`.
5. Find `waveapps` in the list and copy its **Value** column. Paste it when the command asks.
6. Repeat for `identity-csrftoken`.
7. For the business UUID, look at the URL in your browser. After sign-in it looks like `next.waveapps.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/dashboard/`. The long string in the middle is the UUID. Copy it. (Or skip with Enter and tell Claude which workspace each time.)

</details>

### Optional: automatic sign-in on expiry

If signing in once a day sounds annoying, you can let the server sign itself back in whenever the session expires. **Read the security caveats first: they're meaningful.**

```bash
npx waveapps-mcp save-password
```

The command prompts for:

1. **Your Wave email** (defaults to the previous value if you've run it before).
2. **Your Wave password** (input hidden).
3. **Whether you have 2FA enabled.** If yes, it asks for your **TOTP secret** (the base32 string from your authenticator-app setup screen). You can usually re-export this from your authenticator app's "show secret" / "export" menu. If you don't have it, set up 2FA again temporarily and copy the secret when the QR code shows.

The email goes in `credentials.json`. The password and TOTP secret go in your operating system's credential store: the **macOS Keychain**, **Windows Credential Manager** or the **Linux Secret Service** (GNOME Keyring, KWallet), under the service name `waveapps-mcp`.

Try it from a terminal before relying on it (add `--headed` to watch it work in a window):

```bash
npx waveapps-mcp refresh
```

From then on, when a tool call finds the session expired, the server does the same thing in a headless browser: it enters your email and password on Wave's sign-in page, then a 2FA code generated from the stored secret (ticking "Don't ask me for a code on this device for 30 days"), saves the new session and retries the call. That takes 15–30 seconds. If two Claude windows hit an expired session at once, one signs in and the other reuses its session.

If Wave shows a visible CAPTCHA, or Cloudflare blocks the browser, automatic sign-in stops. It never tries to solve a CAPTCHA. The tool error tells you to run `npx waveapps-mcp login` and sign in by hand.

> **macOS:** the Keychain item belongs to the Node.js binary that stored it. If you later run the server with a different Node (after an upgrade, say), macOS asks whether to allow access; choose **Always Allow**.

> **Upgrading from an older version?** Older versions kept the password and TOTP secret in `credentials.json` in plain text. The first time the server or any CLI command runs, it moves them into the credential store and removes them from the file.

#### ⚠ Security trade-offs

- **The credential store is better than a file, not a vault.** It keeps the password out of backups, dotfile sync and accidental commits, but programs running as you can still ask for it.
- **Storing the TOTP secret defeats 2FA.** Two-factor auth's whole point is that the second factor lives somewhere other than the first factor. With both on one machine, that machine alone can sign in as you. Only do this if your threat model already accepts machine compromise (single-user machine, FileVault/full-disk encryption on, no shared access).
- **Wave watches its sign-in page.** It runs hCaptcha and device fingerprinting there, and may send "new sign-in" emails or ask for a CAPTCHA if it sees automated sign-ins. The dedicated browser profile keeps its cookies between runs so each sign-in looks like the same device.
- **This is unofficial.** Wave offers no API for this, so automated sign-in can break whenever Wave changes its sign-in pages.

To turn automatic sign-in off: `npx waveapps-mcp logout` removes `credentials.json` and the credential-store entries; then `npx waveapps-mcp login` to sign in by hand again.

## Wire it into Claude Desktop

Find your config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

If the file doesn't exist yet, create it. Open it in any text editor and add a `waveapps` entry under `mcpServers`. If you already have other MCP servers configured, just add `waveapps` to the existing list instead of replacing the whole file.

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

Quit Claude Desktop and reopen it. You should see a small 🔌 icon in the chat input, and clicking it lists the available tools. If you see `wave_list_businesses`, `wave_create_invoice`, etc., it's wired up.

## Wire it into Claude Code

Run this in any project directory (or in your home directory for a global setup):

```bash
claude mcp add waveapps -- node /absolute/path/to/waveapps-mcp/dist/server.js
```

Then start a Claude Code session. The Wave tools become available automatically.

## Configuration

Nothing in this project reads a `.env` file. Set these in your shell, or in the `env` block of the MCP client's config entry for `waveapps`. Everything is optional once you have signed in.

| Variable | What it does |
| --- | --- |
| `WAVE_AUTH_TOKEN` / `WAVE_CSRF_TOKEN` | Use these session cookie values instead of the stored credentials file. The CSRF token is only needed for tools that change things. |
| `WAVE_BUSINESS_ID` | Default business UUID when you have more than one. Tools also accept `businessId` per call. |
| `WAVE_EMAIL` | The Wave email automatic sign-in uses, instead of the one in `credentials.json`. Handy on a server or in a container, where nobody is there to type it. |
| `WAVE_MCP_CONFIG_DIR` | Where `credentials.json` and the sign-in browser profile live. Default `~/.config/waveapps-mcp`. |
| `WAVE_MCP_BROWSER_PATH` | A Chromium-based browser to use for sign-in instead of Playwright's. |
| `WAVE_MCP_READ_ONLY` | `1` or `true` registers only the 24 tools that read (lists, lookups, reports and PDFs), so a client can't create, change, send or delete anything through this server. `0`, `false` or unset gives all 58. Any other value stops the server at startup. See [Read-only mode](#read-only-mode). |
| `WAVE_MCP_LOG_LEVEL` | `debug`, `info` (default), `warn` or `error`. Logs go to stderr. |
| `WAVE_LIVE_SIGNED_IN` / `WAVE_LIVE_WRITES` / `WAVE_LIVE_TEST_CUSTOMER_ID` | Development only, for the live contract tests: `1` turns on the signed-in read checks or the real write checks (`npm run test:live:signed-in` and `npm run test:live:writes` set them for you), and the customer id names the throwaway test customer the write checks may create, change, email and delete records for. |
| `WAVE_MCP_TRANSPORT` | `stdio` (default) or `http`. |
| `WAVE_MCP_BIND` / `WAVE_MCP_PORT` | Where the HTTP transport listens. Default `127.0.0.1:8765`. |
| `WAVE_MCP_HTTP_TOKEN` | Bearer token HTTP clients must send. Required when `WAVE_MCP_BIND` is not a loopback address, because anyone who can reach the port can otherwise act in your Wave account. |
| `WAVE_MCP_HTTP_TOKEN_FILE` | A file holding the bearer token, instead of `WAVE_MCP_HTTP_TOKEN` (set one or the other). Read once at startup. |
| `WAVE_PASSWORD_FILE` / `WAVE_TOTP_SECRET_FILE` | Files holding the Wave password and TOTP secret, for machines without an OS credential store. When either is set, the server reads secrets only from these files (on every use, so you can replace them without a restart), `save-password` records just your email (the first `refresh` does that on a new machine), and `logout` leaves the files alone. Keep them `chmod 600`. |

With the HTTP transport, loopback listeners also refuse requests whose `Host` header names anything other than a loopback address (`localhost`, `127.x.x.x` or `::1`, on any port), which blocks DNS-rebinding attacks from web pages.

## Using it from claude.ai

Claude's apps call remote connectors from Anthropic's servers, so a connector has to be reachable from the internet. The `gateway/` folder makes that safe: a small [FastMCP](https://gofastmcp.com) proxy that signs people in with Google, admits only the email addresses you list, and passes their calls to this server over loopback with a token only the two of them share.

```
Claude --HTTPS--> your public URL --> gateway (127.0.0.1:8000) --token--> waveapps-mcp (127.0.0.1:8765) --> Wave
```

The gateway only listens on loopback. Giving it a public HTTPS address (Tailscale Funnel, a Cloudflare Tunnel or a reverse proxy) is up to you. With Funnel, use port 443: in testing, claude.ai couldn't reach a Funnel on port 8443, so Funnel gives you one claude.ai connector per machine.

1. **Create the secret files**, readable only by you:

   ```bash
   mkdir -p ~/.config/waveapps-mcp-gateway && cd ~/.config/waveapps-mcp-gateway
   umask 077
   openssl rand -hex 32 > http-token
   openssl rand -hex 32 > jwt-signing-key
   ```

2. **Create a Google OAuth client.** In the Google Cloud console, open APIs & Services, then Credentials, and create an OAuth client ID of type **Web application**. Add `https://<your public URL>/auth/callback` as an authorized redirect URI, and save the client secret as `~/.config/waveapps-mcp-gateway/google-client-secret`. The consent screen only needs the `openid` and `email` scopes. Publish it to production: a client left in testing loses its tokens every 7 days.

3. **Run the server** with the HTTP transport and the token, from the repo folder:

   ```bash
   WAVE_MCP_TRANSPORT=http WAVE_MCP_HTTP_TOKEN_FILE="$HOME/.config/waveapps-mcp-gateway/http-token" node dist/server.js
   ```

   On a machine without an OS credential store, also set `WAVE_PASSWORD_FILE` and `WAVE_TOTP_SECRET_FILE` (see the table above). The server needs a first session before it starts: run `node dist/server.js refresh` once with the same variables. It asks for your Wave email the first time (or set `WAVE_EMAIL`), signs in headless and saves both.

4. **Run the gateway.** It needs [uv](https://docs.astral.sh/uv/):

   ```bash
   cd gateway
   uv sync --locked
   BASE_URL="https://<your public URL>" \
   ALLOWED_EMAILS="you@example.com" \
   GOOGLE_OAUTH_CLIENT_ID="<client id>" \
   GOOGLE_OAUTH_CLIENT_SECRET_FILE="$HOME/.config/waveapps-mcp-gateway/google-client-secret" \
   JWT_SIGNING_KEY_FILE="$HOME/.config/waveapps-mcp-gateway/jwt-signing-key" \
   WAVE_MCP_HTTP_TOKEN_FILE="$HOME/.config/waveapps-mcp-gateway/http-token" \
   uv run waveapps-mcp-gateway
   ```

5. **Add the connector.** In claude.ai, open Customize, then Connectors, and add a custom connector with the URL `https://<your public URL>/mcp`. claude.ai finds the gateway's sign-in by itself, so leave its OAuth options as they are, then sign in with a listed Google account.

A healthy gateway answers `/mcp` with 401 (it wants a sign-in) and `/.well-known/oauth-authorization-server` with 200.

To move the gateway to a new public URL, change `BASE_URL`, add the new `/auth/callback` address to the Google client and restart the gateway. Every sign-in is tied to the old URL and claude.ai can't edit a connector's URL, so remove the connector and add it again. Its tool permissions start over.

| Gateway variable | Default | What it does |
| --- | --- | --- |
| `BASE_URL` | required | The gateway's public URL. Google redirects to `BASE_URL/auth/callback`. |
| `ALLOWED_EMAILS` | required | Comma-separated Google accounts allowed in. They must be verified. |
| `GOOGLE_OAUTH_CLIENT_ID` | required | From step 2. |
| `GOOGLE_OAUTH_CLIENT_SECRET_FILE` | required | File holding the client secret. |
| `JWT_SIGNING_KEY_FILE` | required | File holding the key that signs the gateway's tokens and encrypts its saved sign-ins. Changing it signs every client out. |
| `WAVE_MCP_HTTP_TOKEN_FILE` | required | The same token file the server reads. |
| `WAVE_GATEWAY_UPSTREAM_URL` | `http://127.0.0.1:8765/mcp` | Where the server listens. |
| `WAVE_GATEWAY_HOST` / `WAVE_GATEWAY_PORT` | `127.0.0.1` / `8000` | Where the gateway listens. |
| `WAVE_GATEWAY_STATE_DIR` | `~/.local/state/waveapps-mcp-gateway` | Saved client registrations and sign-ins, encrypted. |

## Try it

Once wired up, try asking Claude:

- *"Show me my Wave businesses."*
- *"List my draft invoices."*
- *"Who's my most overdue customer?"*
- *"Draft an invoice for \[customer name\]: 6 hours of consulting at $200/hr, dated today."*
- *"Record a $500 cash payment against invoice #218."*

Claude will figure out which tools to call. If it doesn't have enough info (e.g. you didn't say which customer), it'll ask.

## When something goes wrong

| Symptom | Fix |
| --- | --- |
| Claude says "I don't have a tool for that" | Restart your Claude app: it only picks up MCP servers at startup. Confirm the path in your config points at a real file. |
| Tools error with "WaveAuthError" | Wave session expired. Run `npx waveapps-mcp login`, or set up `save-password` for automatic sign-in. |
| "Automatic Wave sign-in stopped: … CAPTCHA" | Wave wants a person. Run `npx waveapps-mcp login` and sign in in the window. Automatic sign-in works again next time. |
| "Playwright's Chromium isn't installed" | Run `npx playwright install chromium`. |
| Tools error with "CSRF token configured" | You skipped the CSRF cookie when pasting. Re-run `npx waveapps-mcp paste` and provide it this time. |
| Claude tries to use a tool but says it can't find your business | Either pass `businessId` explicitly in your message, or re-run `paste` and provide the business UUID. |
| Automatic sign-in fails | Run `npx waveapps-mcp refresh --headed` to watch where it stops. Common causes: password changed, 2FA enabled (run `save-password` again with the TOTP secret), or Wave is rate-limiting from your IP. |
| A tool says "Wave rejected ..." | Wave refused the change and the message says why (for example a sender address Wave hasn't verified, or an invoice that isn't approved yet). Fix the input and try again. |
| "Unauthorized: send the WAVE_MCP_HTTP_TOKEN as a bearer token" | You set `WAVE_MCP_HTTP_TOKEN`; the client must send it as `Authorization: Bearer <token>`. |
| Want to wipe everything | `npx waveapps-mcp logout` removes the credentials file and the credential-store entries. |

## Important caveats

- **This uses Wave's internal API, not a public/documented one.** Wave doesn't promise to keep its internal endpoints stable. If something breaks one day, it's probably because Wave changed something on their end. Open an issue and we'll patch it.
- **Treat your credentials file as a password.** Anyone with read access to `~/.config/waveapps-mcp/credentials.json` can act as you in Wave until the session expires. Don't commit it to git, don't paste it into shared chats, don't sync it to a public folder.
- **Be careful with destructive tools.** `wave_delete_invoice`, `wave_delete_customer`, `wave_send_invoice` etc. take real action against your live workspace. Claude usually confirms before destructive operations, but double-check what it's about to do. If you only want Claude to look, use [read-only mode](#read-only-mode).
- **Some areas are read-only.** Claude can list bills, receipts, recurring invoices and sales taxes but can't create or change them, and there are no vendor tools yet. Add a vendor, enter or pay a bill, upload a receipt or set up a recurring invoice on Wave's website.

## License

MIT. See [LICENSE](./LICENSE).

You can use, modify, and redistribute this freely. There's no warranty; if it breaks your invoicing workflow that's on you. (Read: keep eyes on what Claude is doing in your Wave account, especially for the first few days.)

## For developers / contributors

Brief pointers if you want to hack on this:

- Source layout, API map, and captured GraphQL operations live in `docs/` locally, gitignored on purpose so the reverse-engineering reference doesn't get committed to a public mirror.
- Run the test suite: `npm test` (or `npm run test:coverage` for an HTML coverage report in `coverage/`). It's fully mocked and never touches Wave.
- Test the gateway: `cd gateway && uv sync --locked && uv run pytest`. It runs against a stub server and never touches Wave or Google.
- Tool results go through the shapers in `src/tools/_shape.ts`, pure functions that keep the fields the model needs, cut nested accounts and sales taxes down to a few fields, and drop Wave's resource URLs and layout flags. Add a field there, with a test, rather than returning a raw payload.
- Check the tools still match Wave's undocumented API: `npm run test:live`. No session needed: every tool runs with a bogus token, so Wave rejects it at auth, but only after confirming the REST route exists and the GraphQL query, input fields and enum values still fit its schema.
- Add read-only checks against your own account with `npm run test:live:signed-in` (or set `WAVE_LIVE_SIGNED_IN=1`). Uses your stored session and never signs in for you; if it has expired, the run stops with one "sign in again" error.
- Exercise the write tools for real with `npm run test:live:writes` and `WAVE_LIVE_TEST_CUSTOMER_ID` set to a throwaway customer whose name contains "test". It creates, changes and deletes estimates and invoices on that customer only, emails only that customer's own address, and deletes everything it made, though deleted invoices and estimates still use up their numbers.
- Smoke-test against a live Wave account: `WAVE_AUTH_TOKEN=... npm run smoke`
- Sign-in lives in `src/auth/`: `playwright.ts` launches Chromium in a form Cloudflare accepts (full browser, not the headless shell, without `HeadlessChrome` in the user agent), `auth0-sign-in.ts` walks Wave's Auth0 pages, `secrets.ts` wraps the OS credential store. Tests swap in an in-memory store (`src/test-setup.ts`), so they never touch your real Keychain.

Pull requests welcome, especially for vendors, bills (create, edit, pay, delete) and receipt uploads, which are the main unwrapped surfaces. Recurring invoices and sales taxes stay read-only on purpose: Wave can end a recurring invoice or archive a tax but never delete either, so a create tool would leave permanent records behind on every live test run.
