/**
 * Runtime config tests — pin the contract for the two operator-facing env vars
 * documented in `.env.example`:
 *
 *   - `TEAMS_REQUEST_TIMEOUT_MS`  → bounds AAD + Bot Framework REST calls
 *   - `TEAMS_DOWNLOAD_MAX_BYTES` → bounds inbound attachment downloads
 *
 * These tests would have caught the dead-config defect Cezar flagged on PR
 * #543: previously these vars were documented but `process.env` was never
 * read, so operators setting them got silent no-ops.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { DEFAULT_TEAMS_REQUEST_TIMEOUT_MS, resolveRequestTimeoutMs } from '../connection/auth';
import { DEFAULT_TEAMS_DOWNLOAD_MAX_BYTES, resolveDownloadMaxBytes } from '../plugin';

describe('TEAMS_REQUEST_TIMEOUT_MS', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.TEAMS_REQUEST_TIMEOUT_MS;
    Reflect.deleteProperty(process.env, 'TEAMS_REQUEST_TIMEOUT_MS');
  });
  afterEach(() => {
    if (saved === undefined) {
      Reflect.deleteProperty(process.env, 'TEAMS_REQUEST_TIMEOUT_MS');
    } else {
      process.env.TEAMS_REQUEST_TIMEOUT_MS = saved;
    }
  });

  it('defaults to 15 seconds when unset', () => {
    expect(resolveRequestTimeoutMs()).toBe(DEFAULT_TEAMS_REQUEST_TIMEOUT_MS);
    expect(DEFAULT_TEAMS_REQUEST_TIMEOUT_MS).toBe(15_000);
  });

  it('honours a numeric env override', () => {
    process.env.TEAMS_REQUEST_TIMEOUT_MS = '5000';
    expect(resolveRequestTimeoutMs()).toBe(5000);
  });

  it('falls back to default on non-numeric value', () => {
    process.env.TEAMS_REQUEST_TIMEOUT_MS = 'banana';
    expect(resolveRequestTimeoutMs()).toBe(DEFAULT_TEAMS_REQUEST_TIMEOUT_MS);
  });

  it('falls back to default on zero or negative value', () => {
    process.env.TEAMS_REQUEST_TIMEOUT_MS = '0';
    expect(resolveRequestTimeoutMs()).toBe(DEFAULT_TEAMS_REQUEST_TIMEOUT_MS);
    process.env.TEAMS_REQUEST_TIMEOUT_MS = '-1';
    expect(resolveRequestTimeoutMs()).toBe(DEFAULT_TEAMS_REQUEST_TIMEOUT_MS);
  });
});

describe('TEAMS_DOWNLOAD_MAX_BYTES', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.TEAMS_DOWNLOAD_MAX_BYTES;
    Reflect.deleteProperty(process.env, 'TEAMS_DOWNLOAD_MAX_BYTES');
  });
  afterEach(() => {
    if (saved === undefined) {
      Reflect.deleteProperty(process.env, 'TEAMS_DOWNLOAD_MAX_BYTES');
    } else {
      process.env.TEAMS_DOWNLOAD_MAX_BYTES = saved;
    }
  });

  it('defaults to 100 MiB when unset', () => {
    expect(resolveDownloadMaxBytes()).toBe(DEFAULT_TEAMS_DOWNLOAD_MAX_BYTES);
    expect(DEFAULT_TEAMS_DOWNLOAD_MAX_BYTES).toBe(100 * 1024 * 1024);
  });

  it('honours a numeric env override', () => {
    process.env.TEAMS_DOWNLOAD_MAX_BYTES = '52428800';
    expect(resolveDownloadMaxBytes()).toBe(52428800);
  });

  it('falls back to default on non-numeric value', () => {
    process.env.TEAMS_DOWNLOAD_MAX_BYTES = 'unlimited';
    expect(resolveDownloadMaxBytes()).toBe(DEFAULT_TEAMS_DOWNLOAD_MAX_BYTES);
  });

  it('falls back to default on zero or negative value', () => {
    process.env.TEAMS_DOWNLOAD_MAX_BYTES = '0';
    expect(resolveDownloadMaxBytes()).toBe(DEFAULT_TEAMS_DOWNLOAD_MAX_BYTES);
    process.env.TEAMS_DOWNLOAD_MAX_BYTES = '-100';
    expect(resolveDownloadMaxBytes()).toBe(DEFAULT_TEAMS_DOWNLOAD_MAX_BYTES);
  });
});
