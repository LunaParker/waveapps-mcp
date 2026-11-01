import { describe, expect, it } from 'vitest';
import {
  shapeAccount,
  shapeBill,
  shapeBusiness,
  shapeCustomer,
  shapeEstimate,
  shapeInvoice,
  shapeInvoiceSummary,
  shapeProduct,
  shapeReceipt,
  shapeSalesTaxSummary,
  looksLikeInvoice,
} from './_shape.js';

const CURRENCY = { url: 'https://api.waveapps.com/currencies/CAD/', code: 'CAD', symbol: '$', name: 'Canadian dollar', plural: null };

const ACCOUNT = {
  id: 301, url: 'https://api.waveapps.com/businesses/x/accounts/301/', name: 'Consulting Income', active: true,
  account_template_id: 7, account_type: 'income', system_account: null, is_payment: false, can_delete: true,
  currency: CURRENCY, is_currency_editable: false, is_name_editable: true, is_payment_editable: false,
  date_created: '2020-01-01T00:00:00Z', date_modified: '2020-01-01T00:00:00Z',
};

const SALES_TAX = {
  id: 401, url: 'https://api.waveapps.com/businesses/x/sales_taxes/401/', name: 'HST', abbreviation: 'HST',
  description: '', tax_rates: 'https://api.waveapps.com/businesses/x/sales_taxes/401/rates/', tax_number: 'TEST_TAX_NUMBER',
  show_tax_num_on_invoices: true, archived: false, is_compound: false, is_recoverable: true,
  accounts_receivable: ACCOUNT, accounts_payable: ACCOUNT, date_modified: '2020-01-01T00:00:00Z',
  date_created: '2020-01-01T00:00:00Z', current_rate: 0.13,
};

const CUSTOMER = {
  id: 201, url: 'https://api.waveapps.com/businesses/x/customers/201/', account_number: '', active: true,
  name: 'Example Co', first_name: 'Ex', last_name: 'Ample', email: 'billing@example.com', fax_number: '',
  mobile_number: '', phone_number: '5550100', toll_free_number: '', website: 'https://example.com',
  internal_notes: 'net 15', currency: null, address1: '1 Example St', address2: '', city: 'Exampleville',
  province: { name: 'Ontario', slug: 'ontario' }, country: { name: 'Canada', country_code: 'CA', currency: CURRENCY, url: 'u' },
  postal_code: 'A1A 1A1', date_created: '2020-01-01T00:00:00Z', date_modified: '2020-01-01T00:00:00Z', shipping_details: null,
};

const INVOICE = {
  id: '9000000000000000001', url: 'https://api.waveapps.com/businesses/x/invoices/9000000000000000001/',
  address: { address1: null, address2: null, city: null, province_name: null, country_name: null, postal_code: null },
  subhead: 'Sub', footer: 'Thanks', po_so_number: 'PO-1', memo: 'Memo', invoice_date: '2026-01-10',
  invoice_number_label: 'Invoice', invoice_number: '42', invoice_currency: CURRENCY, exchange_rate: 1,
  invoice_total: 113, invoice_discount_total: 0, invoice_tax_total: 13, invoice_amount_paid: 113, invoice_amount_due: 0,
  due_date: '2026-01-25', last_payment_date: '2026-01-20T12:00:00Z', unpaid_invoice_rank: 0, unpaid_invoice_count: 0,
  has_multiple_unpaid_invoices: null, anonymous_id: 'anon', status: 'paid', disable_credit_card_payments: true,
  disable_bank_payments: true, disable_amex_payments: true, readonly_url: 'https://example.com/ro',
  pdf_url: 'https://example.com/pdf', sharing_urls: { gmail: 'g', outlook: 'o', public: 'https://example.com/pub', yahoo_mail: 'y' },
  items: [
    {
      id: 501, url: 'i', product: {
        id: 601, url: 'p', name: 'Design', price: 100, description: 'd', is_sold: true, is_bought: false,
        income_account: ACCOUNT, expense_account: null, active: true, date_created: 'x', date_modified: 'x', default_sales_taxes: [],
      },
      price: 100, quantity: 1, description: 'Design work',
      taxes: [{ id: 701, url: 't', amount: 13, override_amount: null, override_rate: null, sales_tax: SALES_TAX, date_created: 'x', date_modified: 'x' }],
      date_created: 'x', date_modified: 'x', account_id: 301,
    },
  ],
  discounts: [],
  attachments: [],
  payments: [
    {
      id: '9000000000000000002', url: 'pay', payment_date: '2026-01-20', memo: 'e-transfer', exchange_rate: 1, amount: 113,
      payment_account: ACCOUNT, payment_method: 'bank_transfer', payment_details: {}, date_created: 'x', date_modified: 'x',
      readonly_url: 'r', api_origin: null, origin: 'manual', next_acct_transaction: null,
    },
  ],
  last_sent: '2026-01-10T13:00:00Z', last_sent_via: 'email', last_viewed: '2026-01-11T09:00:00Z',
  date_created: 'x', date_modified: 'x', source_type: 'invoice', source_invoice_number: null, source_url: null,
  item_title: 'Services', description_title: 'Description', quantity_title: 'Hours', price_title: 'Rate', amount_title: 'Amount',
  require_terms_of_service_agreement: false, hide_item: false, hide_description: false, hide_quantity: false,
  hide_price: false, hide_amount: false, tag_ids: [], customer: CUSTOMER,
};

