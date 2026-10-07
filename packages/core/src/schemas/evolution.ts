import { z } from 'zod';

/** Origins must also be approved by the operator in OMNI_EVOLUTION_ALLOWED_ORIGINS. */
export const EvolutionConfigSchema = z
  .object({
    baseUrl: z
      .string()
      .url()
      .max(2048)
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          url.pathname === '/'
        );
      }, 'Evolution requires an HTTPS origin without credentials, path, query or fragment'),
    instanceName: z.string().min(1).max(255),
    apiKey: z.string().min(16).max(4096),
    webhookToken: z.string().min(32).max(255),
  })
  .strict();
export type EvolutionConfig = z.infer<typeof EvolutionConfigSchema>;
