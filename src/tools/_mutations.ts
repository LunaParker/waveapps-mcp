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

// Everything above was captured verbatim and stays that way. The operations below are the
// exception: written for this server (Wave runs any document that validates), re-checked by `npm run test:live`.

const ESTIMATE_RESULT = `didSucceed
    inputErrors {
      message
      path
    }
    estimate {
      id
      estimateNumber
      status
    }`;

export const APPROVE_ESTIMATE_MUTATION = `mutation ApproveEstimate($input: EstimateApproveInput!) {
  estimateApprove(input: $input) {
    ${ESTIMATE_RESULT}
  }
}`;

export const MARK_ESTIMATE_SENT_MUTATION = `mutation MarkEstimateSent($input: EstimateMarkSentInput!) {
  estimateMarkSent(input: $input) {
    ${ESTIMATE_RESULT}
  }
}`;

export const ACCEPT_ESTIMATE_MUTATION = `mutation AcceptEstimate($input: EstimateMarkAcceptedInput!) {
  estimateMarkAccepted(input: $input) {
    ${ESTIMATE_RESULT}
  }
}`;

export const RESET_ESTIMATE_ACCEPTANCE_MUTATION = `mutation ResetEstimateAcceptance($input: EstimateResetAcceptanceInput!) {
  estimateResetAcceptance(input: $input) {
    ${ESTIMATE_RESULT}
  }
}`;

export const DUPLICATE_ESTIMATE_MUTATION = `mutation DuplicateEstimate($input: EstimateCloneInput!) {
  estimateClone(input: $input) {
    ${ESTIMATE_RESULT}
  }
}`;

export const CONVERT_ESTIMATE_MUTATION = `mutation ConvertEstimate($input: ConvertEstimateToInvoiceInput!) {
  convertEstimateToInvoice(input: $input) {
    didSucceed
    inputErrors {
      message
      path
    }
    invoiceId
  }
}`;

export const ESTIMATE_PDF_MUTATION = `mutation GenerateEstimatePdf($input: EstimateGeneratePdfInput!) {
  estimateGeneratePdf(input: $input) {
    didSucceed
    inputErrors {
      message
      path
    }
    pdfUrl
  }
}`;

export const SEND_ESTIMATE_MUTATION = `mutation SendEstimate($input: EstimateSendInput!) {
  estimateSend(input: $input) {
    didSucceed
    inputErrors {
      message
      path
      code
    }
  }
}`;
