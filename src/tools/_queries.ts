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
