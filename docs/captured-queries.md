# Captured Wave GraphQL operations

Live captures from `next.waveapps.com` during the 2026-05-11 investigation. These are the operation names + signatures the in-app React/Apollo client uses. Use them verbatim from the MCP — Wave's server matches operations by `operationName` *and* `query` text, so don't rewrite the query bodies unless you want to find out the hard way that Wave validates against an internal allowlist.

Operations were captured by monkey-patching `window.fetch`, then SPA-navigating between sections via `history.pushState` + `popstate` (so the interceptor survived the route change).

## Operation index

| Operation | Where seen | Used by |
|---|---|---|
| `GetNavigationData` | every page | sidebar nav |
| `GetPaymentsData` | every page | nav badge |
| `GetIsEligibleForAdyen` | every page | payments eligibility |
| `GetBusinessInfo` | bills | business header data |
| `GetUser` | customers | logged-in user info |
| `GetBusinessPaymentConnection` | customers, estimates | Stripe/Wave Pay connection status |
| `GetOnboardingData` | customers | onboarding flags |
| `GetCallouts` | bills | feature-flag banners |
| `GetAuthenticationFactors` | most | 2FA status |
| `CustomerListListCustomers` | customers | full customer table |
| `CustomerDropdown` | estimates | trimmed customer list for select inputs |
| `GetEstimates` | estimates | estimate list (with status buckets) |
| `ListBills` | bills | bill list |
| `ListVendorsForBills` | bills | vendor dropdown on bill list |
| `GetTransactions` | receipts | receipts (modelled as transactions with a filter) |
| `GetContractorTaxFormGeneratedYears` | bills | tax form years |
| `GetHasAnyReconciledPeriods` | estimates | reconciliation guardrail |
| `GetEmailTemplate` | estimates | email defaults for sending |

## Full query bodies

### `CustomerListListCustomers`

```graphql
query CustomerListListCustomers($businessId: ID!, $page: Int!, $pageSize: Int!) {
  business(id: $businessId) {
    id
    customers(page: $page, pageSize: $pageSize, sort: [NAME_ASC]) {
      pageInfo { currentPage totalPages __typename }
      edges {
        node {
          ...CustomerFragment
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}

fragment CustomerDetailFragment on Customer {
  id
  internalId
  displayId
  name
  firstName
  lastName
  email
  fax
  mobile
  phone
  tollFree
  website
  internalNotes
  currency { code symbol name __typename }
  address {
    addressLine1 addressLine2 city
    province { name slug code __typename }
    country { name code __typename }
    postalCode
    __typename
  }
  createdAt
  modifiedAt
  shippingDetails {
    name instructions phone
    address {
      addressLine1 addressLine2 city
      province { name slug code __typename }
      country { name code __typename }
      postalCode
      __typename
    }
    __typename
  }
  outstandingAmount { minorUnitValue value currency { code symbol name __typename } __typename }
  overdueAmount     { minorUnitValue value currency { code symbol name __typename } __typename }
  additionalContacts { id name email phone __typename }
  __typename
}

fragment SendPaymentReceiptModalCustomerFragment on Customer {
  id firstName lastName name email __typename
}

fragment CustomerFragment on Customer {
  ...CustomerDetailFragment
  ...SendPaymentReceiptModalCustomerFragment
  paymentMethodCards {
    id cardholderName lastFourDigits expiryMonth expiryYear cardType cardSource __typename
  }
  __typename
}
```

Variables shape: `{ businessId: <Relay-ID>, page: 1, pageSize: 100 }`. Sort defaults to `NAME_ASC`.

### `CustomerDropdown` (trimmed)

```graphql
query CustomerDropdown($businessId: ID!, $page: Int! = 1) {
  business(id: $businessId) {
    id
    customers(sort: MODIFIED_AT_DESC, page: $page, pageSize: 500) {
      edges { node { id name __typename } __typename }
      pageInfo { currentPage totalPages __typename }
      __typename
    }
    __typename
  }
}
```

### `GetEstimates`

