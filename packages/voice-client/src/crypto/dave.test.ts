import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { DaveManager } from './dave';

/**
 * DaveManager tests — inject a mock session directly via bracket notation
 * to avoid mock.module issues with native @snazzah/davey in full suite runs.
 */

function createMockSession() {
  return {
    ready: false,
    channelId: '',
    userId: '',
    protocolVersion: 0,
    epoch: null as bigint | null,
    setExternalSender: mock(() => {}),
    getSerializedKeyPackage: mock(() => Buffer.from('key-package')),
    processProposals: mock(() => ({
      commit: undefined as Buffer | undefined,
      welcome: undefined as Buffer | undefined,
    })),
    processCommit: mock(() => {}),
    processWelcome: mock(() => {}),
    encryptOpus: mock((packet: Buffer) => Buffer.concat([Buffer.from('enc:'), packet])),
    decrypt: mock((_userId: string, _mediaType: number, packet: Buffer) => packet),
    canPassthrough: mock((_userId: string) => false),
    setPassthroughMode: mock(() => {}),
    reinit: mock(() => {}),
    reset: mock(() => {}),
    getUserIds: mock(() => [] as string[]),
  };
}

type MockSession = ReturnType<typeof createMockSession>;

/** Inject a mock session into DaveManager's private field. */
function injectSession(dave: DaveManager, session: MockSession): void {
  (dave as any).session = session;
}