describe('shapeInvoiceSummary', () => {
  it('keeps the money, dates, status and a customer reference, drops the rest', () => {
    expect(shapeInvoiceSummary(INVOICE)).toEqual({
      id: '9000000000000000001',
      invoice_number: '42',
      status: 'paid',
      invoice_date: '2026-01-10',
      due_date: '2026-01-25',
      currency: 'CAD',
      invoice_total: 113,
      invoice_tax_total: 13,
      invoice_discount_total: 0,
      invoice_amount_paid: 113,
      invoice_amount_due: 0,
      last_payment_date: '2026-01-20T12:00:00Z',
      last_sent: '2026-01-10T13:00:00Z',
      last_sent_via: 'email',
      last_viewed: '2026-01-11T09:00:00Z',
      memo: 'Memo',
      po_so_number: 'PO-1',
      pdf_url: 'https://example.com/pdf',
      public_url: 'https://example.com/pub',
      customer: { id: 201, name: 'Example Co', email: 'billing@example.com' },
    });
  });

  it('tolerates a missing or non-object payload', () => {
    expect(shapeInvoiceSummary(null).id).toBeNull();
    expect(shapeInvoiceSummary('nope').customer).toBeNull();
    expect(shapeInvoiceSummary({ id: 7 }).id).toBe('7');
  });
});

describe('shapeInvoice', () => {
  it('adds the presentation fields, items, payments, discounts and attachments', () => {
    const out = shapeInvoice(INVOICE);
    expect(out.exchange_rate).toBe(1);
    expect(out.subhead).toBe('Sub');
    expect(out.footer).toBe('Thanks');
    expect(out.invoice_number_label).toBe('Invoice');
    expect(out.item_title).toBe('Services');
    expect(out.quantity_title).toBe('Hours');
    expect(out.price_title).toBe('Rate');
    expect(out.amount_title).toBe('Amount');
    expect(out.discounts).toEqual([]);
    expect(out.attachments).toEqual([]);
    expect(out.items).toEqual([
      {
        id: 501,
        description: 'Design work',
        quantity: 1,
        price: 100,
        account_id: 301,
        product: { id: 601, name: 'Design', income_account: { id: 301, name: 'Consulting Income' } },
        taxes: [{ id: 701, amount: 13, sales_tax: { id: 401, name: 'HST', abbreviation: 'HST', rate: 0.13 } }],
      },
    ]);
    expect(out.payments).toEqual([
      {
        id: '9000000000000000002',
        payment_date: '2026-01-20',
        amount: 113,
        payment_method: 'bank_transfer',
        memo: 'e-transfer',
        exchange_rate: 1,
        payment_account: { id: 301, name: 'Consulting Income' },
      },
    ]);
  });

  it('is much smaller than the raw payload', () => {
    expect(JSON.stringify(shapeInvoice(INVOICE)).length).toBeLessThan(JSON.stringify(INVOICE).length / 3);
  });

  it('gives empty lists and nulls for an empty object', () => {
    const out = shapeInvoice({});
    expect(out.items).toEqual([]);
    expect(out.payments).toEqual([]);
    expect(out.customer).toBeNull();
    expect(out.currency).toBeNull();
  });
});

