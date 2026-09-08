/**
 * Microsoft Teams-specific types for the channel plugin.
 *
 * `MsTeamsConfigSchema` is the Zod boundary for the Azure Bot credentials —
 * `connect()` parses the merged `credentials`/`options` bag through it, so a
 * malformed or incomplete credential set fails the connect loudly instead of
 * producing an adapter that can never authenticate.
 */

import { z } from 'zod';

/** Azure Bot registration type (ConfigurationBotFrameworkAuthentication's MicrosoftAppType). */
export const MsTeamsAppTypeSchema = z.enum(['MultiTenant', 'SingleTenant', 'UserAssignedMsi']);
export type MsTeamsAppType = z.infer<typeof MsTeamsAppTypeSchema>;

export const MsTeamsConfigSchema = z
  .object({
    /** Entra ID application (client) id of the Azure Bot registration. */
    appId: z.string().default(''),
    /** Client secret of the Azure Bot registration. SECRET — never persisted or logged. */
    appPassword: z.string().default(''),
    /** Bot registration type. Azure defaults new registrations to single-tenant. */
    appType: MsTeamsAppTypeSchema.default('MultiTenant'),
    /** Entra tenant id — required by the Bot Framework for SingleTenant apps. */
    tenantId: z.string().min(1).optional(),
    /**
     * LOCAL DEVELOPMENT ONLY. Runs the CloudAdapter with empty credentials so
     * unauthenticated traffic from the Bot Framework Emulator / Teams App
     * Test Tool is accepted (their deliveries carry no JWT). With this flag
     * the webhook trusts ANY caller that knows the instance URL — never
     * enable it on an instance reachable from the internet.
     */
    allowAnonymous: z.boolean().default(false),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.allowAnonymous) return;
    if (!cfg.appId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['appId'],
        message: 'appId (Azure Bot application id) is required',
      });
    }
    if (!cfg.appPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['appPassword'],
        message: 'appPassword (Azure Bot client secret) is required',
      });
    }
  });

export type MsTeamsConfig = z.infer<typeof MsTeamsConfigSchema>;
