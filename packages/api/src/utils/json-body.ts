/**
 * Strict JSON-object body parsing for webhook receivers.
 *
 * Both webhook surfaces (the authenticated `POST /api/v2/webhooks/:source`
 * route and the auth-exempt `POST /api/v2/webhooks/ingress/:source`) publish
 * the body as the payload of a `custom.webhook.*` event. The contract is the
 * same on both: an empty body is `{}`; a non-empty body that is not a JSON
 * object (malformed JSON, an array, a scalar) is rejected — silently mapping
 * it to `{}` would fire automations on a hollow event.
 */

import { ValidationError } from '@omni/core';

const NOT_AN_OBJECT = 'Request body must be a JSON object';

/**
 * Parse `rawBody` as a JSON object.
 *
 * @throws {ValidationError} when the body is non-empty and not a JSON object.
 */
export function parseJsonObjectBody(rawBody: string): Record<string, unknown> {
  if (!rawBody) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new ValidationError(NOT_AN_OBJECT);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError(NOT_AN_OBJECT);
  }
  return parsed as Record<string, unknown>;
}