describe('looksLikeInvoice', () => {
  it('recognises an object with an invoice_number', () => {
    expect(looksLikeInvoice(INVOICE)).toBe(true);
    expect(looksLikeInvoice({ ok: true })).toBe(false);
    expect(looksLikeInvoice(null)).toBe(false);
  });
});

describe('shapeBusiness', () => {
  it('keeps identity, currency, country and the verified sender addresses', () => {
    const raw = {
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', url: 'u', company_name: 'Example Co', primary_currency: CURRENCY,
      is_owner: true, is_admin: true, is_default_business: true, is_personal: false, has_completed_onboarding: null,
      address1: '1 Example St', city: 'Exampleville', province: { name: 'Ontario', slug: 'ontario', code: 'ON' },
      country: { name: 'Canada', country_code: 'CA', currency: CURRENCY, url: 'u' }, postal_code: 'A1A 1A1',
      timezone_id: 'America/Toronto', apps: [{ app_name: 'invoicing', href: 'h' }], scopes: 'all', attribs: {},
      invoice_sending_emails: [{ email: 'billing@example.com', default: true, is_collaborator: false, verified: true }],
    };
    expect(shapeBusiness(raw)).toEqual({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      company_name: 'Example Co',
      currency: 'CAD',
      country: 'CA',
      timezone_id: 'America/Toronto',
      is_personal: false,
      is_default_business: true,
      is_owner: true,
      is_admin: true,
      invoice_sending_emails: [{ email: 'billing@example.com', default: true, verified: true }],
    });
  });
});

describe('shapeProduct', () => {
  it('keeps pricing, flags and account references', () => {
    const raw = {
      id: 601, url: 'p', name: 'Design', price: 100, description: 'd', is_sold: true, is_bought: false,
      income_account: { id: 301, url: 'a' }, expense_account: null, active: true, date_created: 'x', date_modified: 'x',
      default_sales_taxes: [SALES_TAX],
    };
    expect(shapeProduct(raw)).toEqual({
      id: 601, name: 'Design', description: 'd', price: 100, active: true, is_sold: true, is_bought: false,
      income_account: { id: 301, name: null }, expense_account: null,
      default_sales_taxes: [{ id: 401, name: 'HST', abbreviation: 'HST', rate: 0.13 }],
    });
  });

  it('accepts bare integer default taxes', () => {
    expect(shapeProduct({ id: 1, default_sales_taxes: [401] }).default_sales_taxes).toEqual([
      { id: 401, name: null, abbreviation: null, rate: null },
    ]);
  });
});

describe('shapeAccount', () => {
  it('keeps what you need to pick a payment or income account', () => {
    expect(shapeAccount(ACCOUNT)).toEqual({
      id: 301, name: 'Consulting Income', account_type: 'income', is_payment: false, active: true, currency: 'CAD',
    });
  });
});