Variables (observed): `{ businessId, page: 1, pageSize: 25, activeStatus: "ACTIVE", draftStatus: "DRAFT", sort: "ESTIMATE_DATE_DESC" }`. Also accepts: `customerId`, `estimateDateStart`, `estimateDateEnd`, `estimateNumber`, `allStatus`.

```graphql
query GetEstimates(
  $businessId: ID!, $page: Int!, $pageSize: Int!, $sort: EstimateSort,
  $customerId: ID,
  $activeStatus: EstimateListStatusFilter,
  $draftStatus: EstimateListStatusFilter,
  $allStatus: EstimateListStatusFilter,
  $estimateDateStart: Date, $estimateDateEnd: Date, $estimateNumber: String
) {
  business(id: $businessId) {
    id name phone website
    currency { code symbol __typename }
    address { country { code __typename } __typename }
    invoiceEstimateSettings { generalSettings { logoUrl __typename } __typename }
    allEstimates: estimates(page: $page, pageSize: $pageSize, sort: $sort, customerId: $customerId, status: $allStatus, estimateDateStart: $estimateDateStart, estimateDateEnd: $estimateDateEnd, estimateNumber: $estimateNumber) {
      edges { node { ...EstimateNodeFragment __typename } __typename }
      pageInfo { currentPage totalCount totalPages __typename }
      __typename
    }
    draftEstimates: estimates(page: $page, pageSize: $pageSize, sort: $sort, customerId: $customerId, status: $draftStatus, estimateDateStart: $estimateDateStart, estimateDateEnd: $estimateDateEnd, estimateNumber: $estimateNumber) {
      edges { node { ...EstimateNodeFragment __typename } __typename }
      pageInfo { currentPage totalCount totalPages __typename }
      __typename
    }
    activeEstimates: estimates(page: $page, pageSize: $pageSize, sort: $sort, customerId: $customerId, status: $activeStatus, estimateDateStart: $estimateDateStart, estimateDateEnd: $estimateDateEnd, estimateNumber: $estimateNumber) {
      edges { node { ...EstimateNodeFragment __typename } __typename }
      pageInfo { currentPage totalCount totalPages __typename }
      __typename
    }
    __typename
  }
}

fragment EstimateNodeFragment on AREstimate {
  id status estimateDate estimateNumber dueDate exchangeRate
  currency { code symbol __typename }
  amountDue { value currency { code symbol __typename } __typename }
  total     { minorUnitValue value currency { code symbol __typename } __typename }
  customer  { id name firstName lastName email __typename }
  lastSentAt lastSentVia viewUrl
  amountPaid { minorUnitValue value currency { code symbol __typename } __typename }
  depositStatus depositValue depositUnit depositPaymentStatus
  __typename
}
```

> **Tool-implementation note:** the in-app query asks for three status buckets at once via aliases. Our MCP doesn't need that — we can use a simpler single-status version, but only after confirming Wave's server doesn't reject it (some servers allow-list the exact query text). For v1, send the verbatim three-bucket query and let the model pick which bucket it needs from the response.

### `ListBills` (signature only)

```graphql
query ListBills($businessId: ID!, $vendorId: ID, $billDateStart: Date, $billDateEnd: Date, $page: Int!, $pageSize: Int!, $sort: BillSort) { ... }
```

Sort enum probable values: `BILL_DATE_DESC`, `BILL_DATE_ASC`. Status filter not yet seen — Luna has 0 bills, so the empty-state UI hides them. Re-capture during implementation against a populated workspace.

### `GetTransactions` (signature only — receipts use this)

```graphql
query GetTransactions($businessId: ID!, $filters: TransactionFilter, $first: Int, $sort: [TransactionSort!]) { ... }
```

Pagination is Relay-style (`$first: Int`), not page-based. `TransactionFilter` is an input object — needs an `isReceipt: true` (or similar) to scope to receipts. Capture against real receipts to confirm.

### Unknowns

- Products & Services — lives on legacy `accounting.waveapps.com`, separate auth scope likely. Skipped for v1.
- Invoice mutations (create/update/send) — not yet captured. Will surface once we trigger the "Create an invoice" flow.
- `wave_get_invoice` detail query — invoice list comes from REST, but the detail view may have additional REST or GraphQL calls.
