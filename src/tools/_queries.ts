// GraphQL operations captured verbatim from next.waveapps.com on 2026-05-11.
// Wave's server may allow-list query texts; do NOT minify or rewrite these.

export const CUSTOMER_LIST_QUERY = `query CustomerListListCustomers($businessId: ID!, $page: Int!, $pageSize: Int!) {
  business(id: $businessId) {
    id
    customers(page: $page, pageSize: $pageSize, sort: [NAME_ASC]) {
      pageInfo {
        currentPage
        totalPages
        __typename
      }
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
  currency {
    code
    symbol
    name
    __typename
  }
  address {
    addressLine1
    addressLine2
    city
    province {
      name
      slug
      code
      __typename
    }
    country {
      name
      code
      __typename
    }
    postalCode
    __typename
  }
  createdAt
  modifiedAt
  shippingDetails {
    name
    instructions
    phone
    address {
      addressLine1
      addressLine2
      city
      province {
        name
        slug
        code
        __typename
      }
      country {
        name
        code
        __typename
      }
      postalCode
      __typename
    }
    __typename
  }
  outstandingAmount {
    minorUnitValue
    value
    currency {
      code
      symbol
      name
      __typename
    }
    __typename
  }
  overdueAmount {
    minorUnitValue
    value
    currency {
      code
      symbol
      name
      __typename
    }
    __typename
  }
  additionalContacts {
    id
    name
    email
    phone
    __typename
  }
  __typename
}

fragment SendPaymentReceiptModalCustomerFragment on Customer {
  id
  firstName
  lastName
  name
  email
  __typename
}

fragment CustomerFragment on Customer {
  ...CustomerDetailFragment
  ...SendPaymentReceiptModalCustomerFragment
  paymentMethodCards {
    id
    cardholderName
    lastFourDigits
    expiryMonth
    expiryYear
    cardType
    cardSource
    __typename
  }
  __typename
}`;

export const ESTIMATES_QUERY = `query GetEstimates($businessId: ID!, $page: Int!, $pageSize: Int!, $sort: EstimateSort, $customerId: ID, $activeStatus: EstimateListStatusFilter, $draftStatus: EstimateListStatusFilter, $allStatus: EstimateListStatusFilter, $estimateDateStart: Date, $estimateDateEnd: Date, $estimateNumber: String) {
  business(id: $businessId) {
    id
    name
    currency {
      code
      symbol
      __typename
    }
    address {
      country {
        code
        __typename
      }
      __typename
    }
    phone
    website
    invoiceEstimateSettings {
      generalSettings {
        logoUrl
        __typename
      }
      __typename
    }
    allEstimates: estimates(
      page: $page
      pageSize: $pageSize
      sort: $sort
      customerId: $customerId
      status: $allStatus
      estimateDateStart: $estimateDateStart
      estimateDateEnd: $estimateDateEnd
      estimateNumber: $estimateNumber
    ) {
      edges {
        node {
          ...EstimateNodeFragment
          __typename
        }
        __typename
      }
      pageInfo {
        currentPage
        totalCount
        totalPages
        __typename
      }
      __typename
    }
    draftEstimates: estimates(
      page: $page
      pageSize: $pageSize
      sort: $sort
      customerId: $customerId
      status: $draftStatus
      estimateDateStart: $estimateDateStart
      estimateDateEnd: $estimateDateEnd
      estimateNumber: $estimateNumber
    ) {
      edges {
        node {
          ...EstimateNodeFragment
          __typename
        }
        __typename
      }
      pageInfo {
        currentPage
        totalCount
        totalPages
        __typename
      }
      __typename
    }
    activeEstimates: estimates(
      page: $page
      pageSize: $pageSize
      sort: $sort
      customerId: $customerId
      status: $activeStatus
      estimateDateStart: $estimateDateStart
      estimateDateEnd: $estimateDateEnd
      estimateNumber: $estimateNumber
    ) {
      edges {
        node {
          ...EstimateNodeFragment
          __typename
        }
        __typename
      }
      pageInfo {
        currentPage
        totalCount
        totalPages
        __typename
      }
      __typename
    }
    __typename
  }
}

fragment EstimateNodeFragment on AREstimate {
  id
  status
  estimateDate
  estimateNumber
  dueDate
  currency {
    code
    symbol
    __typename
  }
  exchangeRate
  amountDue {
    value
    currency {
      code
      symbol
      __typename
    }
    __typename
  }
  total {
    minorUnitValue
    value
    currency {
      code
      symbol
      __typename
    }
    __typename
  }
  customer {
    id
    name
    firstName
    lastName
    email
    __typename
  }
  lastSentAt
  lastSentVia
  viewUrl
  amountPaid {
    minorUnitValue
    value
    currency {
      code
      symbol
      __typename
    }
    __typename
  }
  depositStatus
  depositValue
  depositUnit
  depositPaymentStatus
  __typename
}`;

export const BILLS_QUERY = `query ListBills($businessId: ID!, $vendorId: ID, $billDateStart: Date, $billDateEnd: Date, $page: Int!, $pageSize: Int!, $sort: BillSort) {
  business(id: $businessId) {
    id
    bills(
      vendorId: $vendorId
      billDateStart: $billDateStart
      billDateEnd: $billDateEnd
      page: $page
      pageSize: $pageSize
      sort: $sort
    ) {
      pageInfo {
        totalCount
        __typename
      }
      edges {
        node {
          id
          billerId
          dueDate
          billDate
          currency {
            name
            code
            symbol
            exponent
            __typename
          }
          amountDue
          amountPaid
          subtotal
          total
          billNumber
          vendorIsContractor
          linkedToPayroll
          eligibleForDirectDeposit
          payrollId
          depositStatus
          paymentStatus
          linkedToTaxForm
          vendorPayrollId
          checkPayrollId
          __typename
        }
        __typename
      }
      businessSupportsContractorPayments
      __typename
    }
    __typename
  }
}`;

