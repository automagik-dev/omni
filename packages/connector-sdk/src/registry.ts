/**
 * Boot-validated connector manifest registry.
 *
 * Registration fails LOUDLY: a duplicate id, an unsafe id, a missing schema or
 * a duplicate action key means the process should not boot with a half-defined
 * provider. Nothing here reads the database, and nothing in the core switches
 * on a provider id.
 */

import type { ConnectorManifest } from './types';

const ID = /^[a-z][a-z0-9-]{1,63}$/;

export class ConnectorRegistryError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid connector manifest registry:\n- ${issues.join('\n- ')}`);
    this.name = 'ConnectorRegistryError';
    this.issues = issues;
  }
}

function isZodSchema(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === 'function' &&
    typeof (value as { parse?: unknown }).parse === 'function'
  );
}

function validateIdentity(manifest: ConnectorManifest, where: string): string[] {
  const issues: string[] = [];
  if (typeof manifest?.id !== 'string' || !ID.test(manifest.id)) issues.push(`${where}: id must match ${ID}`);
  if (typeof manifest?.label !== 'string' || manifest.label.trim().length === 0) {
    issues.push(`${where}: label is required`);
  }
  if (typeof manifest?.version !== 'string' || manifest.version.trim().length === 0) {
    issues.push(`${where}: version is required`);
  }
  if (typeof manifest?.validate !== 'function') issues.push(`${where}: validate() is required`);
  if (typeof manifest?.guide !== 'object' || manifest.guide === null) issues.push(`${where}: guide copy is required`);
  return issues;
}

function validateCredentials(manifest: ConnectorManifest, where: string): string[] {
  const issues: string[] = [];
  if (!Array.isArray(manifest?.credentialFields) || manifest.credentialFields.length === 0) {
    issues.push(`${where}: at least one credential field is required`);
    return issues;
  }
  const keys = new Set<string>();
  for (const field of manifest.credentialFields) {
    if (!field.key || keys.has(field.key)) {
      issues.push(`${where}: credential field '${field.key}' is empty or duplicated`);
    }
    keys.add(field.key);
    if (!field.label) issues.push(`${where}: credential field '${field.key}' has no label`);
  }
  if (!isZodSchema(manifest.configSchema)) issues.push(`${where}: configSchema must be a Zod schema`);
  return issues;
}

function validateEvents(manifest: ConnectorManifest, where: string): string[] {
  if (!Array.isArray(manifest?.events) || manifest.events.length === 0) {
    return [`${where}: at least one event is required`];
  }
  const issues: string[] = [];
  const keys = new Set<string>();
  for (const event of manifest.events) {
    if (!event.key || keys.has(event.key)) issues.push(`${where}: event '${event.key}' is empty or duplicated`);
    keys.add(event.key);
    if (!event.label) issues.push(`${where}: event '${event.key}' has no label`);
    if (event.filterSchema !== undefined && !isZodSchema(event.filterSchema)) {
      issues.push(`${where}: event '${event.key}' filterSchema is not a Zod schema`);
    }
  }
  return issues;
}

function validateActions(manifest: ConnectorManifest, where: string): string[] {
  if (!Array.isArray(manifest?.actions) || manifest.actions.length === 0) {
    return [`${where}: at least one action is required`];
  }
  const issues: string[] = [];
  const keys = new Set<string>();
  for (const action of manifest.actions) {
    if (!action.key || keys.has(action.key)) issues.push(`${where}: action '${action.key}' is empty or duplicated`);
    keys.add(action.key);
    if (!action.label) issues.push(`${where}: action '${action.key}' has no label`);
    if (!isZodSchema(action.inputSchema)) {
      issues.push(`${where}: action '${action.key}' inputSchema must be a Zod schema`);
    }
    if (typeof action.run !== 'function') issues.push(`${where}: action '${action.key}' run() is required`);
  }
  return issues;
}

function validateVerification(manifest: ConnectorManifest, where: string): string[] {
  const verification = manifest?.verification;
  if (!verification || (verification.kind !== 'hmac-sha256' && verification.kind !== 'custom')) {
    return [`${where}: verification must be hmac-sha256 or custom`];
  }
  if (verification.kind === 'custom') {
    return typeof verification.verify === 'function' ? [] : [`${where}: custom verification needs verify()`];
  }
  const issues: string[] = [];
  if (!verification.header || typeof verification.header !== 'string') {
    issues.push(`${where}: hmac-sha256 verification needs a header`);
  }
  if (verification.encoding !== 'hex' && verification.encoding !== 'base64') {
    issues.push(`${where}: hmac-sha256 encoding must be hex or base64`);
  }
  return issues;
}

/** Structural validation applied to every manifest, at construction and at boot. */
export function validateManifest(manifest: ConnectorManifest): string[] {
  const where = typeof manifest?.id === 'string' ? `connector '${manifest.id}'` : 'connector <missing id>';
  const issues = [
    ...validateIdentity(manifest, where),
    ...validateCredentials(manifest, where),
    ...validateEvents(manifest, where),
    ...validateActions(manifest, where),
    ...validateVerification(manifest, where),
  ];
  if (manifest?.parseDelivery !== undefined && typeof manifest.parseDelivery !== 'function') {
    issues.push(`${where}: parseDelivery must be a function when present`);
  }
  return issues;
}

export class ConnectorRegistry {
  private readonly manifests = new Map<string, ConnectorManifest>();

  constructor(manifests: readonly ConnectorManifest[] = []) {
    if (manifests.length > 0) this.registerAll(manifests);
  }

  /** Register one manifest. Rejects a duplicate id immediately. */
  register(manifest: ConnectorManifest): void {
    const issues = validateManifest(manifest);
    if (issues.length > 0) throw new ConnectorRegistryError(issues);
    if (this.manifests.has(manifest.id)) {
      throw new ConnectorRegistryError([`connector '${manifest.id}' is already registered`]);
    }
    this.manifests.set(manifest.id, manifest);
  }

  /** Register many manifests atomically: validate all, then commit. */
  registerAll(manifests: readonly ConnectorManifest[]): void {
    const issues = manifests.flatMap((manifest) => validateManifest(manifest));
    const ids = new Set<string>();
    for (const manifest of manifests) {
      if (ids.has(manifest.id)) issues.push(`connector '${manifest.id}' is registered twice`);
      ids.add(manifest.id);
      if (this.manifests.has(manifest.id)) issues.push(`connector '${manifest.id}' is already registered`);
    }
    if (issues.length > 0) throw new ConnectorRegistryError(issues);
    for (const manifest of manifests) this.manifests.set(manifest.id, manifest);
  }

  get(id: string): ConnectorManifest | undefined {
    return this.manifests.get(id);
  }

  has(id: string): boolean {
    return this.manifests.has(id);
  }

  list(): ConnectorManifest[] {
    return [...this.manifests.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Re-run structural validation; returns the issue list (empty = valid). */
  assertValid(): readonly string[] {
    const issues = this.list().flatMap((manifest) => validateManifest(manifest));
    if (issues.length > 0) throw new ConnectorRegistryError(issues);
    return [];
  }
}
