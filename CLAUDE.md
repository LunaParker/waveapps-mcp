# CLAUDE.md

Notes for agents working on waveapps-mcp. `README.md` is the user guide; this file covers how the code fits together and what has caught us out before.

## What this is

A TypeScript MCP server for Wave (waveapps.com) bookkeeping: 58 tools across businesses, invoices, customers, estimates, products, bills, receipts and sales taxes. Wave gives regular users no API key, so the server uses the session a browser gets on sign-in: the `waveapps` cookie, sent as a Bearer token to Wave's own REST and internal GraphQL APIs.

The package is not on npm. People run it from a clone, with their MCP client pointed at the absolute path of `dist/server.js`.

## Build, test, run

```bash
npm install                        # also installs the pre-commit secret scan
npm run build                      # tsc, src/ to dist/
npm test                           # vitest, no network
npm run typecheck
npm run test:coverage
npm run test:live                  # live contract checks, no session needed
npm run test:live:signed-in        # plus read-only checks with the stored session
npm run test:live:writes           # plus real writes on a test customer (WAVE_LIVE_TEST_CUSTOMER_ID)
npx playwright install chromium    # once, before login or refresh
cd gateway && uv sync --locked && uv run pytest   # the FastMCP gateway (Python 3.12+, uv)
```

- Node 20.18 or later. CI (`.github/workflows/test.yml`) runs `npm ci --ignore-scripts`, typecheck and tests on Node 20 and 22. `build.yml` compiles and uploads `dist` after Test passes on `main`.
- `npm run dev` runs `tsx watch src/server.ts`.
- The live suites (`src/live/`, `vitest.live.config.ts`) never run in `npm test` or CI. `test:live` drives every tool with a fake token, so nothing can be read or changed; it still catches drift because REST answers 401 for routes that exist (404 otherwise) and GraphQL validates documents, input fields and enum values before auth. `test:live:signed-in` builds its client without a refresher, so it can't trigger a sign-in. Run `test:live` after touching any query, mutation, request body or enum. `test:live:writes` (`src/live/writes.live.test.ts`) runs the write tools for real on the customer `WAVE_LIVE_TEST_CUSTOMER_ID` names, refuses one whose name lacks "test", only emails that customer's address, and deletes what it creates in `afterEach`; register each record's cleanup as soon as it exists. Run it only when the user has agreed to writes on their account.
- `dist/` is gitignored, so a client pointed at `dist/server.js` runs whatever was built last. After pulling or switching branches, rebuild, then restart the MCP client.
- One entry point serves both roles. `node dist/server.js <subcommand>` runs the CLI: `login`, `refresh [--headed]`, `paste`, `save-password`, `whoami`, `logout`, `help`. With no subcommand it starts the MCP server: stdio by default, or Streamable HTTP with `WAVE_MCP_TRANSPORT=http` on `WAVE_MCP_BIND`:`WAVE_MCP_PORT` (default `127.0.0.1:8765`). `WAVE_MCP_HTTP_TOKEN` is required when `WAVE_MCP_BIND` is not a loopback address, and once it is set every request must carry it as a bearer token. Loopback listeners also reject `Host` headers whose hostname is not a loopback address (`hostnameOf()` strips the port, so tunnels on other ports work; this is the DNS-rebinding guard), and every listener rejects bodies over 1 MiB with a 413 after draining up to 8 MiB.
- `npx waveapps-mcp ...` only resolves inside the repo. User-facing hints come from `cliCommand()` in `src/util/cli-command.ts`, which gives `node <path>/dist/server.js <subcommand>` when the server was started that way. Use it for any new hint; don't hardcode a command.
- To check the server starts without touching Wave, send `initialize` and `tools/list` over stdin. Neither calls Wave, and the process exits when stdin closes:

  ```bash
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node dist/server.js
  ```

## Layout

