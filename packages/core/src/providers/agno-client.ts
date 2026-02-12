/**
 * Agno API Client
 *
 * Implements the IAgentClient interface for running agents, teams, and workflows
 * with both sync and streaming support.
 */

import {
  type AgentDiscoveryEntry,
  type AgentHealthResult,
  type AgnoAgent,
  type AgnoClientConfig,
  type AgnoTeam,
  type AgnoWorkflow,
  type IAgentClient,
  ProviderError,
  type ProviderRequest,
  type ProviderResponse,
  type StreamChunk,
} from './types';

const DEFAULT_TIMEOUT_MS = 60_000;

export class AgnoClient implements IAgentClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultTimeoutMs: number;

  constructor(config: AgnoClientConfig) {
    // Normalize baseUrl - remove trailing slash
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderError('Request timed out', 'TIMEOUT', undefined, { timeoutMs });
      }
      throw new ProviderError(error instanceof Error ? error.message : 'Network error', 'NETWORK_ERROR');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private handleErrorResponse(response: Response, context: string): never {
    const statusCode = response.status;

    if (statusCode === 401) {
      throw new ProviderError(`Authentication failed: ${context}`, 'AUTHENTICATION_FAILED', 401);
    }
    if (statusCode === 404) {
      throw new ProviderError(`Not found: ${context}`, 'NOT_FOUND', 404);
    }
    if (statusCode === 429) {
      throw new ProviderError(`Rate limited: ${context}`, 'RATE_LIMITED', 429);
    }
    if (statusCode >= 500) {
      throw new ProviderError(`Server error: ${context}`, 'SERVER_ERROR', statusCode);
    }

    throw new ProviderError(`Request failed: ${context}`, 'SERVER_ERROR', statusCode);
  }

  // --- IAgentClient interface ---

  async run(request: ProviderRequest): Promise<ProviderResponse> {
    const endpoint = this.agentTypeToEndpoint(request.agentType);
    return this.runEndpoint(endpoint, request.agentId, request);
  }

  async *stream(request: ProviderRequest): AsyncGenerator<StreamChunk> {
    const endpoint = this.agentTypeToEndpoint(request.agentType);
    yield* this.streamEndpoint(endpoint, request.agentId, request);
  }

  async discover(): Promise<AgentDiscoveryEntry[]> {
    const [agents, teams, workflows] = await Promise.all([
      this.listAgents().catch(() => [] as AgnoAgent[]),
      this.listTeams().catch(() => [] as AgnoTeam[]),
      this.listWorkflows().catch(() => [] as AgnoWorkflow[]),
    ]);

    const entries: AgentDiscoveryEntry[] = [
      ...agents.map((a) => ({
        id: a.agent_id,
        name: a.name,
        type: 'agent' as const,
        description: a.description,
        metadata: a.model ? { model: a.model } : undefined,
      })),
      ...teams.map((t) => ({
        id: t.team_id,
        name: t.name,
        type: 'team' as const,
        description: t.description,
        metadata: t.mode ? { mode: t.mode, memberCount: t.members?.length } : undefined,
      })),
      ...workflows.map((w) => ({
        id: w.workflow_id,
        name: w.name,
        type: 'workflow' as const,
        description: w.description,
      })),
    ];

    return entries;
  }

  private agentTypeToEndpoint(agentType?: string): 'agents' | 'teams' | 'workflows' {
    switch (agentType) {
      case 'team':
        return 'teams';
      case 'workflow':
        return 'workflows';
      default:
        return 'agents';
    }
  }

  // --- List Endpoints (used internally by discover()) ---

  async listAgents(): Promise<AgnoAgent[]> {
    const url = `${this.baseUrl}/agents`;
    const response = await this.fetchWithTimeout(
      url,
      { method: 'GET', headers: this.getHeaders() },
      this.defaultTimeoutMs,
    );

    if (!response.ok) {
      this.handleErrorResponse(response, 'listing agents');
    }

    const data = (await response.json()) as AgnoAgent[];
    return data;
  }

  async listTeams(): Promise<AgnoTeam[]> {
    const url = `${this.baseUrl}/teams`;
    const response = await this.fetchWithTimeout(
      url,
      { method: 'GET', headers: this.getHeaders() },
      this.defaultTimeoutMs,
    );

    if (!response.ok) {
      this.handleErrorResponse(response, 'listing teams');
    }

    const data = (await response.json()) as AgnoTeam[];
    return data;
  }

  async listWorkflows(): Promise<AgnoWorkflow[]> {
    const url = `${this.baseUrl}/workflows`;
    const response = await this.fetchWithTimeout(
      url,
      { method: 'GET', headers: this.getHeaders() },
      this.defaultTimeoutMs,
    );

    if (!response.ok) {
      this.handleErrorResponse(response, 'listing workflows');
    }

    const data = (await response.json()) as AgnoWorkflow[];
    return data;
  }

  // --- Run Endpoints ---

  private async buildFormData(request: ProviderRequest, stream: boolean): Promise<FormData> {
    const formData = new FormData();
    formData.append('message', request.message);
    formData.append('stream', String(stream));

    if (request.sessionId) {
      formData.append('session_id', request.sessionId);
    }
    if (request.userId) {
      formData.append('user_id', request.userId);
    }

    if (request.files?.length) {
      for (const file of request.files) {
        try {
          const fileData = await Bun.file(file.path).arrayBuffer();
          const blob = new Blob([fileData], { type: file.mimeType });
          formData.append('files', blob, file.filename ?? file.path.split('/').pop() ?? 'file');
        } catch {
          // Skip files that can't be read
        }
      }
    }

    return formData;
  }

  async runAgent(agentId: string, request: ProviderRequest): Promise<ProviderResponse> {
    return this.runEndpoint('agents', agentId, request);
  }

  async runTeam(teamId: string, request: ProviderRequest): Promise<ProviderResponse> {
    return this.runEndpoint('teams', teamId, request);
  }

  async runWorkflow(workflowId: string, request: ProviderRequest): Promise<ProviderResponse> {
    return this.runEndpoint('workflows', workflowId, request);
  }

  private async runEndpoint(
    endpoint: 'agents' | 'teams' | 'workflows',
    id: string,
    request: ProviderRequest,
  ): Promise<ProviderResponse> {
    const url = `${this.baseUrl}/${endpoint}/${id}/runs`;
    const formData = await this.buildFormData(request, false);
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;

    const response = await this.fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: formData,
      },
      timeoutMs,
    );

    if (!response.ok) {
      this.handleErrorResponse(response, `running ${endpoint}/${id}`);
    }

    const data = (await response.json()) as {
      run_id: string;
      agent_id?: string;
      team_id?: string;
      workflow_id?: string;
      session_id: string;
      content: string;
      status: 'COMPLETED' | 'FAILED';
      metrics?: {
        input_tokens?: number;
        output_tokens?: number;
        duration?: number;
      };
    };

    return {
      content: data.content,
      runId: data.run_id,
      sessionId: data.session_id,
      status: data.status === 'COMPLETED' ? 'completed' : 'failed',
      metrics: data.metrics
        ? {
            inputTokens: data.metrics.input_tokens ?? 0,
            outputTokens: data.metrics.output_tokens ?? 0,
            durationMs: data.metrics.duration ?? 0,
          }
        : undefined,
    };
  }

  // --- Streaming Endpoints ---

  async *streamAgent(agentId: string, request: ProviderRequest): AsyncGenerator<StreamChunk> {
    yield* this.streamEndpoint('agents', agentId, request);
  }

  async *streamTeam(teamId: string, request: ProviderRequest): AsyncGenerator<StreamChunk> {
    yield* this.streamEndpoint('teams', teamId, request);
  }

  async *streamWorkflow(workflowId: string, request: ProviderRequest): AsyncGenerator<StreamChunk> {
    yield* this.streamEndpoint('workflows', workflowId, request);
  }

  private async *streamEndpoint(
    endpoint: 'agents' | 'teams' | 'workflows',
    id: string,
    request: ProviderRequest,
  ): AsyncGenerator<StreamChunk> {
    const url = `${this.baseUrl}/${endpoint}/${id}/runs`;
    const formData = await this.buildFormData(request, true);
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;

    const response = await this.fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: formData,
      },
      timeoutMs,
    );

    if (!response.ok) {
      this.handleErrorResponse(response, `streaming ${endpoint}/${id}`);
    }

    if (!response.body) {
      throw new ProviderError('No response body for streaming', 'STREAM_ERROR');
    }

    yield* this.parseSSEStream(response.body as ReadableStream<Uint8Array>);
  }

  private async *parseSSEStream(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        const result = yield* this.processSSELines(lines);
        if (result?.isComplete) return;
      }
    } finally {
      reader.releaseLock();
    }
  }

  private *processSSELines(lines: string[]): Generator<StreamChunk, StreamChunk | undefined, undefined> {
    let currentEvent = '';
    let currentData = '';

    for (const line of lines) {
      const parsed = this.parseSSELine(line, currentEvent, currentData);
      currentEvent = parsed.event;
      currentData = parsed.data;

      if (parsed.chunk) {
        yield parsed.chunk;
        if (parsed.chunk.isComplete) {
          return parsed.chunk;
        }
      }
    }
    return undefined;
  }

  private parseSSELine(
    line: string,
    currentEvent: string,
    currentData: string,
  ): { event: string; data: string; chunk?: StreamChunk } {
    if (line.startsWith('event: ')) {
      return { event: line.slice(7).trim(), data: currentData };
    }
    if (line.startsWith('data: ')) {
      return { event: currentEvent, data: line.slice(6) };
    }
    if (line === '' && currentEvent && currentData) {
      const chunk = this.parseSSEEvent(currentEvent, currentData);
      return { event: '', data: '', chunk: chunk ?? undefined };
    }
    return { event: currentEvent, data: currentData };
  }

  private parseSSEEvent(event: string, data: string): StreamChunk | null {
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;

      switch (event) {
        case 'RunStarted':
          return {
            event,
            isComplete: false,
            runId: parsed.run_id as string | undefined,
            sessionId: parsed.session_id as string | undefined,
          };

        case 'RunResponse':
          return {
            event,
            content: parsed.content as string | undefined,
            isComplete: false,
          };

        case 'RunCompleted':
          return {
            event,
            isComplete: true,
            runId: parsed.run_id as string | undefined,
            fullContent: parsed.content as string | undefined,
          };

        case 'RunFailed':
        case 'RunError':
          throw new ProviderError((parsed.error as string) || 'Run failed', 'SERVER_ERROR', undefined, {
            event,
            data: parsed,
          });

        default:
          // Unknown event type - return as-is
          return {
            event,
            content: parsed.content as string | undefined,
            isComplete: false,
          };
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      // JSON parse error - skip malformed event
      return null;
    }
  }

  // --- Health Check ---

  async checkHealth(): Promise<AgentHealthResult> {
    const start = Date.now();

    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/health`,
        { method: 'GET', headers: this.getHeaders() },
        5000, // Short timeout for health check
      );

      const latencyMs = Date.now() - start;

      if (response.ok) {
        return { healthy: true, latencyMs };
      }

      return {
        healthy: false,
        latencyMs,
        error: `HTTP ${response.status}`,
      };
    } catch (error) {
      const latencyMs = Date.now() - start;
      return {
        healthy: false,
        latencyMs,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // --- Session Management ---

  async deleteSession(sessionId: string): Promise<void> {
    const url = `${this.baseUrl}/sessions/${encodeURIComponent(sessionId)}`;
    const response = await this.fetchWithTimeout(
      url,
      { method: 'DELETE', headers: this.getHeaders() },
      this.defaultTimeoutMs,
    );

    if (!response.ok) {
      this.handleErrorResponse(response, `deleting session ${sessionId}`);
    }
  }
}

/**
 * Create an Agno client instance
 */
export function createAgnoClient(config: AgnoClientConfig): IAgentClient {
  return new AgnoClient(config);
}
