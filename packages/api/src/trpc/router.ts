/**
 * tRPC Router
 *
 * Type-safe API for SDK and internal use.
 */

import { ChannelTypeSchema, ContentTypeSchema, EventTypeSchema, ProviderSchemaEnum, RuleTypeSchema } from '@omni/core';
import { TRPCError, initTRPC } from '@trpc/server';
import { z } from 'zod';
import type { TrpcContext } from './context';

// Initialize tRPC
const t = initTRPC.context<TrpcContext>().create();

// Middleware for auth
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.apiKey) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'API key required' });
  }
  return next({ ctx: { ...ctx, apiKey: ctx.apiKey } });
});

// Procedures
const _publicProcedure = t.procedure;
const protectedProcedure = t.procedure.use(isAuthed);

// Helper to check scope
const hasScope = (scopes: string[], required: string): boolean => {
  if (scopes.includes('*')) return true;
  if (scopes.includes(required)) return true;
  const [namespace] = required.split(':');
  return scopes.includes(`${namespace}:*`);
};

// ============================================================================
// ROUTER
// ============================================================================

export const appRouter = t.router({
  // --------------------------------------------------------------------------
  // INSTANCES
  // --------------------------------------------------------------------------
  instances: t.router({
    list: protectedProcedure
      .input(
        z.object({
          channel: z.array(ChannelTypeSchema).optional(),
          status: z.array(z.enum(['active', 'inactive'])).optional(),
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.string().optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        return ctx.services.instances.list(input);
      }),

    get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
      return ctx.services.instances.getById(input.id);
    }),

    getByName: protectedProcedure.input(z.object({ name: z.string() })).query(async ({ ctx, input }) => {
      return ctx.services.instances.getByName(input.name);
    }),

    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1).max(255),
          channel: ChannelTypeSchema,
          agentProviderId: z.string().uuid().optional(),
          agentId: z.string().max(255).default('default'),
          agentTimeout: z.number().int().positive().default(60),
          agentStreamMode: z.boolean().default(false),
          isDefault: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!hasScope(ctx.apiKey.scopes, 'instances:write')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
        }
        return ctx.services.instances.create(input);
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          data: z.object({
            name: z.string().min(1).max(255).optional(),
            agentProviderId: z.string().uuid().optional(),
            agentId: z.string().max(255).optional(),
            agentTimeout: z.number().int().positive().optional(),
            agentStreamMode: z.boolean().optional(),
            isDefault: z.boolean().optional(),
          }),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!hasScope(ctx.apiKey.scopes, 'instances:write')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
        }
        return ctx.services.instances.update(input.id, input.data);
      }),

    delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      if (!hasScope(ctx.apiKey.scopes, 'instances:delete')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
      }
      await ctx.services.instances.delete(input.id);
      return { success: true };
    }),
  }),

  // --------------------------------------------------------------------------
  // EVENTS
  // --------------------------------------------------------------------------
  events: t.router({
    list: protectedProcedure
      .input(
        z.object({
          channel: z.array(ChannelTypeSchema).optional(),
          instanceId: z.string().uuid().optional(),
          personId: z.string().uuid().optional(),
          eventType: z.array(EventTypeSchema).optional(),
          contentType: z.array(ContentTypeSchema).optional(),
          direction: z.enum(['inbound', 'outbound']).optional(),
          since: z.date().optional(),
          until: z.date().optional(),
          search: z.string().optional(),
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.string().optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        return ctx.services.events.list(input);
      }),

    get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
      return ctx.services.events.getById(input.id);
    }),

    timeline: protectedProcedure
      .input(
        z.object({
          personId: z.string().uuid(),
          channels: z.array(ChannelTypeSchema).optional(),
          since: z.date().optional(),
          until: z.date().optional(),
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.string().optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        return ctx.services.events.getTimeline(input.personId, input);
      }),

    analytics: protectedProcedure
      .input(
        z.object({
          since: z.date().optional(),
          until: z.date().optional(),
          instanceId: z.string().uuid().optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        return ctx.services.events.getAnalytics(input);
      }),
  }),

  // --------------------------------------------------------------------------
  // PERSONS
  // --------------------------------------------------------------------------
  persons: t.router({
    search: protectedProcedure
      .input(
        z.object({
          query: z.string().min(1),
          limit: z.number().int().min(1).max(100).default(20),
        }),
      )
      .query(async ({ ctx, input }) => {
        return ctx.services.persons.search(input.query, input.limit);
      }),

    get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
      return ctx.services.persons.getById(input.id);
    }),

    presence: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
      return ctx.services.persons.getPresence(input.id);
    }),

    link: protectedProcedure
      .input(
        z.object({
          identityA: z.string().uuid(),
          identityB: z.string().uuid(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!hasScope(ctx.apiKey.scopes, 'persons:*')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
        }
        return ctx.services.persons.linkIdentities(input.identityA, input.identityB);
      }),

    unlink: protectedProcedure
      .input(
        z.object({
          identityId: z.string().uuid(),
          reason: z.string().min(1),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!hasScope(ctx.apiKey.scopes, 'persons:*')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
        }
        return ctx.services.persons.unlinkIdentity(input.identityId, input.reason);
      }),
  }),

  // --------------------------------------------------------------------------
  // ACCESS
  // --------------------------------------------------------------------------
  access: t.router({
    listRules: protectedProcedure
      .input(
        z.object({
          instanceId: z.string().uuid().optional(),
          type: RuleTypeSchema.optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        return ctx.services.access.list(input);
      }),

    getRule: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
      return ctx.services.access.getById(input.id);
    }),

    createRule: protectedProcedure
      .input(
        z.object({
          instanceId: z.string().uuid().optional().nullable(),
          ruleType: RuleTypeSchema,
          phonePattern: z.string().optional(),
          platformUserId: z.string().optional(),
          personId: z.string().uuid().optional(),
          priority: z.number().int().default(0),
          enabled: z.boolean().default(true),
          reason: z.string().optional(),
          action: z.enum(['block', 'allow', 'silent_block']).default('block'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!hasScope(ctx.apiKey.scopes, 'access:*')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
        }
        return ctx.services.access.create(input);
      }),

    check: protectedProcedure
      .input(
        z.object({
          instanceId: z.string().uuid(),
          platformUserId: z.string(),
          channel: z.string(),
        }),
      )
      .query(async ({ ctx, input }) => {
        return ctx.services.access.checkAccess(input.instanceId, input.platformUserId, input.channel);
      }),
  }),

  // --------------------------------------------------------------------------
  // SETTINGS
  // --------------------------------------------------------------------------
  settings: t.router({
    list: protectedProcedure.input(z.object({ category: z.string().optional() })).query(async ({ ctx, input }) => {
      return ctx.services.settings.list(input.category);
    }),

    get: protectedProcedure.input(z.object({ key: z.string() })).query(async ({ ctx, input }) => {
      return ctx.services.settings.getByKey(input.key);
    }),

    getValue: protectedProcedure
      .input(
        z.object({
          key: z.string(),
          defaultValue: z.unknown().optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        return ctx.services.settings.getValue(input.key, input.defaultValue);
      }),

    set: protectedProcedure
      .input(
        z.object({
          key: z.string(),
          value: z.unknown(),
          reason: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!hasScope(ctx.apiKey.scopes, 'settings:*')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
        }
        return ctx.services.settings.setValue(input.key, input.value, {
          reason: input.reason,
          changedBy: ctx.apiKey.name,
        });
      }),
  }),

  // --------------------------------------------------------------------------
  // PROVIDERS
  // --------------------------------------------------------------------------
  providers: t.router({
    list: protectedProcedure.input(z.object({ active: z.boolean().optional() })).query(async ({ ctx, input }) => {
      return ctx.services.providers.list(input);
    }),

    get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
      return ctx.services.providers.getById(input.id);
    }),

    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1).max(255),
          schema: ProviderSchemaEnum.default('agnoos'),
          baseUrl: z.string().url(),
          apiKey: z.string().optional(),
          defaultStream: z.boolean().default(true),
          defaultTimeout: z.number().int().positive().default(60),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!hasScope(ctx.apiKey.scopes, 'admin:*')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
        }
        return ctx.services.providers.create(input);
      }),

    checkHealth: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      return ctx.services.providers.checkHealth(input.id);
    }),
  }),
});

// Export type
export type AppRouter = typeof appRouter;