- `src/server.ts`: dispatches CLI subcommands, otherwise builds an `McpServer` and a `WaveClient` and starts a transport.
- `src/client/`: `WaveClient` with `rest` (`api.waveapps.com`) and `gql` (`gql.waveapps.com/graphql/internal`), auth loading, Relay ID helpers (`ids.ts`) and error classes.
- `src/tools/`: one file per area (`businesses`, `invoices`, `payments`, `accounts`, `customers`, `estimates`, `products`, `bills`, `receipts`, `sales-taxes`, `estimate-lifecycle`, `reports`, `customer-statements`, `invoice-actions`, `transactions`, `tags`, `recurring-invoices`), all registered in `tools/index.ts`. GraphQL documents live in `_queries.ts` and `_mutations.ts` (the older ones captured from Wave's web app, newer ones written here; Wave runs any document that validates); `_invoice-body.ts` builds the REST invoice body and maps a stored invoice back into update arguments; `_report-export.ts` renders a shaped report as CSV or PDF and `_pdf.ts` wraps files as tool results; `_shape.ts` holds the output shapers that trim Wave's records before a tool returns them (pure functions, `null` for a missing scalar, `[]` for a missing list; invoice settings pass through as Wave sends them, and `wave_list_invoices` and `wave_get_invoice` take `raw: true` to skip the shapers); `_test_utils.ts` holds the mocked client the tool tests use.
- `src/auth/`: the credentials file, the OS credential store, Playwright launch, the Auth0 sign-in, the profile lock and TOTP.
- `src/cli/`: the subcommands, plus `sanitise.ts` (trim pasted values and strip one pair of surrounding quotes) and `secret-line.ts` (hidden input collected as bytes and decoded as UTF-8 once, so non-ASCII passwords survive). `src/transports/`: stdio and HTTP. `src/util/`: `dates.ts` (`todayIso` for the local calendar day, never `new Date().toISOString().slice(0, 10)`, which gives the UTC day; `addDays` for day arithmetic on YYYY-MM-DD strings), `log.ts`, `env.ts`, `cli-command.ts`.
- `gateway/`: the FastMCP OAuth gateway (Python, uv, `fastmcp==4.1.1`). `config.py` reads the environment into `GatewayConfig` (secrets only from `_FILE` paths, all problems reported together); `gate.py` holds `GoogleProvider`, the encrypted on-disk OAuth store and the `EmailAllowlist` middleware; `app.py` builds the proxy. Tests use FastMCP's in-process `asgi_server` and `asgi_client`, plus a real-port stub upstream from `run_server_async`; build a fresh stub per test, because one FastMCP instance can't serve twice in a process. `[tool.uv] exclude-newer` keeps the lock to releases at least two weeks old; move it together with the fastmcp pin. CI runs it on Python 3.12 and 3.14, and the root `pyrightconfig.json` points editors at `gateway/.venv`.
- `scripts/`: the pre-commit secret scan, its installer and `smoke.ts`.
- `docs/` and `NOTES.md` are local-only and gitignored on purpose: they hold captured internal GraphQL queries, real IDs and working notes. Read them when present. Never commit them, and never copy captured queries or IDs from them into tracked files.

## Wave API conventions

- Every request sends `Authorization: Bearer <waveapps cookie>`. Mutations also need `x-csrftoken: <identity-csrftoken cookie>`. Without a CSRF token, reads still work and mutating calls throw before any request goes out.
- REST takes the plain business UUID in the path. GraphQL wants Relay global IDs, in two shapes: `base64("Business:<uuid>")` for top-level entities and `base64("Business:<uuid>;Customer:<int>")` for things inside a business. Use the helpers in `src/client/ids.ts`.
- Businesses, invoices and products go through REST. Customers, estimates, bills and receipts go through GraphQL.
- REST pages with `page` and `page_size`. Wave sends the total in `X-Total-Count` but no `X-Total-Pages`, so `getPaged` derives `totalPages`.
- Invoice line-item taxes must be `[{ sales_tax: { id: <int> } }]`. A bare integer gets a 400 (fixed in #1).
- `customerPatch` keeps scalar fields you leave out but clears `address` and `shippingDetails` when they're missing, and replaces the whole address when one is sent, so `wave_update_customer` reads the customer first and always sends both. Additional contacts survive when left out; a contact sent as `{ id }` alone is deleted, one without an id is added. Province codes are ISO 3166-2 (`CA-ON`); a bare `ON` gets "This is not a valid choice", so `provinceCode()` in `src/tools/customers.ts` prefixes the country.
- Customer statements are two steps: `outstandingInvoicesStatementCreate` / `accountActivityStatementCreate` return an `id` and a public `shareLink`, and the matching `…Send` mutation emails that `id` with every field required (`to`, `subject`, `message`, `fromAddress`, `ccMyself`).
- Transactions are double entry: an `anchorLineItem` on the bank, cash or card account plus `lineItems` on categories, each with `itemType` DEBIT or CREDIT (money in debits the anchor). Accounts are Relay ids (`Account:<n>;Business:<uuid>`, a different number from REST); `classicId` holds the REST id, except on system accounts (exchange gains and the like) where it is null, so `src/tools/transactions.ts` falls back to matching the REST account's name. Patches are partial but quote the current `sequence` (it goes up on every write) and identify lines by their `order`; Wave answers "line items must be ordered 0 to n" without it.
- Tags live outside `business`: `accountingTags(businessId: <Business Relay id>, pagination: { pageNumber, resultsPerPage })`, with only `currentPage` and `totalPages` on `pageInfo`.
- Wave masks some validation errors as a bare "Invalid query." (`GRAPHQL_VALIDATION_FAILED`), with no field named. Compare against the document Wave's own app sends, field by field, rather than guessing.
- Recurring invoices are REST under `/businesses/{id}/recurring-invoices/`, paged with `page_index` (from 1), not `page`. `sort` must be one of `state`, `previous_invoice_date`, `next_invoice_date` or `date_added` (optionally `-`); `state` is not validated, so a typo just returns nothing. They can't be deleted: `DELETE` answers 405 and the web app only offers End, so the tools are read-only and there are no create, update or end tools on purpose: the writes suite couldn't clean up after them. A test draft created on 2026-11-01 still sits on the test customer for that reason.
- Sales taxes are read-only for the same reason: Wave can only archive a tax, never delete it, so `wave_list_sales_taxes` is the only tax tool and create, update and archive are left out on purpose rather than leave permanent records behind on every live run.
- Reports are `POST /businesses/{id}/reports/<name>/` with `{ filters, version, client_request_date }`, so they need the CSRF token even though they only read. Profit and loss, balance sheet, cash flow and trial balance want `version: 2` (trial balance answers 500 to version 1); the rest want 1. Periods go in `date_periods: [{ start_date, end_date }]` (version 2 period reports) or `start_date`/`end_date`, point-in-time reports take `report_date`, and `report_type` is `"1"` for accrual, `"2"` for cash. The `REPORTS` table in `src/tools/reports.ts` holds each one's shape.
- Wave has no report export endpoint: its Export menu re-runs the same report POST and builds the CSV or PDF in the browser. `wave_export_report` does the same from the shaped report. Wave's CSV is the title, business name, `Date Range:`/`As of:` and `Report Type:` lines, then `""` before each section's header row and rows (padded to the section's width), CRLF, with indentation and notes dropped; the PDF is drawn with pdf-lib's Helvetica, so anything outside WinAnsi becomes `?`.
- Invoice actions that REST lacks (PDF, duplicate, reminder, payment receipt) go through GraphQL with the Relay id `base64("Business:<uuid>;Invoice:<int>")`; a payment's Relay id is `InvoicePayment:<int>` with the same integer REST returns, so tools take the REST ids and compose. `src/tools/_pdf.ts` serves both invoice and estimate PDFs.
- Estimate actions (approve, mark sent, accept, reset acceptance, duplicate, convert, PDF) each take only `estimateId`; conversion answers with the new invoice's Relay id, whose integer is the REST invoice id. PDFs come back as short-lived signed S3 links: download them with a plain `fetch`, never with the Wave headers.
- Estimate line-item taxes must be `[{ salesTaxId: <SalesTax Relay ID> }]`. The Relay ID is `base64("Business:<uuid>;SalesTax:<int>")`, and the integer is the same `sales_tax.id` invoices use.
- Invoice settings (`GET /businesses/{id}/invoices/settings/`) carry the workspace defaults: `default_payment_terms` is a number of days, `default_item_title` / `default_quantity_title` / `default_price_title` / `default_amount_title` are the column headings, `default_title` the number label, `default_subheading`, `default_footer` and `standard_memo` the text. `wave_create_invoice` reads them, and the business's `primary_currency`, for anything the caller leaves out.
- A business's `invoice_sending_emails[]` lists the sender addresses Wave accepts; only `verified: true` ones work as `fromAddress` on `invoiceSend`.
- GraphQL mutations answer HTTP 200 with `didSucceed: false` and `inputErrors[]` when Wave refuses; `requireDidSucceed()` in `src/client/errors.ts` turns that into a `WaveMutationError` whose message lists them.
- GraphQL introspection is off. To check a field, input or enum value, send it with no session: a validation or `VARIABLE_VALUE` error names the problem (often with a "Did you mean" hint), and `UNAUTHENTICATED` means it's valid.
- An expired token gets a 401 or 403 from REST, but GraphQL answers HTTP 200 with `errors[].extensions.code === 'UNAUTHENTICATED'`. `isAuthFailure()` in `src/client/graphql.ts` handles both.
- A `wave_auth_token` cookie with the literal value `invalidated` is a red herring.

## Sign-in and sessions

This is the fragile part, and Wave changes it without notice.

- Cloudflare bot protection covers only the sign-in hosts (`my.waveapps.com`, `auth.waveapps.com`). Scripted requests there, curl included, get a 403 HTML page titled "Wave Maintenance". It carries no `cf-mitigated` header, so check the title, and don't mistake it for an expired session: Wave's API answers those with JSON.
- The API hosts (`api.waveapps.com`, `gql.waveapps.com`) aren't gated. With a token, plain `curl` or Node `fetch` with the Bearer header works for REST and GraphQL alike (rechecked with curl on 2026-11-01). Playwright is only for getting the token: signing in is the one step that needs a real browser.
- `next.waveapps.com` answers curl too, but its sign-in page hands off to the gated `auth.waveapps.com`.
- What gets through Cloudflare: Playwright's full Chromium in new headless mode (`channel: 'chromium'`), with `HeadlessChrome/` swapped for `Chrome/` in the user agent, plus the flags in `STEALTH_ARGS` (`src/auth/playwright.ts`). Playwright's default headless shell is blocked. Headed windows get through.
- Start every sign-in at `https://next.waveapps.com/auth/auth0`. `my.waveapps.com/login` picks the Auth0 flow or an older Django form at random.
- The flow is Auth0's email page, Auth0's password page, then Wave's `/auth/verify` page with six code boxes and a checkbox to skip the code on this device for 30 days. `classifyPage()` in `src/auth/auth0-sign-in.ts` is a pure function over a page snapshot. When Wave changes a page, extend it and add a test.
- Never try to solve a visible CAPTCHA. Automatic sign-in throws `SignInChallengeError`, and the user signs in by hand with `login`.
- Session lifetime, measured 2026-10-31: 8 hours idle, 18 hours at most. `GET /oauth2/token/touch/` slides only the idle window, and `GET /oauth2/token/expiry/` reports both. Auth0's own session cookie idles out after about an hour, so nothing renews silently past 18 hours: a fresh sign-in needs the password and a TOTP code.
- Automatic re-login: on an auth failure, the client calls the refresher once (`buildDefaultRefresher` in `src/client/index.ts`). Holding the profile lock, it first reuses any token another process wrote to disk since it last looked. Otherwise it signs in headless with the stored email, password and TOTP secret, saves the new token and retries the request. A manual `login` therefore needs no client restart.
- `withProfileLock()` (`src/auth/profile-lock.ts`) is a mkdir lock at `<configDir>/sign-in.lock`. Callers wait up to 3 minutes, and a lock older than 10 minutes is treated as stale and broken. Anything that opens the persistent Chromium profile must hold it.

## Local state and configuration

- The config dir is `~/.config/waveapps-mcp/`, overridable with `WAVE_MCP_CONFIG_DIR`. It holds `credentials.json` (token, CSRF token, business ID and email, mode `0600`), `chromium-profile/` and `sign-in.lock`.
- The password and TOTP secret live in the OS credential store through `@napi-rs/keyring`, under service `waveapps-mcp` with accounts `password` and `totp-secret`. Older versions kept them in `credentials.json`; `migrateLegacySecrets()` moves them over on first run.
- `WAVE_PASSWORD_FILE` and `WAVE_TOTP_SECRET_FILE` switch `secretStore()` to `fileSecretStore()`, a read-only store for hosts with no keychain. It reads the files on every `get`, its `set` and `delete` throw, `save-password` then records only the email, `logout` leaves the files alone, and `migrateLegacySecrets()` skips it. `WAVE_MCP_HTTP_TOKEN_FILE` is the file form of `WAVE_MCP_HTTP_TOKEN`; setting both is an error.
- Environment variables: `WAVE_AUTH_TOKEN`, `WAVE_CSRF_TOKEN` and `WAVE_BUSINESS_ID` override the stored values. `WAVE_MCP_BROWSER_PATH` points at another Chromium. `WAVE_MCP_LOG_LEVEL` sets log verbosity. `WAVE_MCP_TRANSPORT` picks stdio or HTTP; `WAVE_MCP_BIND`, `WAVE_MCP_PORT` and `WAVE_MCP_HTTP_TOKEN` configure HTTP.
- Nothing loads `.env`, and no example env file ships: the README's Configuration table documents the variables, which only take effect when the shell or the MCP client config sets them.

## Rules for agents

- Don't trigger a live sign-in yourself. On an expired token, any Wave tool call or `npm run smoke` signs in with the user's stored password and 2FA secret, and so does `refresh`. To see whether the session is live, use a read that can't sign in: `whoami` for local state, or `GET https://api.waveapps.com/oauth2/token/expiry/` with the Bearer token (401 means expired). Then ask the user to run `login` or `refresh`.
- Never print token or secret values. `whoami` masks them; new output should too.
- In stdio mode, stdout is the JSON-RPC channel. Server code logs through `src/util/log.ts` (stderr) and never calls `console.log`. CLI subcommands may print normally.
- Tests must never touch the real credential store or config dir. `src/test-setup.ts` installs an in-memory secret store and a temp `WAVE_MCP_CONFIG_DIR` before every test. Pass `memorySecretStore()` or a `deps` object rather than mocking modules.
- Fake secrets in tests and docs start with `EXAMPLE_`, `FAKE_`, `TEST_` or `PLACEHOLDER_`; anything else that looks like a token makes the pre-commit scan reject the commit. Run it by hand with `npm run check-secrets`. The hook lives in the main checkout's `.git/hooks`, and worktrees share it, so run `npm install` in the main checkout at least once.
- Pin new dependencies to releases at least two weeks old.
- FastMCP proxies forward the caller's `Authorization` header (the gateway's own token) to the upstream unless the transport sets one. `upstream_transport()` in `gateway/src/waveapps_gateway/app.py` sets `Authorization: Bearer <token>`, which wins in FastMCP 4.1. `test_the_upstream_sees_the_gateway_token_not_the_callers` guards it; when upgrading FastMCP, run the gateway suite first.

## Code conventions

- ESM with `NodeNext`: relative imports end in `.js`, and type-only imports use `import type` (`verbatimModuleSyntax`). `strict` and `noUncheckedIndexedAccess` are on.
- Tools are registered as `server.registerTool('wave_<verb>_<noun>', { title, description, inputSchema, annotations }, handler)`, with zod input schemas (zod 4: `z.uuid()` and `z.email()`, not the deprecated `z.string().uuid()` forms; no `.passthrough()`) and `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint` set honestly. Handlers return `jsonResult(...)` of a small object, with any Wave record in it passed through a `_shape.ts` shaper, and throw on failure; the SDK turns a throw into an error result, and the live contract tests rely on handlers throwing `WaveAuthError`, so no try/catch in handlers. GraphQL mutation payloads go through `requireDidSucceed()`.
- Tool descriptions are read by the model, so they say what the tool does, where its ids come from (naming the tool and output field) and what the defaults are, and leave out REST paths and operation names.
- Tests sit next to the code as `*.test.ts` and are excluded from `tsc`. New tests use `toThrow`, not the deprecated `toThrowError`.
- `writeFileSync`'s `mode` applies only when it creates the file. After rewriting an existing secrets file, `chmodSync` it back to `0600`.
- The HTTP transport keeps one transport and one `McpServer` per `mcp-session-id`, because the SDK refuses to reuse a stateless transport across requests (fixed in #2).
- README prose has no em-dashes (cleaned up in #3). Keep new README text, and this file, the same way.
- Commit subjects are imperative; the body explains why.
