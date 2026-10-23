/**
 * Reference model of the store port (src/store-port.ts). Each check-and-write runs without an
 * await, so it is atomic like one locked SQL transaction. `beforeIssue` pauses issuance before its
 * decision and `afterIssue` after its commit, before the answer; `broken` makes every call throw.
 */
import type * as Port from '../src/store-port';

export const SESSION_DAYS = 7;
const DAY = 86_400_000;
const SETUP_TTL = 15 * 60 * 1000;
const dates = (issued: number, expires: number) => ({ createdAt: new Date(issued), expiresAt: new Date(expires) });

type Row = {
  id: string;
  secretHash: string;
  generation: number;
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
};
type Installation = { -readonly [K in keyof Omit<Port.Authority, 'sessions'>]: Port.Authority[K] } & {
  capability: { hash: string; expiresAt: number } | null;
};
type Change = Exclude<Port.AdminUpdate, { op: 'init' }>;

export class MemoryStore implements Port.ConnectStore {
  now = Date.now();
  broken = false;
  readonly calls: string[] = [];
  readonly sessions = new Map<string, Row & { userAgent: string | null }>();
  installation: Installation | null = null;
  beforeIssue?: () => Promise<void>;
  afterIssue?: () => Promise<void>;

  #enter(name: string): void {
    this.calls.push(name);
    if (this.broken) throw new Error('store unreachable');
  }

  #denial(row: Row | undefined): Port.SessionDenial | null {
    const i = this.installation;
    if (!row || !i) return 'not-found';
    if (row.revoked) return 'revoked';
    if (row.expiresAt <= this.now) return 'expired';
    if (row.generation !== i.generation) return 'stale-generation';
    return i.state === 'enrolled' ? null : 'not-enrolled';
  }

  async readAuthority(options: { includeSessions?: boolean } = {}): Promise<Port.ReadAuthorityResult> {
    this.#enter('readAuthority');
    if (!this.installation) return { kind: 'missing' };
    const { capability: _, ...authority } = this.installation;
    const live = [...this.sessions.values()].filter((r) => this.#denial(r) === null);
    const sessions = live.map(({ id, issuedAt, expiresAt, userAgent }) => ({
      id,
      userAgent,
      ...dates(issuedAt, expiresAt),
    }));
    return { kind: 'ok', authority: options.includeSessions ? { ...authority, sessions } : authority };
  }

  async issueSession(input: Port.IssueSessionInput): Promise<Port.IssueSessionResult> {
    this.#enter('issueSession');
    await this.beforeIssue?.();
    if (this.broken) throw new Error('store unreachable');
    const i = this.installation;
    const deny = (reason: Port.IssueDenial) => ({ kind: 'denied', reason }) as const;
    if (!i) return deny('not-enrolled');
    if (i.generation !== input.generation) return deny('stale-generation');
    if (i.trustFingerprint !== input.trustFingerprint) return deny('trust-mismatch');
    if (input.purpose === 'setup') {
      if (i.state !== 'setup-pending') return deny('setup-not-pending');
      Object.assign(i, { state: 'enrolled', binding: { ...input.identity } });
    } else if (i.state !== 'enrolled') {
      return deny('not-enrolled');
    } else if (i.binding?.issuer !== input.identity.issuer || i.binding.subject !== input.identity.subject) {
      return deny('identity-mismatch');
    }
    const { sessionId: id, secretHash, userAgent } = input;
    const times = { issuedAt: this.now, expiresAt: this.now + SESSION_DAYS * DAY };
    const row = { id, secretHash, userAgent, generation: i.generation, ...times };
    this.sessions.set(id, { ...row, revoked: false });
    await this.afterIssue?.();
    return { kind: 'issued', issuedAt: new Date(row.issuedAt), expiresAt: new Date(row.expiresAt) };
  }

  async resolveSession({ sessionId }: { sessionId: string }): Promise<Port.ResolveSessionResult> {
    this.#enter('resolveSession');
    const row = this.sessions.get(sessionId);
    const denial = this.#denial(row);
    if (denial !== null || !row || !this.installation) return { kind: 'denied', reason: denial ?? 'not-found' };
    const { createdAt: issuedAt, expiresAt } = dates(row.issuedAt, row.expiresAt);
    const session = { ...row, issuedAt, expiresAt, storeNow: new Date(this.now) };
    return { kind: 'active', session, trustFingerprint: this.installation.trustFingerprint };
  }

  async revokeSession({ sessionId }: { sessionId: string }): Promise<Port.RevokeSessionResult> {
    this.#enter('revokeSession');
    const row = this.sessions.get(sessionId);
    if (!row) return { kind: 'denied', reason: 'not-found' };
    row.revoked = true;
    return { kind: 'revoked' };
  }

  #advance(i: Installation, capabilityHash: string | null = null): Port.AdminUpdateResult {
    for (const row of this.sessions.values()) row.revoked = true;
    i.generation += 1;
    i.capability = capabilityHash === null ? null : { hash: capabilityHash, expiresAt: this.now + SETUP_TTL };
    return { kind: 'ok', generation: i.generation };
  }

  async revokeAll(): Promise<Port.RevokeAllResult> {
    this.#enter('revokeAll');
    if (!this.installation) return { kind: 'unavailable' };
    this.#advance(this.installation);
    return { kind: 'revoked', generation: this.installation.generation };
  }

  async adminUpdate(update: Port.AdminUpdate): Promise<Port.AdminUpdateResult> {
    this.#enter(`adminUpdate:${update.op}`);
    if (update.op !== 'init')
      return this.installation ? this.#change(this.installation, update) : { kind: 'denied', reason: 'missing' };
    if (this.installation) return { kind: 'denied', reason: 'exists' };
    const { installationId, trustFingerprint } = update;
    const fresh = { state: 'unenrolled', generation: 1, binding: null, capability: null } as const;
    this.installation = { installationId, trustFingerprint, ...fresh };
    return { kind: 'ok', generation: 1 };
  }

  #change(i: Installation, update: Change): Port.AdminUpdateResult {
    const mismatch = { kind: 'denied', reason: 'confirmation-mismatch' } as const;
    if (update.op === 'bootstrap') {
      if (i.state === 'enrolled') return { kind: 'denied', reason: 'already-enrolled' };
      return this.#advance(Object.assign(i, { state: 'unenrolled' }), update.capabilityHash);
    }
    if (update.op === 'rebind') {
      const { issuer, subject } = update.confirmBinding;
      if (i.binding?.issuer !== issuer || i.binding.subject !== subject || update.confirmTrust !== i.trustFingerprint)
        return mismatch;
      return this.#advance(Object.assign(i, { state: 'unenrolled', binding: null }), update.capabilityHash);
    }
    if (update.op === 'disable') return this.#advance(Object.assign(i, { state: 'disabled' }));
    if (update.op === 'confirm-trust') {
      if (update.previousTrust !== i.trustFingerprint) return mismatch;
      return this.#advance(Object.assign(i, { trustFingerprint: update.trustFingerprint }));
    }
    if (update.trustFingerprint !== i.trustFingerprint) return { kind: 'denied', reason: 'trust-mismatch' };
    const c = i.capability;
    if (!c || c.hash !== update.capabilityHash || c.expiresAt <= this.now)
      return { kind: 'denied', reason: 'invalid-capability' };
    Object.assign(i, { capability: null, state: 'setup-pending' });
    return { kind: 'ok', generation: i.generation };
  }

  /** Resource policy belongs to the app; the model only proves the typed, fail-closed shape. */
  readonly registry = new Map<string, Omit<Port.BrainContext, 'installationId' | 'admissionId' | 'provenance'>>();
  readonly admissions = new Map<string, Port.BrainContext>();

  async admitBrain(input: Port.AdmitBrainInput): Promise<Port.AdmitBrainResult> {
    this.#enter('admitBrain');
    const live = this.registry.get(input.brainId);
    const origin = input.originSessionId === undefined ? null : this.#denial(this.sessions.get(input.originSessionId));
    if (!live || !this.installation || origin !== null)
      return { kind: 'denied', reason: live ? 'origin-session' : 'not-registered' };
    const ids = { installationId: this.installation.installationId, admissionId: `adm-${live.brainId}` };
    const context = { ...live, ...ids, provenance: input.provenance };
    this.admissions.set(live.brainId, context);
    return { kind: 'admitted', context };
  }

  async authorizeBrain(input: Port.AuthorizeBrainInput): Promise<Port.AuthorizeBrainResult> {
    this.#enter('authorizeBrain');
    const [context, live] = [this.admissions.get(input.brainId), this.registry.get(input.brainId)];
    if (this.#denial(this.sessions.get(input.sessionId)) !== null) return { kind: 'denied', reason: 'session' };
    const same = !!live && Object.entries(live).every(([k, v]) => context?.[k as keyof typeof live] === v);
    return same && context ? { kind: 'authorized', context } : { kind: 'denied', reason: 'registry-changed' };
  }
}