export const TRANSACTIONS_QUERY = `query GetTransactions($businessId: ID!, $filters: TransactionFilter, $first: Int, $sort: [TransactionSort!]) {
  business(id: $businessId) {
    id
    roles
    transactions(filters: $filters, first: $first, sort: $sort) {
      edges {
        node {
          id
          amount
          attachment {
            id
            thumbnailUrl
            __typename
          }
          currency {
            code
            __typename
          }
          dateCreated
          description
          missingFields
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}`;

// Everything above was captured verbatim and stays that way. The operations below are the
// exception: written for this server (Wave runs any document that validates), re-checked by `npm run test:live`.

export const SALES_TAXES_QUERY = `query ListSalesTaxes($businessId: ID!, $page: Int!, $pageSize: Int!, $isArchived: Boolean) {
  business(id: $businessId) {
    id
    salesTaxes(page: $page, pageSize: $pageSize, isArchived: $isArchived) {
      pageInfo {
        currentPage
        totalPages
        totalCount
      }
      edges {
        node {
          id
          name
          abbreviation
          description
          rate
          isArchived
          isCompound
          isRecoverable
          taxNumber
          showTaxNumberOnInvoices
          rates {
            effective
            rate
          }
        }
      }
    }
  }
}`;

export const GET_ESTIMATE_QUERY = `query GetEstimate($businessId: ID!, $estimateId: ID!) {
  business(id: $businessId) {
    id
    estimate(id: $estimateId) {
      id
      estimateNumber
      status
      title
      subhead
      estimateDate
      dueDate
      poNumber
      memo
      footer
      currency {
        code
      }
      exchangeRate
      customer {
        id
        name
        email
      }
      items {
        id
        product {
          id
          name
        }
        description
        quantity
        unitPrice
        account {
          classicId
          name
        }
        subtotal {
          value
        }
        total {
          value
        }
        taxes {
          salesTax {
            id
            name
            abbreviation
            rate
          }
          amount {
            value
          }
        }
      }
      itemTitle
      unitTitle
      priceTitle
      amountTitle
      subtotal {
        value
      }
      discountTotal {
        value
      }
      taxTotal {
        value
      }
      total {
        value
      }
      amountDue {
        value
      }
      amountPaid {
        value
      }
      createdAt
      lastSentAt
      lastSentVia
      lastViewedAt
      viewUrl
      dontCarryOverNotesToInvoice
      disableCreditCardPayments
      disableAmexPayments
      depositStatus
      depositUnit
      depositValue
      depositPaymentStatus
    }
  }
}`;

/** The customer fragments captured with CUSTOMER_LIST_QUERY, reused verbatim by single-customer reads and writes. */
export const CUSTOMER_FRAGMENTS = CUSTOMER_LIST_QUERY.slice(CUSTOMER_LIST_QUERY.indexOf('fragment CustomerDetailFragment'));

export const GET_CUSTOMER_QUERY = `query GetCustomer($businessId: ID!, $customerId: ID!) {
  business(id: $businessId) {
    id
    customer(id: $customerId) {
      ...CustomerFragment
    }
  }
}

${CUSTOMER_FRAGMENTS}`;

const TRANSACTION_FIELDS = `id
      date
      description
      notes
      amount
      direction
      sequence
      verificationStatus
      missingFields
      currency {
        code
      }
      origin {
        type
      }
      anchorLineItem {
        order
        account {
          id
          classicId
          name
        }
        amount
        itemType
      }
      lineItems {
        order
        account {
          id
          classicId
          name
        }
        amount
        itemType
        description
        customer {
          id
          name
        }
        tags {
          id
          name
        }
      }`;

export const LIST_TRANSACTIONS_QUERY = `query ListTransactions($businessId: ID!, $first: Int, $after: String, $filters: TransactionFilter, $sort: [TransactionSort!]) {
  business(id: $businessId) {
    id
    transactions(first: $first, after: $after, filters: $filters, sort: $sort) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          ${TRANSACTION_FIELDS}
        }
      }
    }
  }
}`;

export const GET_TRANSACTION_QUERY = `query GetTransaction($businessId: ID!, $transactionId: ID!) {
  business(id: $businessId) {
    id
    transaction(id: $transactionId) {
      ${TRANSACTION_FIELDS}
    }
  }
}`;

/** Every active account with the integer id REST uses, so tools can take wave_list_accounts ids. */
export const ACCOUNT_IDS_QUERY = `query ListAccountIds($businessId: ID!) {
  business(id: $businessId) {
    id
    accounts(page: 1, pageSize: 500, isArchived: false) {
      edges {
        node {
          id
          classicId
          name
        }
      }
    }
  }
}`;

export const LIST_TAGS_QUERY = `query ListTags($businessId: ID!, $pagination: AccountingTagsPaginationInput!, $filters: AccountingTagsFiltersInput) {
  accountingTags(businessId: $businessId, pagination: $pagination, filters: $filters) {
    edges {
      node {
        id
        name
        description
        archived
        group {
          id
          name
        }
      }
    }
    pageInfo {
      currentPage
      totalPages
    }
  }
}`;

export { TRANSACTION_FIELDS };
