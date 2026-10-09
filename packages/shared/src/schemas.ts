import { z } from 'zod';
import { CONDUIT_ERROR_CODES } from './errors.js';
import { EXPOSED_TOOL_MAX_LENGTH, SERVER_SLUG_REGEX, parseExposedToolName } from './naming.js';

export const roleSchema = z.enum(['admin', 'member']);

export const authViaSchema = z.enum(['apikey', 'session']);

export const principalSourceSchema = z.enum(['mcp', 'chat']);

export const principalSchema = z.object({
  userId: z.string().min(1),
  role: roleSchema,
  via: authViaSchema,
  keyId: z.string().optional(),
  source: principalSourceSchema,
});

export const serverSlugSchema = z
  .string()
  .min(2)
  .max(31)
  .regex(
    SERVER_SLUG_REGEX,
    'Slug must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens',
  )
  .refine((slug) => !slug.includes('__'), "Slug cannot contain double underscores '__'");

export const exposedToolNameSchema = z
  .string()
  .min(3)
  .max(EXPOSED_TOOL_MAX_LENGTH)
  .refine(
    (name) => parseExposedToolName(name) !== null,
    "Exposed tool name must follow '<slug>__<tool>' format and be at most 64 characters",
  );

export const conduitErrorCodeSchema = z.enum(CONDUIT_ERROR_CODES);

export const apiErrorResponseSchema = z.object({
  code: conduitErrorCodeSchema,
  message: z.string(),
  requestId: z.string().optional(),
  statusCode: z.number().int(),
  fieldErrors: z.record(z.array(z.string())).optional(),
});