describe('shapeCustomer (GraphQL)', () => {
  it('flattens currency, province and country to codes and drops saved cards and __typename', () => {
    const raw = {
      id: 'QnVzaW5lc3M6eDtDdXN0b21lcjoyMDE=', internalId: '201', displayId: 'C-1', name: 'Example Co', firstName: 'Ex',
      lastName: 'Ample', email: 'billing@example.com', fax: '', mobile: '', phone: '5550100', tollFree: '', website: 'https://example.com',
      internalNotes: 'net 15', currency: { code: 'CAD', symbol: '$', name: 'Canadian dollar', __typename: 'Currency' },
      address: {
        addressLine1: '1 Example St', addressLine2: '', city: 'Exampleville',
        province: { name: 'Ontario', slug: 'ontario', code: 'ON', __typename: 'Province' },
        country: { name: 'Canada', code: 'CA', __typename: 'Country' }, postalCode: 'A1A 1A1', __typename: 'Address',
      },
      createdAt: '2020-01-01T00:00:00Z', modifiedAt: '2020-01-02T00:00:00Z', shippingDetails: null,
      outstandingAmount: { minorUnitValue: 11300, value: '113.00', currency: { code: 'CAD' }, __typename: 'Money' },
      overdueAmount: { minorUnitValue: 0, value: '0.00', currency: { code: 'CAD' }, __typename: 'Money' },
      additionalContacts: [{ id: 'c1', name: 'AP', email: 'ap@example.com', phone: '', __typename: 'Contact' }],
      paymentMethodCards: [{ id: 'card', cardholderName: 'Ex Ample', lastFourDigits: '4242', expiryMonth: 1, expiryYear: 2030 }],
      __typename: 'Customer',
    };
    const out = shapeCustomer(raw);
    expect(out).toEqual({
      id: 'QnVzaW5lc3M6eDtDdXN0b21lcjoyMDE=', internalId: '201', displayId: 'C-1', name: 'Example Co', firstName: 'Ex',
      lastName: 'Ample', email: 'billing@example.com', phone: '5550100', mobile: '', fax: '', tollFree: '', website: 'https://example.com',
      internalNotes: 'net 15', currency: 'CAD',
      address: { addressLine1: '1 Example St', addressLine2: '', city: 'Exampleville', province: 'ON', country: 'CA', postalCode: 'A1A 1A1' },
      shippingDetails: null,
      outstandingAmount: '113.00', overdueAmount: '0.00',
      additionalContacts: [{ id: 'c1', name: 'AP', email: 'ap@example.com', phone: '' }],
      createdAt: '2020-01-01T00:00:00Z', modifiedAt: '2020-01-02T00:00:00Z',
    });
    expect(JSON.stringify(out)).not.toContain('4242');
    expect(JSON.stringify(out)).not.toContain('__typename');
  });

  it('flattens shipping details when present', () => {
    const out = shapeCustomer({
      id: 'c', shippingDetails: {
        name: 'Receiving', instructions: 'Side door', phone: '5550199',
        address: { addressLine1: '2 Dock St', addressLine2: '', city: 'Exampleville', province: { code: 'ON' }, country: { code: 'CA' }, postalCode: 'B2B 2B2', __typename: 'Address' },
        __typename: 'ShippingDetails',
      },
    });
    expect(out.shippingDetails).toEqual({
      name: 'Receiving', instructions: 'Side door', phone: '5550199',
      address: { addressLine1: '2 Dock St', addressLine2: '', city: 'Exampleville', province: 'ON', country: 'CA', postalCode: 'B2B 2B2' },
    });
  });
});

describe('shapeEstimate (GraphQL)', () => {
  it('keeps the estimate fields and decodes the integer id from the Relay id', () => {
    const relayId = Buffer.from('Business:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee;Estimate:808', 'utf8').toString('base64');
    const raw = {
      id: relayId, status: 'DRAFT', estimateDate: '2026-02-01', estimateNumber: '12', dueDate: '2026-03-03',
      currency: { code: 'CAD', symbol: '$', __typename: 'Currency' }, exchangeRate: '1',
      amountDue: { value: '226.00', currency: { code: 'CAD' } }, total: { minorUnitValue: 22600, value: '226.00', currency: { code: 'CAD' } },
      customer: { id: 'cust', name: 'Example Co', firstName: 'Ex', lastName: 'Ample', email: 'billing@example.com', __typename: 'Customer' },
      lastSentAt: null, lastSentVia: null, viewUrl: 'https://example.com/est', amountPaid: { value: '0.00' },
      depositStatus: 'DISABLED', depositValue: null, depositUnit: null, depositPaymentStatus: null, __typename: 'AREstimate',
    };
    expect(shapeEstimate(raw)).toEqual({
      id: relayId, internalId: '808', estimateNumber: '12', status: 'DRAFT', estimateDate: '2026-02-01', dueDate: '2026-03-03',
      currency: 'CAD', exchangeRate: '1', total: '226.00', amountDue: '226.00', amountPaid: '0.00',
      customer: { id: 'cust', name: 'Example Co', email: 'billing@example.com' },
      lastSentAt: null, lastSentVia: null, viewUrl: 'https://example.com/est',
      depositStatus: 'DISABLED', depositValue: null, depositUnit: null, depositPaymentStatus: null,
    });
  });

  it('leaves internalId null when the id is not a composite Relay id', () => {
    expect(shapeEstimate({ id: 'bm9wZQ==' }).internalId).toBeNull();
    expect(shapeEstimate({}).internalId).toBeNull();
  });
});

