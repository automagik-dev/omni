import { z } from 'zod';

/** Shared approved-template descriptor; adapters translate it into vendor wire formats. */
export const OutboundTemplateSchema = z
  .object({
    name: z.string().min(1).max(512),
    language: z.string().min(2).max(32).default('pt_BR'),
    bodyParameters: z.array(z.string()).max(100).optional(),
    headerMedia: z
      .object({
        type: z.enum(['image', 'video', 'document']),
        link: z.string().url(),
        filename: z.string().optional(),
      })
      .strict()
      .optional(),
    buttonParameters: z
      .array(
        z
          .object({
            sub_type: z.enum(['quick_reply', 'url', 'copy_code']),
            index: z.number().int().min(0).max(9),
            payload: z.string().optional(),
            text: z.string().optional(),
          })
          .strict()
          .refine(
            (button) => (button.sub_type === 'url' ? Boolean(button.text) : Boolean(button.payload)),
            'Button requires text for URL or payload for reply/copy-code',
          ),
      )
      .max(10)
      .optional(),
  })
  .strict();
export type OutboundTemplate = z.infer<typeof OutboundTemplateSchema>;