describe('DaveManager', () => {
  let dave: DaveManager;
  let mockSession: MockSession;

  beforeEach(() => {
    dave = new DaveManager();
    mockSession = createMockSession();
  });

  describe('state before init', () => {
    it('should not be ready without a session', () => {
      expect(dave.ready).toBe(false);
      expect(dave.protocolVersion).toBe(0);
    });
  });

  describe('setExternalSender (Op 25)', () => {
    it('should throw if session not initialized', () => {
      expect(() => dave.setExternalSender(Buffer.from('data'))).toThrow('not initialized');
    });

    it('should delegate to session', () => {
      injectSession(dave, mockSession);
      const data = Buffer.from('external-sender-data');
      dave.setExternalSender(data);
      expect(mockSession.setExternalSender).toHaveBeenCalledWith(data);
    });
  });

  describe('processProposals (Op 27)', () => {
    it('should throw if session not initialized', () => {
      expect(() => dave.processProposals(Buffer.from([0x01]))).toThrow('not initialized');
    });

    it('should return null when no commit generated', () => {
      injectSession(dave, mockSession);
      mockSession.processProposals.mockReturnValue({ commit: undefined, welcome: undefined });

      const result = dave.processProposals(Buffer.from([0x01, 0xaa]));
      expect(result).toBeNull();
    });

    it('should return commit buffer when commit generated', () => {
      injectSession(dave, mockSession);
      const commitBuf = Buffer.from('commit-data');
      mockSession.processProposals.mockReturnValue({ commit: commitBuf, welcome: undefined });

      const result = dave.processProposals(Buffer.from([0x02, 0xbb]));
      expect(result).toEqual(commitBuf);
    });

    it('should concatenate commit+welcome when both present', () => {
      injectSession(dave, mockSession);
      const commitBuf = Buffer.from('commit');
      const welcomeBuf = Buffer.from('welcome');
      mockSession.processProposals.mockReturnValue({ commit: commitBuf, welcome: welcomeBuf });

      const result = dave.processProposals(Buffer.from([0x01, 0xcc]));
      expect(result).toEqual(Buffer.concat([commitBuf, welcomeBuf]));
    });

    it('should parse optype from first byte of payload', () => {
      injectSession(dave, mockSession);
      mockSession.processProposals.mockReturnValue({ commit: undefined, welcome: undefined });

      dave.processProposals(Buffer.from([0x03, 0xdd, 0xee]));
      expect(mockSession.processProposals).toHaveBeenCalledWith(0x03, expect.any(Buffer), expect.any(Array));
      const callArgs = mockSession.processProposals.mock.calls[0] as unknown[];
      expect(Buffer.from(callArgs[1] as Buffer)).toEqual(Buffer.from([0xdd, 0xee]));
    });

    it('should pass recognized users to processProposals', () => {
      dave.addRecognizedUser('alice');
      dave.addRecognizedUser('bob');
      injectSession(dave, mockSession);
      mockSession.processProposals.mockReturnValue({ commit: undefined, welcome: undefined });

      dave.processProposals(Buffer.from([0x01]));

      const recognized = (mockSession.processProposals.mock.calls[0] as unknown[])[2] as string[];
      expect(recognized).toContain('alice');
      expect(recognized).toContain('bob');
    });
  });

  describe('processCommit (Op 29)', () => {
    it('should throw if session not initialized', () => {
      expect(() => dave.processCommit(Buffer.from([0x00, 0x01, 0xaa]))).toThrow('not initialized');
    });

    it('should throw if payload too short', () => {
      injectSession(dave, mockSession);
      expect(() => dave.processCommit(Buffer.from([0x01]))).toThrow('too short');
    });

    it('should parse transitionId and delegate commit', () => {
      injectSession(dave, mockSession);
      const payload = Buffer.from([0x00, 0x05, 0xaa, 0xbb]);
      const transitionId = dave.processCommit(payload);

      expect(transitionId).toBe(5);
      expect(mockSession.processCommit).toHaveBeenCalled();
      const commitArg = (mockSession.processCommit.mock.calls[0] as unknown[])[0] as Buffer;
      expect(Buffer.from(commitArg)).toEqual(Buffer.from([0xaa, 0xbb]));
    });
  });

  describe('processWelcome (Op 30)', () => {
    it('should throw if session not initialized', () => {
      expect(() => dave.processWelcome(Buffer.from([0x00, 0x01, 0xaa]))).toThrow('not initialized');
    });

    it('should throw if payload too short', () => {
      injectSession(dave, mockSession);
      expect(() => dave.processWelcome(Buffer.from([0x01]))).toThrow('too short');
    });

    it('should parse transitionId and delegate welcome', () => {
      injectSession(dave, mockSession);
      const payload = Buffer.from([0x00, 0x0a, 0xcc, 0xdd]);
      const transitionId = dave.processWelcome(payload);

      expect(transitionId).toBe(10);
      expect(mockSession.processWelcome).toHaveBeenCalled();
      const welcomeArg = (mockSession.processWelcome.mock.calls[0] as unknown[])[0] as Buffer;
      expect(Buffer.from(welcomeArg)).toEqual(Buffer.from([0xcc, 0xdd]));
    });
  });

  describe('passthrough mode (downgrade)', () => {
    it('should no-op if session not initialized', () => {
      dave.setPassthroughMode(true);
    });

    it('should delegate to session with expiry', () => {
      injectSession(dave, mockSession);
      dave.setPassthroughMode(true, 24);
      expect(mockSession.setPassthroughMode).toHaveBeenCalledWith(true, 24);
    });

    it('should use default expiry of 10', () => {
      injectSession(dave, mockSession);
      dave.setPassthroughMode(false);
      expect(mockSession.setPassthroughMode).toHaveBeenCalledWith(false, 10);
    });

    it('should check canPassthrough per user', () => {
      injectSession(dave, mockSession);
      mockSession.canPassthrough.mockReturnValue(true);
      expect(dave.canPassthrough('alice')).toBe(true);
      expect(mockSession.canPassthrough).toHaveBeenCalledWith('alice');
    });

    it('should return false if session not initialized', () => {
      expect(dave.canPassthrough('alice')).toBe(false);
    });
  });

  describe('encrypt/decrypt audio', () => {
    it('should return null if session not initialized', () => {
      expect(dave.decryptAudio('alice', Buffer.from([0x01]))).toBeNull();
      expect(dave.encryptAudio(Buffer.from([0x01]))).toBeNull();
    });

    it('should return null if session not ready for encrypt', () => {
      injectSession(dave, mockSession);
      mockSession.ready = false;
      expect(dave.encryptAudio(Buffer.from([0x01]))).toBeNull();
    });

    it('should decrypt audio via session', () => {
      injectSession(dave, mockSession);
      const packet = Buffer.from([0xaa, 0xbb]);
      const result = dave.decryptAudio('alice', packet);
      expect(mockSession.decrypt).toHaveBeenCalledWith('alice', 0, packet);
      expect(result).toEqual(packet);
    });

    it('should return null on decrypt failure', () => {
      injectSession(dave, mockSession);
      mockSession.decrypt.mockImplementation(() => {
        throw new Error('MLS failed');
      });
      const result = dave.decryptAudio('alice', Buffer.from([0x01]));
      expect(result).toBeNull();
    });

    it('should encrypt audio when session ready', () => {
      injectSession(dave, mockSession);
      mockSession.ready = true;
      const frame = Buffer.from([0x01, 0x02]);
      const result = dave.encryptAudio(frame);
      expect(mockSession.encryptOpus).toHaveBeenCalledWith(frame);
      expect(result).toEqual(Buffer.concat([Buffer.from('enc:'), frame]));
    });

    it('should return null on encrypt failure', () => {
      injectSession(dave, mockSession);
      mockSession.ready = true;
      mockSession.encryptOpus.mockImplementation(() => {
        throw new Error('encrypt failed');
      });
      const result = dave.encryptAudio(Buffer.from([0x01]));
      expect(result).toBeNull();
    });
  });

  describe('recognized users', () => {
    it('should track add/remove', () => {
      dave.addRecognizedUser('alice');
      dave.addRecognizedUser('bob');
      dave.removeRecognizedUser('alice');

      injectSession(dave, mockSession);
      mockSession.processProposals.mockReturnValue({ commit: undefined, welcome: undefined });
      dave.processProposals(Buffer.from([0x01]));

      const recognized = (mockSession.processProposals.mock.calls[0] as unknown[])[2] as string[];
      expect(recognized).toContain('bob');
      expect(recognized).not.toContain('alice');
    });
  });

  describe('destroy', () => {
    it('should reset session and clear state', () => {
      injectSession(dave, mockSession);
      dave.addRecognizedUser('alice');
      dave.destroy();

      expect(mockSession.reset).toHaveBeenCalled();
      expect(dave.ready).toBe(false);
    });

    it('should no-op if no session', () => {
      dave.destroy();
    });
  });

  describe('getKeyPackage', () => {
    it('should throw if not initialized', () => {
      expect(() => dave.getKeyPackage()).toThrow('not initialized');
    });

    it('should return key package from session', () => {
      injectSession(dave, mockSession);
      mockSession.getSerializedKeyPackage.mockReturnValue(Buffer.from('fresh-key'));
      expect(dave.getKeyPackage()).toEqual(Buffer.from('fresh-key'));
    });
  });
});
