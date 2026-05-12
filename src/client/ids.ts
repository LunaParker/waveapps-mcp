// Wave's GraphQL uses two Relay-ID shapes:
//   1. Top-level entities (Business, User) — `base64({Typename}:{UUID})`
//      e.g. `Business:c2cb3afe-…` → QnVzaW5lc3M6YzJjYjNhZmUt…
//   2. Sub-resources of a business (Customer, Product, Estimate, …) — composite:
//      `base64(Business:{businessUuid};{Typename}:{internalIntegerId})`
//      e.g. `Business:c2cb3afe-…;Customer:102532808`

export function toGlobalId(typename: string, uuid: string): string {
  return Buffer.from(`${typename}:${uuid}`, 'utf8').toString('base64');
}

export function fromGlobalId(globalId: string): { typename: string; uuid: string } {
  const decoded = Buffer.from(globalId, 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  if (idx === -1) {
    throw new Error(`Not a Relay global ID: ${globalId}`);
  }
  return { typename: decoded.slice(0, idx), uuid: decoded.slice(idx + 1) };
}

/**
 * Compose a Wave composite Relay ID for a sub-resource of a business.
 * The `internalId` is the integer Wave assigns (e.g. customer 102532808).
 */
export function toCompositeGlobalId(
  businessUuid: string,
  typename: 'Customer' | 'Product' | 'Vendor' | 'Estimate' | 'Bill' | 'Item' | 'Account' | 'Invoice',
  internalId: number | string,
): string {
  return Buffer.from(`Business:${businessUuid};${typename}:${internalId}`, 'utf8').toString('base64');
}

export function fromCompositeGlobalId(globalId: string): {
  businessUuid: string;
  typename: string;
  internalId: string;
} {
  const decoded = Buffer.from(globalId, 'base64').toString('utf8');
  const semi = decoded.indexOf(';');
  if (semi === -1) throw new Error(`Not a Wave composite Relay ID: ${globalId}`);
  const businessPart = decoded.slice(0, semi); // "Business:UUID"
  const childPart = decoded.slice(semi + 1); // "Typename:internalId"
  const businessColon = businessPart.indexOf(':');
  const childColon = childPart.indexOf(':');
  if (businessColon === -1 || childColon === -1) {
    throw new Error(`Malformed composite Relay ID: ${globalId}`);
  }
  return {
    businessUuid: businessPart.slice(businessColon + 1),
    typename: childPart.slice(0, childColon),
    internalId: childPart.slice(childColon + 1),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function assertUuid(value: string, field = 'id'): void {
  if (!isUuid(value)) throw new Error(`Expected ${field} to be a UUID, got: ${value}`);
}
