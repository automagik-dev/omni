/**
 * Connector manifest contract.
 *
 * A connector manifest is CODE, not a database row: handlers and Zod schemas
 * cannot be stored, so the database stores connector instances and event
 * subscriptions only. One manifest per provider; nothing in the core switches
 * on a provider id.
 *
 * The contract is provider-neutral on purpose. A second provider supplies one
 * more module implementing this interface and registers it at boot; no enum,
 * route, scope, trigger or action type changes.
 */

import type { z } from 'zod';

/** One credential input the connect flow collects. Secret fields are sealed at rest. */
export interface ConnectorCredentialField {
  /** Stable key inside the sealed credentials object (e.g. `token`). */
  readonly key: string;
  /** Operator-facing label. */
  readonly label: string;
  /**
   * True when the value is secret material. Every credential value is sealed
   * regardless; this flag tells clients and the audit which inputs to mask.
   */
  readonly secret: boolean;
  readonly optional?: boolean;
  /** Optional short help text shown by the catalog and the CLI. */
  readonly help?: string;
}

/** A provider event a subscription can bind to. */
export interface ConnectorEventDefinition {
  /** Provider event key, stored as `provider_event_key` on a subscription. */
  readonly key: string;
  readonly label: string;
  /** Optional schema for the subscription's `filters` object. */
  readonly filterSchema?: z.ZodType<Record<string, unknown>>;
  /** A representative provider payload, used by "send test delivery". */
  readonly sample?: Record<string, unknown>;
}

/** What an action receives at run time. */
export interface ConnectorActionContext {
  /** Opened credential values for the connector. Never logged or returned. */
  readonly credentials: Readonly<Record<string, string>>;
  /** Non-secret connector config, already validated against `configSchema`. */
  readonly config: Readonly<Record<string, unknown>>;
  /** Action input after template rendering and manifest validation. */
  readonly input: Readonly<Record<string, unknown>>;
  /** Injected transport; tests replace it, production passes the global fetch. */
  readonly fetch: typeof fetch;
  /** Bounded per-call timeout. */
  readonly timeoutMs: number;
}

/** One typed operation declared by a manifest. */
export interface ConnectorActionDefinition {
  /** Action key, e.g. `add_comment`. Referenced literally by `connector.call`. */
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  /** Boundary validation for the rendered input. Invalid input never reaches the provider. */
  readonly inputSchema: z.ZodType<Record<string, unknown>>;
  /** Run the operation. Errors must already be safe to show an operator. */
  run(context: ConnectorActionContext): Promise<unknown>;
}

/** Result of a synchronous connection validation. */
export type ConnectorValidationResult =
  | { readonly ok: true; readonly account?: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** A parsed inbound delivery, before idempotency and journaling. */
export interface ConnectorParsedDelivery {
  /** Provider event key; must match the subscription's `provider_event_key`. */
  readonly eventKey: string;
  /**
   * Stable provider-side identity for this event, when the provider supplies
   * one. The delivery dedupes on it; absent means the body hash is used.
   */
  readonly providerEventId?: string;
  /** ISO-8601 timestamp from the provider, when present. */
  readonly occurredAt?: string;
  /** The provider payload that is spread into the published event. */
  readonly data: Record<string, unknown>;
}

/** How a provider signs an inbound delivery. */
export type ConnectorVerification =
  | {
      readonly kind: 'hmac-sha256';
      /** Header carrying the digest, e.g. `X-Signature`. Case-insensitive. */
      readonly header: string;
      readonly encoding: 'hex' | 'base64';
      /** Optional prefix the provider puts before the digest (e.g. `sha256=`). */
      readonly prefix?: string;
    }
  | {
      readonly kind: 'custom';
      verify(rawBody: string, headers: Readonly<Record<string, string>>, secret: string): Promise<boolean> | boolean;
    };

/** The code-declared contract for one provider. */
export interface ConnectorManifest {
  /** Stable provider id (`clickup`, `github`). Lowercase kebab. */
  readonly id: string;
  readonly label: string;
  /** Advisory in v1; a breaking input change takes a new action key or version. */
  readonly version: string;
  readonly credentialFields: readonly ConnectorCredentialField[];
  /** Non-secret config. A manifest that needs a private value puts it in credentials. */
  readonly configSchema: z.ZodType<Record<string, unknown>>;
  /** Synchronous connect validation, e.g. a `GET /team` token check. */
  validate(args: {
    readonly credentials: Readonly<Record<string, string>>;
    readonly config: Readonly<Record<string, unknown>>;
    readonly fetch: typeof fetch;
  }): Promise<ConnectorValidationResult>;
  readonly events: readonly ConnectorEventDefinition[];
  readonly actions: readonly ConnectorActionDefinition[];
  readonly verification: ConnectorVerification;
  /**
   * Parse a verified provider body into the normalized envelope. Throwing is a
   * processing failure (the subscription counter increments); an event key that
   * does not match the subscription is an `ignored` ack, not an error.
   */
  parseDelivery?(rawBody: string, headers: Readonly<Record<string, string>>): ConnectorParsedDelivery;
  /** Connect copy and error legend, rendered by the API catalog and the CLI. */
  readonly guide: Readonly<Record<string, string>>;
}

/** Raised when a provider body cannot be parsed at all (as opposed to a mismatched key). */
export class ConnectorDeliveryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectorDeliveryParseError';
  }
}

/** The public catalog projection of a manifest. */
export interface ConnectorProviderSummary {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly events: ReadonlyArray<{ key: string; label: string }>;
  readonly actions: ReadonlyArray<{ key: string; label: string }>;
}

export interface ConnectorProviderDetail extends ConnectorProviderSummary {
  readonly credentialFields: readonly ConnectorCredentialField[];
  readonly events: ReadonlyArray<{ key: string; label: string; sample?: Record<string, unknown> }>;
  readonly actions: ReadonlyArray<{
    key: string;
    label: string;
    description?: string;
    inputSchema: Record<string, unknown>;
  }>;
  readonly guide: Readonly<Record<string, string>>;
}
