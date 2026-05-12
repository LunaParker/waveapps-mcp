// GraphQL mutations captured verbatim from next.waveapps.com on 2026-05-11.
// Wave's server may allow-list query texts; do NOT minify or rewrite.

export const CREATE_CUSTOMER_MUTATION = `mutation CreateCustomer($input: CustomerCreateInput!) {
  customerCreate(input: $input) {
    didSucceed
    inputErrors {
      message
      path
      __typename
    }
    customer {
      ...CustomerFragment
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

export const DELETE_CUSTOMER_MUTATION = `mutation DeleteCustomer($input: CustomerDeleteInput!) {
  customerDelete(input: $input) {
    didSucceed
    inputErrors {
      message
      __typename
    }
    __typename
  }
}`;

export const CREATE_ESTIMATE_MUTATION = `mutation CreateEstimate($input: EstimateCreateInput!) {
  estimateCreate(input: $input) {
    didSucceed
    inputErrors {
      message
      __typename
    }
    estimate {
      id
      estimateNumber
      __typename
    }
    __typename
  }
}`;

export const PATCH_ESTIMATE_MUTATION = `mutation PatchEstimate($input: EstimatePatchInput!) {
  estimatePatch(input: $input) {
    didSucceed
    inputErrors {
      message
      __typename
    }
    __typename
  }
}`;

export const DELETE_ESTIMATE_MUTATION = `mutation DeleteEstimate($input: EstimateDeleteInput!) {
  estimateDelete(input: $input) {
    didSucceed
    inputErrors {
      message
      __typename
    }
    __typename
  }
}`;

export const INVOICE_SEND_MUTATION = `mutation InvoiceSend($input: InvoiceSendInput!) {
  invoiceSend(input: $input) {
    didSucceed
    inputErrors {
      path
      message
      code
      __typename
    }
    __typename
  }
}`;
