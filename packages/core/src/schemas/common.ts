/**
 * Common Zod schemas used across the application
 */

import { z } from 'zod';
import { PROVIDER_SCHEMAS } from '../types/agent';

/**
 * UUID schema
 */
export const UuidSchema = z.string().uuid();

/**
 * Timestamp (Unix milliseconds)
 */
export const TimestampSchema = z.number().int().positive();

/**
 * ISO date string
 */
export const IsoDateSchema = z.string().datetime();

/**
 * E.164 phone number format
 */
export const PhoneSchema = z.string().regex(/^\+[1-9]\d{1,14}$/, 'Invalid E.164 phone number');

/**
 * Email schema
 */
export const EmailSchema = z.string().email();

/**
 * URL schema
 */
export const UrlSchema = z.string().url();

/**
 * Non-empty string
 */
export const NonEmptyStringSchema = z.string().min(1);

/**
 * Pagination parameters
 */
export const PaginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export type Pagination = z.infer<typeof PaginationSchema>;

/**
 * Paginated response wrapper
 */
export const paginatedResponse = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number().int().min(0),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
    hasMore: z.boolean(),
  });

/**
 * Generic metadata schema (JSON object)
 */
export const MetadataSchema = z.record(z.string(), z.unknown());

/**
 * Channel type enum
 */
export const ChannelTypeSchema = z.enum(['whatsapp-baileys', 'whatsapp-cloud', 'discord', 'slack', 'telegram']);

/**
 * Content type enum
 */
export const ContentTypeSchema = z.enum([
  'text',
  'audio',
  'image',
  'video',
  'document',
  'sticker',
  'contact',
  'location',
  'reaction',
]);

/**
 * Event type enum
 */
export const EventTypeSchema = z.enum([
  'message.received',
  'message.sent',
  'message.delivered',
  'message.read',
  'message.failed',
  'media.received',
  'media.processed',
  'identity.created',
  'identity.linked',
  'identity.unlinked',
  'instance.connected',
  'instance.disconnected',
  'access.allowed',
  'access.denied',
]);

/**
 * Job status enum
 */
export const JobStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']);

/**
 * Provider schema enum — derived from PROVIDER_SCHEMAS (single source of truth)
 * @see DEC-12: packages/core/src/types/agent.ts is the canonical list
 */
export const ProviderSchemaEnum = z.enum(PROVIDER_SCHEMAS);

/**
 * Rule type enum
 */
export const RuleTypeSchema = z.enum(['allow', 'deny']);

/**
 * Access mode enum - controls how access rules are evaluated
 * - disabled: No access control, all users allowed
 * - blocklist: Default allow, deny matching rules (default)
 * - allowlist: Default deny, allow matching rules
 */
export const AccessModeSchema = z.enum(['disabled', 'blocklist', 'allowlist']);

/**
 * Setting value type enum
 */
export const SettingValueTypeSchema = z.enum(['string', 'integer', 'boolean', 'json', 'secret']);
