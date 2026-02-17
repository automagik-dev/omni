/**
 * Interaction authorization checker
 *
 * Checks user guild roles against a configurable allowlist before
 * processing component interactions. Supports per-guild configuration.
 *
 * Default behavior: allow all interactions (backward compatible).
 * When configured, only users with matching roles can interact.
 *
 * DM interactions are always allowed (no guild context).
 */

import { createLogger } from '@omni/core';

const log = createLogger('discord:interaction-auth');

/**
 * Per-guild authorization configuration
 */
export interface GuildAuthConfig {
  /** Role IDs allowed to interact with components */
  allowedRoleIds: string[];
}

/**
 * Authorization configuration for interaction checking
 */
export interface InteractionAuthConfig {
  /** Per-guild authorization rules. Key = guildId */
  guilds?: Record<string, GuildAuthConfig>;
  /** Instance-level fallback: allowed role IDs (used when no per-guild config) */
  allowedRoleIds?: string[];
}

/**
 * Context for an interaction authorization check
 */
export interface InteractionAuthContext {
  /** User who triggered the interaction */
  userId: string;
  /** Guild ID (undefined for DM interactions) */
  guildId?: string;
  /** User's role IDs in the guild */
  userRoleIds: string[];
}

/**
 * Result of an authorization check
 */
export interface AuthResult {
  /** Whether the interaction is authorized */
  allowed: boolean;
  /** Reason for the decision */
  reason: string;
}

/**
 * Check if a user is authorized to use a component interaction.
 *
 * Authorization logic:
 * 1. DM interactions → always allowed (no guild context)
 * 2. No config → always allowed (backward compatible)
 * 3. Per-guild config exists → check user roles against guild allowlist
 * 4. Instance-level config exists → check user roles against instance allowlist
 * 5. Config exists but allowlist is empty → allow all
 *
 * @param context - Interaction context (user, guild, roles)
 * @param config - Authorization configuration (optional)
 * @returns Authorization result
 */
export function checkInteractionAuth(context: InteractionAuthContext, config?: InteractionAuthConfig): AuthResult {
  // DM interactions are always allowed
  if (!context.guildId) {
    log.debug('Auth check: DM interaction, allowing', { userId: context.userId });
    return { allowed: true, reason: 'DM interactions are always allowed' };
  }

  // No config → allow all (backward compatible)
  if (!config) {
    log.debug('Auth check: no config, allowing', { userId: context.userId, guildId: context.guildId });
    return { allowed: true, reason: 'No authorization config set' };
  }

  // Check per-guild config first
  const guildConfig = config.guilds?.[context.guildId];
  const allowedRoleIds = guildConfig?.allowedRoleIds ?? config.allowedRoleIds;

  // No allowlist configured → allow all
  if (!allowedRoleIds || allowedRoleIds.length === 0) {
    log.debug('Auth check: empty allowlist, allowing', {
      userId: context.userId,
      guildId: context.guildId,
    });
    return { allowed: true, reason: 'No role restrictions configured' };
  }

  // Check if user has any allowed role
  const hasAllowedRole = context.userRoleIds.some((roleId) => allowedRoleIds.includes(roleId));

  log.debug('Auth check result', {
    userId: context.userId,
    guildId: context.guildId,
    userRoles: context.userRoleIds,
    allowedRoles: allowedRoleIds,
    allowed: hasAllowedRole,
  });

  if (hasAllowedRole) {
    return { allowed: true, reason: 'User has an allowed role' };
  }

  return { allowed: false, reason: "You don't have permission to use this" };
}
