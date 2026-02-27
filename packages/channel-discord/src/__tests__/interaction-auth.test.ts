/**
 * Tests for interaction authorization
 */

import { describe, expect, test } from 'bun:test';
import {
  type InteractionAuthConfig,
  type InteractionAuthContext,
  checkInteractionAuth,
} from '../auth/interaction-auth';

describe('Interaction Authorization', () => {
  describe('DM interactions', () => {
    test('DM interactions are always allowed', () => {
      const context: InteractionAuthContext = {
        userId: 'user-1',
        guildId: undefined,
        userRoleIds: [],
      };

      const result = checkInteractionAuth(context, {
        allowedRoleIds: ['role-admin'],
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('DM');
    });
  });

  describe('no config', () => {
    test('all interactions allowed when no config', () => {
      const context: InteractionAuthContext = {
        userId: 'user-1',
        guildId: 'guild-1',
        userRoleIds: [],
      };

      const result = checkInteractionAuth(context);
      expect(result.allowed).toBe(true);
    });

    test('all interactions allowed when config is undefined', () => {
      const context: InteractionAuthContext = {
        userId: 'user-1',
        guildId: 'guild-1',
        userRoleIds: ['some-role'],
      };

      const result = checkInteractionAuth(context, undefined);
      expect(result.allowed).toBe(true);
    });
  });

  describe('role-based authorization', () => {
    test('user with allowed role is authorized', () => {
      const context: InteractionAuthContext = {
        userId: 'user-1',
        guildId: 'guild-1',
        userRoleIds: ['role-admin', 'role-member'],
      };

      const config: InteractionAuthConfig = {
        allowedRoleIds: ['role-admin'],
      };

      const result = checkInteractionAuth(context, config);
      expect(result.allowed).toBe(true);
    });

    test('user without allowed role is denied', () => {
      const context: InteractionAuthContext = {
        userId: 'user-1',
        guildId: 'guild-1',
        userRoleIds: ['role-member'],
      };

      const config: InteractionAuthConfig = {
        allowedRoleIds: ['role-admin'],
      };

      const result = checkInteractionAuth(context, config);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("don't have permission");
    });

    test('user with no roles is denied when roles are required', () => {
      const context: InteractionAuthContext = {
        userId: 'user-1',
        guildId: 'guild-1',
        userRoleIds: [],
      };

      const config: InteractionAuthConfig = {
        allowedRoleIds: ['role-admin'],
      };

      const result = checkInteractionAuth(context, config);
      expect(result.allowed).toBe(false);
    });
  });

  describe('per-guild config', () => {
    test('per-guild config takes precedence over instance config', () => {
      const context: InteractionAuthContext = {
        userId: 'user-1',
        guildId: 'guild-1',
        userRoleIds: ['role-guild-mod'],
      };

      const config: InteractionAuthConfig = {
        allowedRoleIds: ['role-admin'], // instance-level: would deny
        guilds: {
          'guild-1': {
            allowedRoleIds: ['role-guild-mod'], // guild-level: allows
          },
        },
      };

      const result = checkInteractionAuth(context, config);
      expect(result.allowed).toBe(true);
    });

    test('falls back to instance config when no guild config', () => {
      const context: InteractionAuthContext = {
        userId: 'user-1',
        guildId: 'guild-2', // no specific config for this guild
        userRoleIds: ['role-admin'],
      };

      const config: InteractionAuthConfig = {
        allowedRoleIds: ['role-admin'],
        guilds: {
          'guild-1': {
            allowedRoleIds: ['role-guild-mod'],
          },
        },
      };

      const result = checkInteractionAuth(context, config);
      expect(result.allowed).toBe(true);
    });
  });

  describe('empty allowlist', () => {
    test('empty allowlist allows all users', () => {
      const context: InteractionAuthContext = {
        userId: 'user-1',
        guildId: 'guild-1',
        userRoleIds: [],
      };

      const config: InteractionAuthConfig = {
        allowedRoleIds: [],
      };

      const result = checkInteractionAuth(context, config);
      expect(result.allowed).toBe(true);
    });

    test('config without allowedRoleIds allows all', () => {
      const context: InteractionAuthContext = {
        userId: 'user-1',
        guildId: 'guild-1',
        userRoleIds: [],
      };

      const config: InteractionAuthConfig = {};

      const result = checkInteractionAuth(context, config);
      expect(result.allowed).toBe(true);
    });
  });

  describe('edge cases', () => {
    test('multiple allowed roles — any match grants access', () => {
      const context: InteractionAuthContext = {
        userId: 'user-1',
        guildId: 'guild-1',
        userRoleIds: ['role-vip'],
      };

      const config: InteractionAuthConfig = {
        allowedRoleIds: ['role-admin', 'role-mod', 'role-vip'],
      };

      const result = checkInteractionAuth(context, config);
      expect(result.allowed).toBe(true);
    });

    test('user with multiple roles — checks all against allowlist', () => {
      const context: InteractionAuthContext = {
        userId: 'user-1',
        guildId: 'guild-1',
        userRoleIds: ['role-a', 'role-b', 'role-c'],
      };

      const config: InteractionAuthConfig = {
        allowedRoleIds: ['role-c'],
      };

      const result = checkInteractionAuth(context, config);
      expect(result.allowed).toBe(true);
    });
  });
});