describe('shapeBill (GraphQL)', () => {
  it('keeps the money and vendor, drops payroll fields', () => {
    const raw = {
      id: 'bill1', billerId: 'vendor1', dueDate: '2026-02-20', billDate: '2026-02-01',
      currency: { name: 'Canadian dollar', code: 'CAD', symbol: '$', exponent: 2, __typename: 'Currency' },
      amountDue: '50.00', amountPaid: '0.00', subtotal: '44.25', total: '50.00', billNumber: 'B-9', vendorIsContractor: false,
      linkedToPayroll: false, eligibleForDirectDeposit: false, payrollId: null, depositStatus: null, paymentStatus: 'UNPAID',
      linkedToTaxForm: false, vendorPayrollId: null, checkPayrollId: null, __typename: 'Bill',
    };
    expect(shapeBill(raw)).toEqual({
      id: 'bill1', billNumber: 'B-9', billDate: '2026-02-01', dueDate: '2026-02-20', currency: 'CAD',
      subtotal: '44.25', total: '50.00', amountDue: '50.00', amountPaid: '0.00', paymentStatus: 'UNPAID',
      vendorId: 'vendor1', vendorIsContractor: false,
    });
  });
});

describe('shapeReceipt (GraphQL)', () => {
  it('keeps the transaction basics and the attachment thumbnail', () => {
    const raw = {
      id: 'tx1', amount: '12.34', attachment: { id: 'att1', thumbnailUrl: 'https://example.com/t.png', __typename: 'Attachment' },
      currency: { code: 'CAD', __typename: 'Currency' }, dateCreated: '2026-02-01T00:00:00Z', description: 'Coffee',
      missingFields: ['category'], __typename: 'Transaction',
    };
    expect(shapeReceipt(raw)).toEqual({
      id: 'tx1', amount: '12.34', currency: 'CAD', dateCreated: '2026-02-01T00:00:00Z', description: 'Coffee',
      missingFields: ['category'], attachment: { id: 'att1', thumbnailUrl: 'https://example.com/t.png' },
    });
    expect(shapeReceipt({ id: 'tx2', attachment: null }).attachment).toBeNull();
  });
});

describe('shapeSalesTaxSummary (GraphQL)', () => {
  it('decodes the integer id and turns decimal-string rates into numbers', () => {
    const relayId = Buffer.from('Business:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee;SalesTax:401', 'utf8').toString('base64');
    const shaped = shapeSalesTaxSummary({
      id: relayId, name: 'GST', abbreviation: 'GST', description: null, rate: '0.05', isArchived: true,
      rates: [{ effective: '2020-01-01', rate: '0.05', __typename: 'SalesTaxRate' }, { effective: null, rate: 'n/a' }], __typename: 'SalesTax',
    });
    expect(shaped).toEqual({
      id: 401, relayId, name: 'GST', abbreviation: 'GST', description: null, rate: 0.05,
      rates: [{ effective: '2020-01-01', rate: 0.05 }, { effective: null, rate: null }],
      isArchived: true, isCompound: null, isRecoverable: null, taxNumber: null, showTaxNumberOnInvoices: null,
    });
  });

  it('degrades to nulls on a malformed record', () => {
    expect(shapeSalesTaxSummary({ id: 'not-base64-relay', rates: 'x' })).toMatchObject({ id: null, rates: [] });
    expect(shapeSalesTaxSummary(null).id).toBeNull();
  });
});
