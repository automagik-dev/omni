/**
 * Zod OpenAPI extension initialization
 *
 * This module must be imported BEFORE any other module that uses .openapi() on Zod schemas.
 * It extends Zod with the OpenAPI methods from @asteasolutions/zod-to-openapi.
 */

import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Extend Zod with OpenAPI support
extendZodWithOpenApi(z);

export { z };
