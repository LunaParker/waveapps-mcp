# waveapps-mcp

[![Test](https://github.com/LunaParker/waveapps-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/LunaParker/waveapps-mcp/actions/workflows/test.yml)
[![Build](https://github.com/LunaParker/waveapps-mcp/actions/workflows/build.yml/badge.svg)](https://github.com/LunaParker/waveapps-mcp/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node 20+](https://img.shields.io/badge/node-%3E%3D20.18-brightgreen.svg)](https://nodejs.org)

## Purpose

This is an add-on that lets you ask **Claude** (or any other AI assistant that supports MCP) to do your **Wave Accounting** bookkeeping for you. Instead of clicking through the Wave website to draft an invoice, you tell Claude something like:

> "Draft an invoice for Acme Corp: 8 hours of design work at $150/hr."

…and Claude creates the invoice in Wave for you. Same for recording payments, adding customers, looking up old estimates, and so on.

It works by giving Claude a set of 23 structured tools that map onto real Wave operations. Claude picks the right tools and calls them with the right arguments based on your conversation.

> **What's "MCP"?** [Model Context Protocol](https://modelcontextprotocol.io) is a standard way for AI assistants to call external tools. Anthropic's Claude apps speak it natively; so do Cursor, Continue, and a growing list of others.

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

Everything happens in your real Wave account. Claude doesn't have its own sandbox. Be deliberate with mutating operations, especially deletes and "send invoice".

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

## Try it

Once wired up, try asking Claude:

- *"Show me my Wave businesses."*
- *"List my draft invoices."*
- *"Who's my most overdue customer?"*
- *"Draft an invoice for [customer name]: 6 hours of consulting at $200/hr, dated today."*
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
| Want to wipe everything | `npx waveapps-mcp logout` removes the credentials file and the credential-store entries. |

## Important caveats

- **This uses Wave's internal API, not a public/documented one.** Wave doesn't promise to keep its internal endpoints stable. If something breaks one day, it's probably because Wave changed something on their end. Open an issue and we'll patch it.
- **Treat your credentials file as a password.** Anyone with read access to `~/.config/waveapps-mcp/credentials.json` can act as you in Wave until the session expires. Don't commit it to git, don't paste it into shared chats, don't sync it to a public folder.
- **Be careful with destructive tools.** `wave_delete_invoice`, `wave_delete_customer`, `wave_send_invoice` etc. take real action against your live workspace. Claude usually confirms before destructive operations, but double-check what it's about to do.
- **Vendors aren't wrapped yet.** They live on Wave's older `accounting.waveapps.com` frontend. If you need to bill a new vendor on a Wave Bill, you'll have to add them through Wave's website first.

## License

MIT. See [LICENSE](./LICENSE).

You can use, modify, and redistribute this freely. There's no warranty; if it breaks your invoicing workflow that's on you. (Read: keep eyes on what Claude is doing in your Wave account, especially for the first few days.)

## For developers / contributors

Brief pointers if you want to hack on this:

- Source layout, API map, and captured GraphQL operations live in `docs/` locally, gitignored on purpose so the reverse-engineering reference doesn't get committed to a public mirror.
- Run the test suite: `npm test` (or `npm run test:coverage` for an HTML coverage report in `coverage/`)
- Smoke-test against a live Wave account: `WAVE_AUTH_TOKEN=... npm run smoke`
- Sign-in lives in `src/auth/`: `playwright.ts` launches Chromium in a form Cloudflare accepts (full browser, not the headless shell, without `HeadlessChrome` in the user agent), `auth0-sign-in.ts` walks Wave's Auth0 pages, `secrets.ts` wraps the OS credential store. Tests swap in an in-memory store (`src/test-setup.ts`), so they never touch your real Keychain.

Pull requests welcome, especially for Products & Services, Vendors, recurring invoices, and bill mutations, which are the main unwrapped surfaces.
