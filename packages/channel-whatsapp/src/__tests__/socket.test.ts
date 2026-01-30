/**
 * Tests for socket wrapper utilities
 */

import { describe, expect, it } from 'bun:test';
import { SocketManager } from '../socket';

describe('Socket Utilities', () => {
  describe('SocketManager', () => {
    it('starts with no sockets', () => {
      const manager = new SocketManager();
      expect(manager.size).toBe(0);
      expect(manager.getInstanceIds()).toEqual([]);
    });

    it('has() returns false for non-existent instance', () => {
      const manager = new SocketManager();
      expect(manager.has('test-instance')).toBe(false);
    });

    it('get() returns undefined for non-existent instance', () => {
      const manager = new SocketManager();
      expect(manager.get('test-instance')).toBeUndefined();
    });

    it('remove() returns false for non-existent instance', () => {
      const manager = new SocketManager();
      expect(manager.remove('test-instance')).toBe(false);
    });

    it('close() handles non-existent instance gracefully', async () => {
      const manager = new SocketManager();
      // Should not throw
      await manager.close('non-existent');
      expect(manager.size).toBe(0);
    });

    it('closeAll() handles empty manager gracefully', async () => {
      const manager = new SocketManager();
      // Should not throw
      await manager.closeAll();
      expect(manager.size).toBe(0);
    });
  });
});
