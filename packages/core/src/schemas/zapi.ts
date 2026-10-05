import { z } from 'zod';

const identifier = z.string().min(1).max(255);
const secret = z.string().min(16).max(4096);
export const ZapiWebConfigSchema = z
  .object({
    driver: z.literal('web'),
    instanceId: identifier,
    instanceToken: secret,
    clientToken: secret,
    webhookToken: z.string().min(32).max(255),
  })
  .strict();
export const ZapiOmniConfigSchema = z
  .object({
    driver: z.literal('omni'),
    channelId: identifier,
    secretKey: secret,
    signingSecret: secret,
  })
  .strict();
export const ZapiConfigSchema = z.discriminatedUnion('driver', [ZapiWebConfigSchema, ZapiOmniConfigSchema]);
export type ZapiConfig = z.infer<typeof ZapiConfigSchema>;
