# Wave API map

What we learned by sniffing `next.waveapps.com` with Brave DevTools on 2026-05-11. This is the *internal* API the web app calls — Wave's public GraphQL API is documented separately at developer.waveapps.com but we're not relying on it.

> **Stability warning:** none of this is contractual. Wave can rename/remove these endpoints without notice. The MCP client must degrade gracefully on schema drift.

## Hosts

| Host | What lives there |
|---|---|
| `api.waveapps.com` | REST API. Pagination via query params; data CRUD for invoices, accounts, dashboard reports, etc. |
| `gql.waveapps.com/graphql/internal` | Internal GraphQL endpoint. Used for cross-cutting reads (navigation, payments eligibility) and likely all customer/product reads. Introspection disabled server-side. |
| `next.waveapps.com` | New frontend. Hosts: dashboard, invoices, estimates, customers, payments, recurring-invoices, checkouts, customer-statements, bills, receipts, reports. |
| `accounting.waveapps.com` | Legacy frontend. Hosts: products & services, vendors. (These redirect from next.) |

## Authentication

The Bearer token Wave attaches to every API request **is the value of the `waveapps` cookie verbatim**. Confirmed empirically — string comparison between the captured Authorization header and `document.cookie['waveapps']` matched exactly (30 characters).

| Item | Storage |
|---|---|
| OAuth access token | Cookie `waveapps` — 30 chars, NOT HTTP-only (so JS can read it). |
| CSRF token (web app) | Cookie `identity-csrftoken` (32 chars). Mirrored to header `x-csrftoken` on state-changing requests. |
| Token expiry check | `GET /oauth2/token/expiry/` returns JSON with timing. |
| `wave_auth_token` cookie | Literal value `"invalidated"` — red herring, ignore. |

### Headers attached to every request

```
Authorization: Bearer <waveapps cookie value>
x-csrftoken: <identity-csrftoken cookie value>     # mutations only
Accept: application/json
Origin: https://next.waveapps.com                  # CORS-restricted
```

Custom `X-Wave-*` headers are *allowed* by CORS (`Access-Control-Allow-Headers: authorization, content-type, x-csrftoken, X-Wave-CB-Context, X-Wave-Client, X-Wave-Origin-Service, X-Wave-Entitlements-Context`) but probably optional for most endpoints. `X-Client-Id: WAVE_UNIVERSAL_APP` shows up on responses but doesn't seem to be required on requests.

### Implication for the MCP client

We don't need full OAuth — we just need the `waveapps` cookie value from a logged-in browser session. Two delivery modes worth supporting:

1. **Env var / config file**: user pastes the cookie value; we store it locally and refresh manually.
2. **Browser-assist tool**: an MCP tool that drives Brave (or any Chromium) to log in, scrapes the cookie via `document.cookie`, and persists it for the client.

Token rotation is a real concern — we'll need a refresh mechanism eventually, but for v1 a manual-paste flow is acceptable.

## ID conventions

| Surface | ID shape |
|---|---|
| REST URLs | Plain UUID — e.g. `/businesses/c2cb3afe-5a24-41b2-add7-d1c6982d75a9/invoices/` |
| GraphQL variables | **Relay-style global ID** — base64 of `Type:UUID`. Example: `QnVzaW5lc3M6YzJjYjNhZmUtNWEyNC00MWIyLWFkZDctZDFjNjk4MmQ3NWE5` decodes to `Business:c2cb3afe-5a24-41b2-add7-d1c6982d75a9`. |

Client helper needed: `toGlobalId(typename, uuid)` and `fromGlobalId(globalId)`.

## REST conventions

Base: `https://api.waveapps.com/businesses/{businessId}/...`

**Pagination & filtering** (confirmed on `/invoices/`):

```
?page=1&page_size=25
?sort=-invoice_date         # leading `-` for desc
?status=draft|unpaid|overdue
?embed_customer=true        # eager-load relations
?include_unpaid_invoice_count_and_rank=true
?ignore_cache=true          # bypass server cache on Pulse endpoints
```

**Pagination meta** (response headers):

```
X-Total-Count: 2
X-Total-Pages: 1
X-Wave-API-Version: 1
```

**Response headers worth surfacing in the client:**

```
WAVE-BUSINESS-PROFILE-STATE
X-Client-Id: WAVE_UNIVERSAL_APP
Access-Control-Expose-Headers: WAVE-BUSINESS-PROFILE-STATE, X-Total-Count, X-Total-Pages, X-Wave-API-Version, X-Client-Id
```

## REST endpoints observed

> Method is GET unless stated. Mutation verbs (POST/PUT/PATCH/DELETE) need to be confirmed during the API-client implementation phase.

### Business / account-wide

- `/businesses/?include_personal=true` — list businesses for current user
- `/businesses/{id}/` — single business detail
- `/businesses/{id}/financial_settings/`
- `/businesses/{id}/maintenance/`
- `/businesses/{id}/onboarding/hotspots/`
- `/businesses/{id}/payments/supported-services/`
- `/businesses/{id}/payroll/employer/`
- `/businesses/{id}/accounts/?active_only=true` — chart of accounts
- `/businesses/{id}/accountsv2/anchor/` — newer accounts variant
- `/central-banking/businesses/{id}/accounts` — bank accounts (note: different URL prefix)
- `/oauth2/token/expiry/`
- `/onboarding/announcement/{slug}/{businessId}/`

### Invoices

