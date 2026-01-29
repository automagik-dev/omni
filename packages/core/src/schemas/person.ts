/**
 * Person and identity schemas
 */

import { z } from 'zod';
import { ChannelTypeSchema, EmailSchema, MetadataSchema, PhoneSchema, UuidSchema } from './common';

/**
 * Person schema (identity graph root)
 */
export const PersonSchema = z.object({
  id: UuidSchema,
  displayName: z.string().max(255).nullable(),
  primaryPhone: PhoneSchema.nullable(),
  primaryEmail: EmailSchema.nullable(),
  avatarUrl: z.string().url().nullable(),
  metadata: MetadataSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Person = z.infer<typeof PersonSchema>;

/**
 * Create person input
 */
export const CreatePersonSchema = z.object({
  displayName: z.string().max(255).optional(),
  primaryPhone: PhoneSchema.optional(),
  primaryEmail: EmailSchema.optional(),
  avatarUrl: z.string().url().optional(),
  metadata: MetadataSchema.optional(),
});

export type CreatePersonInput = z.infer<typeof CreatePersonSchema>;

/**
 * Update person input
 */
export const UpdatePersonSchema = CreatePersonSchema.partial();

export type UpdatePersonInput = z.infer<typeof UpdatePersonSchema>;

/**
 * Platform identity schema
 */
export const PlatformIdentitySchema = z.object({
  id: UuidSchema,
  personId: UuidSchema.nullable(),
  channel: ChannelTypeSchema,
  instanceId: UuidSchema.nullable(),
  platformUserId: z.string().max(255),
  platformUsername: z.string().max(255).nullable(),
  profilePicUrl: z.string().url().nullable(),
  profileData: MetadataSchema.nullable(),
  messageCount: z.number().int().min(0),
  lastSeenAt: z.date().nullable(),
  firstSeenAt: z.date(),
  linkedBy: z.enum(['auto', 'manual', 'phone_match', 'initial']).nullable(),
  confidence: z.number().int().min(0).max(100),
  linkReason: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type PlatformIdentity = z.infer<typeof PlatformIdentitySchema>;

/**
 * Create platform identity input
 */
export const CreatePlatformIdentitySchema = z.object({
  personId: UuidSchema.optional(),
  channel: ChannelTypeSchema,
  instanceId: UuidSchema.optional(),
  platformUserId: z.string().max(255),
  platformUsername: z.string().max(255).optional(),
  profilePicUrl: z.string().url().optional(),
  profileData: MetadataSchema.optional(),
});

export type CreatePlatformIdentityInput = z.infer<typeof CreatePlatformIdentitySchema>;

/**
 * Link identity to person input
 */
export const LinkIdentitySchema = z.object({
  platformIdentityId: UuidSchema,
  personId: UuidSchema,
  linkedBy: z.enum(['auto', 'manual', 'phone_match']),
  confidence: z.number().int().min(0).max(100).default(100),
  linkReason: z.string().optional(),
});

export type LinkIdentityInput = z.infer<typeof LinkIdentitySchema>;

/**
 * Person with identities (expanded view)
 */
export const PersonWithIdentitiesSchema = PersonSchema.extend({
  identities: z.array(PlatformIdentitySchema),
});

export type PersonWithIdentities = z.infer<typeof PersonWithIdentitiesSchema>;
