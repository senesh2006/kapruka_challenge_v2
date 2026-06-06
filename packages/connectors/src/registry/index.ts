import type {
  ConnectorBinding,
  ConnectorKind,
  ScopedCredential,
  Tenant,
} from "@sevana/shared";
import type { CatalogueConnector } from "../catalogue/index.js";
import type { CheckoutConnector } from "../checkout/index.js";
import type { CrmConnector } from "../crm/index.js";
import type { DeliveryConnector } from "../delivery/index.js";
import type { RetailerConnector } from "../retailer.js";

/**
 * Opaque credential payload resolved from a `credentialRef`. Concrete shape
 * is adapter-specific; the registry treats it as a black box and only the
 * factory that asked for it knows what's inside.
 */
export interface CredentialPayload {
  readonly apiKey?: string;
  readonly bearer?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly [extra: string]: unknown;
}

/**
 * Resolves a `credentialRef` (stored on the Tenant) into the actual secret
 * material at call time. Production implementations read from a vault /
 * secrets manager; tests pass in a Map-backed resolver.
 */
export interface CredentialResolver {
  resolve(ref: string): Promise<CredentialPayload>;
}

export interface ConnectorFactoryContext {
  tenant: Tenant;
  binding: ConnectorBinding;
  credential: CredentialPayload;
}

interface FactoryByKind {
  catalogue: (ctx: ConnectorFactoryContext) => CatalogueConnector;
  delivery: (ctx: ConnectorFactoryContext) => DeliveryConnector;
  checkout: (ctx: ConnectorFactoryContext) => CheckoutConnector;
  crm: (ctx: ConnectorFactoryContext) => CrmConnector;
}

/**
 * A factory builds one capability connector. Adapters register a factory per
 * `(kind, adapter)` pair; the registry picks the right one for each tenant
 * binding at resolve time.
 */
export type ConnectorFactory =
  | { kind: "catalogue"; adapter: string; build: FactoryByKind["catalogue"] }
  | { kind: "delivery"; adapter: string; build: FactoryByKind["delivery"] }
  | { kind: "checkout"; adapter: string; build: FactoryByKind["checkout"] }
  | { kind: "crm"; adapter: string; build: FactoryByKind["crm"] };

export class UnknownConnectorAdapterError extends Error {
  constructor(kind: ConnectorKind, adapter: string) {
    super(`No connector factory registered for kind="${kind}" adapter="${adapter}"`);
    this.name = "UnknownConnectorAdapterError";
  }
}

export class MissingConnectorBindingError extends Error {
  constructor(kind: ConnectorKind, tenantId: string) {
    super(`Tenant "${tenantId}" has no binding for required connector kind="${kind}"`);
    this.name = "MissingConnectorBindingError";
  }
}

export class MissingCredentialError extends Error {
  constructor(ref: string) {
    super(`Credential ref "${ref}" could not be resolved`);
    this.name = "MissingCredentialError";
  }
}

function factoryKey(kind: ConnectorKind, adapter: string) {
  return `${kind}::${adapter}`;
}

/**
 * Per-tenant connector registry. Adapters register their factories once at
 * startup; `resolve(tenant)` returns a `RetailerConnector` aggregating the
 * four capability connectors picked from the tenant's `connectors` config.
 */
export class ConnectorRegistry {
  private readonly factories = new Map<string, ConnectorFactory>();

  register(factory: ConnectorFactory): this {
    this.factories.set(factoryKey(factory.kind, factory.adapter), factory);
    return this;
  }

  has(kind: ConnectorKind, adapter: string): boolean {
    return this.factories.has(factoryKey(kind, adapter));
  }

  async resolve(
    tenant: Tenant,
    opts: { credentialResolver: CredentialResolver },
  ): Promise<RetailerConnector> {
    const findBinding = (kind: ConnectorKind): ConnectorBinding | undefined =>
      tenant.connectors.find((c) => c.kind === kind);

    const buildRequired = async <K extends "catalogue" | "delivery" | "checkout">(
      kind: K,
    ): Promise<ReturnType<FactoryByKind[K]>> => {
      const binding = findBinding(kind);
      if (!binding) throw new MissingConnectorBindingError(kind, tenant.id);
      const credential = await this.resolveCredential(tenant, binding, opts.credentialResolver);
      const factory = this.factories.get(factoryKey(kind, binding.adapter));
      if (!factory || factory.kind !== kind) {
        throw new UnknownConnectorAdapterError(kind, binding.adapter);
      }
      return factory.build({ tenant, binding, credential }) as ReturnType<FactoryByKind[K]>;
    };

    const buildCrm = async (): Promise<CrmConnector | undefined> => {
      const binding = findBinding("crm");
      if (!binding) return undefined;
      const credential = await this.resolveCredential(tenant, binding, opts.credentialResolver);
      const factory = this.factories.get(factoryKey("crm", binding.adapter));
      if (!factory || factory.kind !== "crm") {
        throw new UnknownConnectorAdapterError("crm", binding.adapter);
      }
      return factory.build({ tenant, binding, credential });
    };

    const [catalogue, delivery, checkout, crm] = await Promise.all([
      buildRequired("catalogue"),
      buildRequired("delivery"),
      buildRequired("checkout"),
      buildCrm(),
    ]);

    return { tenantId: tenant.id, catalogue, delivery, checkout, crm };
  }

  private async resolveCredential(
    tenant: Tenant,
    binding: ConnectorBinding,
    resolver: CredentialResolver,
  ): Promise<CredentialPayload> {
    const scoped: ScopedCredential | undefined = tenant.credentials.find(
      (c) => c.ref === binding.credentialRef,
    );
    if (!scoped) throw new MissingCredentialError(binding.credentialRef);
    return resolver.resolve(scoped.ref);
  }
}