- `/businesses/{id}/invoices/` with all the pagination/filter params above
- `/businesses/{id}/invoices/settings/`
- `/businesses/{id}/pulse/invoices-outstanding-total/?due_date_end=YYYY-MM-DD[&due_date_start=YYYY-MM-DD]`
- `/businesses/{id}/pulse/average-days-to-payment/`
- `/businesses/{id}/wpp/next-transfer/` — next payout

### Dashboard reports (also REST)

- `/businesses/{id}/dashboard/net-income/?report_date=YYYY-MM-DD[&report_type=1&period_type=year|month|quarter]`
- `/businesses/{id}/dashboard/aged-receivables/?report_date=YYYY-MM-DD`
- `/businesses/{id}/dashboard/aged-payables/?report_date=YYYY-MM-DD`
- `/businesses/{id}/dashboard/cash-flow/?report_date=YYYY-MM-DD&years_to_fetch=2&report_type=1`
- `/businesses/{id}/dashboard/profit_and_loss/?period_start=YYYY-MM-DD&period_end=YYYY-MM-DD`
- `/businesses/{id}/dashboard/expense-breakdown/?period_type=current_fiscal_year|current_month|last_12_months|last_24_months|last_30_days&report_date=YYYY-MM-DD`

## GraphQL

POST to `https://gql.waveapps.com/graphql/internal` with standard envelope:

```json
{ "operationName": "GetNavigationData", "query": "query GetNavigationData(...) { ... }", "variables": { "activeBusinessGlobalId": "<base64>" } }
```

### Operations captured

Full query bodies for the important ones live in `captured-queries.md`. Signatures only here:

| operationName | Variables | Section |
|---|---|---|
| `GetNavigationData` | `activeBusinessGlobalId` | every page (chrome) |
| `GetPaymentsData` | `activeBusinessGlobalId` | every page (chrome) |
| `GetIsEligibleForAdyen` | `businessId` | every page |
| `GetUser` | (none) | customers, others |
| `GetBusinessInfo` | `businessId` | bills |
| `GetBusinessPaymentConnection` | `identityBusinessId` | customers, estimates |
| `CustomerListListCustomers` | `businessId, page, pageSize` (sort hardcoded `NAME_ASC`) | customers |
| `CustomerDropdown` | `businessId, page` (pageSize=500 hardcoded) | estimates (slim list) |
| `GetEstimates` | `businessId, page, pageSize, sort, customerId?, activeStatus?, draftStatus?, allStatus?, estimateDateStart?, estimateDateEnd?, estimateNumber?` | estimates |
| `ListBills` | `businessId, vendorId?, billDateStart?, billDateEnd?, page, pageSize, sort` | bills |
| `ListVendorsForBills` | `id (= business), page?, pageSize?` | bills |
| `GetTransactions` | `businessId, filters?, first?, sort?` (Relay cursor pagination) | receipts |
| `GetCallouts` | `businessId, view` | bills |
| `GetAuthenticationFactors` | (none) | most |
| `GetOnboardingData` | (none) | customers |
| `GetEmailTemplate` | `businessId, messageType` (`ESTIMATE`, etc.) | estimates send-flow |
| `GetHasAnyReconciledPeriods` | `businessId` | estimates |
| `GetContractorTaxFormGeneratedYears` | `employeeId, businessId` | bills |

Capture technique that worked: install fetch interceptor on a long-lived page, then SPA-navigate via `history.pushState` + dispatched `popstate` event. Wave's React Router responds, fires queries through the interceptor. Hard navigations via the MCP's `navigate_page` wipe the interceptor and miss the queries.

### Apollo cache shape

`window.__APOLLO_CLIENT__.cache.extract()` returns the normalized store. After dashboard load the cache holds only `User`, `Business`, `Query`. Customer/Invoice/etc. lists are likely fetched with `fetchPolicy: 'no-cache'` (so we can't reverse-engineer them from cache state).

## Per-section URL map

These are the *frontend* URLs — useful for browser-assist flows and for working out which surface (REST vs GraphQL) backs each entity.

| Entity | URL | Likely backend |
|---|---|---|
| Dashboard | `next.waveapps.com/{id}/dashboard/` | REST (multiple `/dashboard/*` endpoints) |
| Invoices | `next.waveapps.com/{id}/invoices` | REST (`/businesses/{id}/invoices/`) |
| Estimates | `next.waveapps.com/{id}/estimates` | TBD |
| Payments | `next.waveapps.com/{id}/payments/transactions` | TBD |
| Recurring Invoices | `next.waveapps.com/{id}/recurring-invoices` | TBD |
| Checkouts | `next.waveapps.com/{id}/checkouts` | TBD |
| Customer Statements | `next.waveapps.com/{id}/customer-statements` | TBD |
| Customers | `next.waveapps.com/{id}/customers` | GraphQL (no REST customer calls observed) |
| Bills | `next.waveapps.com/{id}/bills` | TBD |
| Receipts | `next.waveapps.com/{id}/receipts` | TBD |
| Products & Services | `accounting.waveapps.com/products/{id}/selling/redirect` | Legacy UI |
| Vendors | `accounting.waveapps.com/settings/{id}/vendors/redirect` | Legacy UI |
| Reports | `next.waveapps.com/{id}/reports` | REST |

## Known unknowns

- Mutation patterns (create/update/delete) for any entity — none captured yet.
- CSRF behaviour on mutations — header presumed but not verified.
- Whether GraphQL endpoint accepts persisted queries / APQ hashes (currently sends full query text, so probably not).
- Rate limits.
- Vendor/Products endpoints (`accounting.waveapps.com` legacy app — different cookie scope?).
- Bills / Receipts / Estimates / Recurring-Invoices URL conventions (REST vs GraphQL).
- Exact response JSON shapes (capture during implementation).
