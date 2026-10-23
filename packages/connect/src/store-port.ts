/**
 * The store port: the only way the core reads or changes durable authority. The adopting app
 * implements it over its own database and owns schema, locks and resource policy; this package
 * carries verified identities and typed results, never roles, SQL or ambient configuration.
 * Contract (test/memory-store.ts is the reference model, test/store-port.test.ts pins it):
 *
 * - Each method is one atomic decision. A throw or `unavailable` denies; nothing is retried as a
 *   fresh login and no cached grant is used.
 * - The generation advances on bootstrap, rebind, disable, trust confirmation and revokeAll. A
 *   session is active only while unrevoked, before its absolute deadline in store time, issued
 *   under the current generation, with the installation enrolled.
 * - issueSession locks the installation, requires the snapshot generation and trust unchanged and
 *   (login) the exact bound issuer and subject or (setup) a capability consumed in that generation,
 *   which it turns into the binding; it inserts one independent session and commits before `issued`.
 * - Revocation is permanent; nothing clears it or creates a successor. Secrets arrive only as
 *   SHA-256 hashes; provider tokens never arrive.
 * - Admission removal, disable and readmission, and what each `Denied<string>` resource reason
 *   means, are app operations and policy outside this port (Brain Groups 3 and 5).
 */

/** An issuer and subject proven by a freshly exchanged, verified ID token. Never an email. */
export interface VerifiedIdentity {
  readonly issuer: string;
  readonly subject: string;
}

/** The authority could not be read or written: 503 at the HTTP boundary. */
export type Unavailable = { readonly kind: 'unavailable' };
export type Denied<R> = { readonly kind: 'denied'; readonly reason: R };
export type IssuePurpose = 'login' | 'setup';
export type InstallationState = 'unenrolled' | 'setup-pending' | 'enrolled' | 'disabled';
export type SessionSummary = { id: string; createdAt: Date; expiresAt: Date; userAgent: string | null };

export interface Authority {
  readonly installationId: string;
  readonly state: InstallationState;
  readonly generation: number;
  readonly trustFingerprint: string;
  readonly binding: VerifiedIdentity | null;
  /** Active sessions, only when requested. */
  readonly sessions?: readonly SessionSummary[];
}
/** `missing`: no installation or schema, which never means the first visitor owns the app. */
export type ReadAuthorityResult = { kind: 'ok'; authority: Authority } | { kind: 'missing' } | Unavailable;

export interface IssueSessionInput {
  readonly purpose: IssuePurpose;
  /** The generation snapshotted before the provider redirect. */
  readonly generation: number;
  readonly trustFingerprint: string;
  readonly identity: VerifiedIdentity;
  readonly sessionId: string;
  readonly secretHash: string;
  readonly userAgent: string | null;
}
export type IssueDenial =
  | 'stale-generation'
  | 'trust-mismatch'
  | 'not-enrolled'
  | 'identity-mismatch'
  | 'setup-not-pending';
export type IssueSessionResult =
  | { kind: 'issued'; issuedAt: Date; expiresAt: Date }
  | Denied<IssueDenial>
  | Unavailable;

/** `storeNow` is the store's clock: deadlines are compared in store time. */
export type StoredSession = { id: string; secretHash: string; issuedAt: Date; expiresAt: Date; storeNow: Date };
export type SessionDenial = 'not-found' | 'revoked' | 'expired' | 'stale-generation' | 'not-enrolled';
export type ResolveSessionResult =
  | { kind: 'active'; session: StoredSession; trustFingerprint: string }
  | Denied<SessionDenial>
  | Unavailable;
export type RevokeSessionResult = { kind: 'revoked' } | Denied<'not-found'> | Unavailable;
export type RevokeAllResult = { kind: 'revoked'; generation: number } | Unavailable;

/** Installation changes. All but `consume-setup` (the setup POST) are local operator commands. */
export type AdminUpdate =
  | { op: 'init'; installationId: string; trustFingerprint: string }
  | { op: 'bootstrap'; capabilityHash: string }
  | { op: 'rebind'; confirmBinding: VerifiedIdentity; confirmTrust: string; capabilityHash: string }
  | { op: 'disable' }
  | { op: 'confirm-trust'; previousTrust: string; trustFingerprint: string }
  | { op: 'consume-setup'; capabilityHash: string; trustFingerprint: string };
export type AdminDenial =
  | 'missing'
  | 'exists'
  | 'already-enrolled'
  | 'confirmation-mismatch'
  | 'invalid-capability'
  | 'trust-mismatch';
export type AdminUpdateResult = { kind: 'ok'; generation: number } | Denied<AdminDenial> | Unavailable;

/** The app's resource decision carried as data: the full context, not an id. */
export type AdmissionProvenance = 'configured' | 'studio-created';
export interface BrainContext {
  readonly installationId: string;
  readonly admissionId: string;
  readonly provenance: AdmissionProvenance;
  readonly brainId: string;
  readonly createdAt: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly home: string | null;
}
/** studio-created admissions name the confirming session and the create's validated home. */
export type AdmitBrainInput = {
  brainId: string;
  provenance: AdmissionProvenance;
  originSessionId?: string;
  targetHome?: string;
};
export type AdmitBrainResult = { kind: 'admitted'; context: BrainContext } | Denied<string> | Unavailable;
export type AuthorizeBrainInput = { sessionId: string; brainId: string };
export type AuthorizeBrainResult = { kind: 'authorized'; context: BrainContext } | Denied<string> | Unavailable;

export interface ConnectStore {
  readAuthority(options?: { includeSessions?: boolean }): Promise<ReadAuthorityResult>;
  issueSession(input: IssueSessionInput): Promise<IssueSessionResult>;
  resolveSession(input: { sessionId: string }): Promise<ResolveSessionResult>;
  revokeSession(input: { sessionId: string }): Promise<RevokeSessionResult>;
  revokeAll(): Promise<RevokeAllResult>;
  adminUpdate(update: AdminUpdate): Promise<AdminUpdateResult>;
  admitBrain(input: AdmitBrainInput): Promise<AdmitBrainResult>;
  authorizeBrain(input: AuthorizeBrainInput): Promise<AuthorizeBrainResult>;
}

/** Runs one port call; a throw or a malformed answer becomes `unavailable`, never a grant. */
export async function callStore<T extends { kind: string }>(call: () => Promise<T>): Promise<T | Unavailable> {
  try {
    const result = await call();
    return result && typeof result.kind === 'string' ? result : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
