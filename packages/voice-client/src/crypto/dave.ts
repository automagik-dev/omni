/**
 * DAVE (Discord Audio Video Encryption) protocol wrapper.
 *
 * Wraps @snazzah/davey DAVESession with a clean interface for our Gateway v8 client.
 * Discord requires DAVE for all voice connections as of March 2026.
 *
 * @see https://daveprotocol.com/
 */
import * as davey from '@snazzah/davey';

// The @snazzah/davey native module exposes both enum values and the DAVESession class.
// Types are re-exported below for consumers.
const { DAVESession, DAVE_PROTOCOL_VERSION, MediaType } = davey as unknown as {
  DAVESession: new (
    protocolVersion: number,
    userId: string,
    channelId: string,
    keyPair?: unknown,
  ) => DaveSessionInstance;
  DAVE_PROTOCOL_VERSION: number;
  MediaType: { AUDIO: 0; VIDEO: 1 };
};

export { DAVE_PROTOCOL_VERSION };

/** Shape of a DAVESession instance from @snazzah/davey. */
interface DaveSessionInstance {
  readonly ready: boolean;
  readonly channelId: string;
  readonly userId: string;
  readonly protocolVersion: number;
  readonly epoch: bigint | null;
  setExternalSender(data: Buffer): void;
  getSerializedKeyPackage(): Buffer;
  processProposals(
    op: number,
    proposals: Buffer,
    recognizedUserIds?: string[] | null,
  ): { commit?: Buffer; welcome?: Buffer };
  processCommit(commit: Buffer): void;
  processWelcome(welcome: Buffer): void;
  encryptOpus(packet: Buffer): Buffer;
  decrypt(userId: string, mediaType: number, packet: Buffer): Buffer;
  canPassthrough(userId: string): boolean;
  setPassthroughMode(enabled: boolean, transitionExpiry?: number | null): void;
  reinit(version: number, userId: string, channelId: string, keyPair?: unknown): void;
  reset(): void;
  getUserIds(): string[];
}

/**
 * High-level manager for a DAVE session.
 *
 * Tracks pending transitions (which MLS epochs we're waiting on) and exposes
 * the minimal surface the Gateway needs to drive the handshake.
 */
export class DaveManager {
  private session: DaveSessionInstance | null = null;
  private _protocolVersion = 0;
  /** Pending transitionId → callback, so transition_ready can be sent */
  private pendingTransitions = new Map<number, () => void>();
  /** Last transition id seen (for recovery). */
  private lastTransitionId = 0;
  /** Known user IDs in the voice channel (from Speaking / raw events). */
  private recognizedUserIds = new Set<string>();

  get ready(): boolean {
    return this.session?.ready ?? false;
  }

  get protocolVersion(): number {
    return this._protocolVersion;
  }

  get session_(): DaveSessionInstance | null {
    return this.session;
  }

  /** Initialize a DAVE session. Returns the initial key package to send via Op 26. */
  init(protocolVersion: number, userId: string, channelId: string): Buffer {
    this._protocolVersion = protocolVersion;
    this.session = new DAVESession(protocolVersion, userId, channelId);
    this.pendingTransitions.clear();
    // Do NOT clear recognizedUserIds — they were seeded by the caller before init()
    return this.session.getSerializedKeyPackage();
  }

  /** Reset and re-initialize the session (e.g. after an invalid commit). */
  reinit(protocolVersion: number, userId: string, channelId: string): Buffer {
    if (!this.session) {
      return this.init(protocolVersion, userId, channelId);
    }
    this.session.reinit(protocolVersion, userId, channelId);
    this._protocolVersion = protocolVersion;
    this.pendingTransitions.clear();
    return this.session.getSerializedKeyPackage();
  }

  /** Register a user ID as being in the voice channel (from Speaking events). */
  addRecognizedUser(userId: string): void {
    this.recognizedUserIds.add(userId);
  }

  /** Remove a user ID (on ClientDisconnect). */
  removeRecognizedUser(userId: string): void {
    this.recognizedUserIds.delete(userId);
  }

  /** Install the external sender credential from Op 25. */
  setExternalSender(data: Buffer): void {
    if (!this.session) throw new Error('DAVE session not initialized');
    this.session.setExternalSender(data);
  }

  /**
   * Process Op 27 proposals payload.
   * Binary format: [optype:1][proposals_or_refs:rest]
   * Returns the commit+welcome buffer to send in Op 28, or null if no commit.
   */
  processProposals(payload: Buffer): Buffer | null {
    if (!this.session) throw new Error('DAVE session not initialized');
    const optype = payload[0] ?? 0;
    const proposals = payload.subarray(1);
    const recognized = Array.from(this.recognizedUserIds);
    const result = this.session.processProposals(optype, proposals, recognized);
    if (!result.commit) return null;
    // Op 28 payload = commit || welcome (if any)
    return result.welcome ? Buffer.concat([result.commit, result.welcome]) : result.commit;
  }

  /**
   * Process Op 29 payload: [transitionId:u16 BE][commit:rest].
   * Returns transitionId so caller can decide whether to send Op 23.
   */
  processCommit(payload: Buffer): number {
    if (!this.session) throw new Error('DAVE session not initialized');
    if (payload.length < 2) throw new Error('Op 29 payload too short');
    const transitionId = payload.readUInt16BE(0);
    const commit = payload.subarray(2);
    this.session.processCommit(commit);
    this.lastTransitionId = transitionId;
    return transitionId;
  }

  /**
   * Process Op 30 payload: [transitionId:u16 BE][welcome:rest].
   * Returns transitionId.
   */
  processWelcome(payload: Buffer): number {
    if (!this.session) throw new Error('DAVE session not initialized');
    if (payload.length < 2) throw new Error('Op 30 payload too short');
    const transitionId = payload.readUInt16BE(0);
    const welcome = payload.subarray(2);
    this.session.processWelcome(welcome);
    this.lastTransitionId = transitionId;
    return transitionId;
  }

  /** Enable/disable passthrough mode (for plaintext frames during transitions). */
  setPassthroughMode(enabled: boolean, transitionExpiry = 10): void {
    if (!this.session) return;
    this.session.setPassthroughMode(enabled, transitionExpiry);
  }

  /**
   * Decrypt an incoming audio packet from a specific user.
   * Returns null on failure (caller should drop the frame).
   */
  decryptAudio(userId: string, packet: Buffer): Buffer | null {
    if (!this.session) return null;
    try {
      return this.session.decrypt(userId, MediaType.AUDIO, packet);
    } catch {
      return null;
    }
  }

  /** Check if a user's decryptor is in passthrough mode. */
  canPassthrough(userId: string): boolean {
    return this.session?.canPassthrough(userId) ?? false;
  }

  /** Get a fresh key package to send (used after reinit). */
  getKeyPackage(): Buffer {
    if (!this.session) throw new Error('DAVE session not initialized');
    return this.session.getSerializedKeyPackage();
  }

  /** Destroy the session. */
  destroy(): void {
    this.session?.reset();
    this.session = null;
    this.pendingTransitions.clear();
    this.recognizedUserIds.clear();
  }
}
