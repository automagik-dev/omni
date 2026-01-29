/**
 * Core type exports
 */

export * from './channel';
export * from './agent';

/**
 * Common utility types
 */
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Pick<T, Exclude<keyof T, Keys>> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>;
  }[Keys];

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Result type for operations that can fail
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Setting value types (for global settings)
 */
export const SETTING_VALUE_TYPES = ['string', 'integer', 'boolean', 'json', 'secret'] as const;
export type SettingValueType = (typeof SETTING_VALUE_TYPES)[number];
