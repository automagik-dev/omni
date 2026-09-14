import { type ZodRawShape, z } from 'zod';

/**
 * A strict object for automation action configs (#1117): unknown keys are
 * rejected with a message naming them and the valid keys, instead of being
 * silently stripped (e.g. `payload` vs `payloadTemplate`).
 */
export function strictConfig<T extends ZodRawShape>(shape: T) {
  const valid = Object.keys(shape).join(', ');
  return z
    .object(shape, {
      errorMap: (issue, ctx) =>
        issue.code === 'unrecognized_keys'
          ? { message: `Unknown config key(s): ${issue.keys.join(', ')}. Valid keys: ${valid}` }
          : { message: ctx.defaultError },
    })
    .strict();
}
