/**
 * ClickUp API v2 client.
 *
 * Plain HTTP against `https://api.clickup.com/api/v2`; `fetch`, `baseUrl` and
 * `timeoutMs` are injectable so tests never touch the network. Auth is
 * ClickUp's raw token in `Authorization` — v2 does NOT use a `Bearer` prefix.
 *
 * The token is never logged or echoed: `redact()` scrubs it out of any
 * ClickUp-supplied text before an error leaves this module. Every response body
 * is Zod-validated at the boundary.
 */

import { ClickUpApiError, ClickUpError } from './errors';
import {
  CLICKUP_DEFAULT_BASE_URL,
  type ClickUpApiComment,
  type ClickUpApiTask,
  ClickUpCommentResponseSchema,
  ClickUpTaskResponseSchema,
  ClickUpTasksResponseSchema,
  type ClickUpTeam,
  ClickUpTeamsResponseSchema,
} from './types';

const DEFAULT_TIMEOUT_MS = 30_000;
/** ClickUp error text is diagnostic, not a payload — keep it short. */
const MAX_ERROR_TEXT = 300;

export interface ClickUpClientOptions {
  /** Per-user ClickUp personal API token. */
  token: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Defaults to `https://api.clickup.com/api/v2`. */
  baseUrl?: string;
  /** Per-request timeout; defaults to 30s. */
  timeoutMs?: number;
}

interface ClickUpRequest {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  body?: unknown;
  operation: string;
}

export class ClickUpApiClient {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: ClickUpClientOptions) {
    this.token = options.token;
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? CLICKUP_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** GET /team — validates the token and returns the teams it can reach. */
  async getTeams(): Promise<ClickUpTeam[]> {
    const res = await this.request({ method: 'GET', path: '/team', operation: 'GET /team' });
    const parsed = ClickUpTeamsResponseSchema.safeParse(await this.readJson(res, 'GET /team'));
    if (!parsed.success) throw this.invalidResponse(res, 'GET /team', parsed.error.message);
    return parsed.data.teams;
  }

  /** POST /list/{listId}/task */
  async createTask(listId: string, body: Record<string, unknown>): Promise<ClickUpApiTask> {
    const path = `/list/${encodeURIComponent(listId)}/task`;
    const operation = `POST ${path}`;
    const res = await this.request({ method: 'POST', path, body, operation });
    const parsed = ClickUpTaskResponseSchema.safeParse(await this.readJson(res, operation));
    if (!parsed.success) throw this.invalidResponse(res, operation, parsed.error.message);
    return parsed.data;
  }

  /** PUT /task/{taskId} — ClickUp updates fields and moves status with PUT. */
  async updateTask(taskId: string, body: Record<string, unknown>): Promise<ClickUpApiTask> {
    const path = `/task/${encodeURIComponent(taskId)}`;
    const operation = `PUT ${path}`;
    const res = await this.request({ method: 'PUT', path, body, operation });
    const parsed = ClickUpTaskResponseSchema.safeParse(await this.readJson(res, operation));
    if (!parsed.success) throw this.invalidResponse(res, operation, parsed.error.message);
    return parsed.data;
  }

  /** POST /task/{taskId}/comment */
  async addComment(taskId: string, body: Record<string, unknown>): Promise<ClickUpApiComment> {
    const path = `/task/${encodeURIComponent(taskId)}/comment`;
    const operation = `POST ${path}`;
    const res = await this.request({ method: 'POST', path, body, operation });
    const parsed = ClickUpCommentResponseSchema.safeParse(await this.readJson(res, operation));
    if (!parsed.success) throw this.invalidResponse(res, operation, parsed.error.message);
    return parsed.data;
  }

  /** GET /list/{listId}/task — open tasks only, subtasks excluded. */
  async listTasks(listId: string): Promise<ClickUpApiTask[]> {
    const path = `/list/${encodeURIComponent(listId)}/task?archived=false&subtasks=false`;
    const operation = `GET ${path}`;
    const res = await this.request({ method: 'GET', path, operation });
    const parsed = ClickUpTasksResponseSchema.safeParse(await this.readJson(res, operation));
    if (!parsed.success) throw this.invalidResponse(res, operation, parsed.error.message);
    return parsed.data.tasks;
  }

  private async request({ method, path, body, operation }: ClickUpRequest): Promise<Response> {
    const headers: Record<string, string> = {
      // ClickUp v2: the raw personal token, NOT `Bearer <token>`.
      Authorization: this.token,
      'Content-Type': 'application/json',
    };

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      const message = timedOut
        ? `ClickUp did not respond to ${operation} within ${this.timeoutMs}ms`
        : `Could not reach ClickUp for ${operation}: ${this.redact(
            error instanceof Error ? error.message : String(error),
          )}`;
      throw new ClickUpError('NETWORK_ERROR', message, { cause: error });
    }

    if (!res.ok) throw await this.errorFromResponse(res, operation);
    return res;
  }

  private async readJson(res: Response, operation: string): Promise<unknown> {
    const text = await res.text();
    if (text.length === 0) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new ClickUpApiError(res.status, `ClickUp returned a non-JSON response to ${operation}`);
    }
  }

  private invalidResponse(res: Response, operation: string, detail: string): ClickUpApiError {
    return new ClickUpApiError(
      res.status,
      `ClickUp returned an unexpected response to ${operation}: ${this.redact(detail).slice(0, MAX_ERROR_TEXT)}`,
    );
  }

  /**
   * Turn a non-2xx response into a readable error carrying ClickUp's own
   * `err`/`ECODE`, with the token redacted and the detail truncated.
   */
  private async errorFromResponse(res: Response, operation: string): Promise<ClickUpApiError> {
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      /* body unreadable — the status alone still explains the failure */
    }

    let detail = bodyText;
    let clickupCode: string | undefined;
    try {
      const parsed = JSON.parse(bodyText) as { err?: unknown; ECODE?: unknown };
      if (typeof parsed.err === 'string') detail = parsed.err;
      if (typeof parsed.ECODE === 'string') clickupCode = parsed.ECODE;
    } catch {
      /* not JSON — keep the raw text as the detail */
    }

    detail = this.redact(detail).replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_TEXT);
    const suffix = clickupCode ? ` (${clickupCode})` : '';
    const message =
      res.status === 401
        ? `ClickUp rejected this API token (401): ${detail || 'unauthorized'}${suffix}`
        : `ClickUp API error (${res.status}) from ${operation}: ${detail || 'no error text'}${suffix}`;

    return new ClickUpApiError(res.status, message, clickupCode);
  }

  private redact(text: string): string {
    return this.token.length > 0 ? text.split(this.token).join('[redacted]') : text;
  }
}
