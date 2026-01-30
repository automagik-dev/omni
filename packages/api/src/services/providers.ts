/**
 * Provider service - manages agent providers
 */

import { NotFoundError } from '@omni/core';
import type { Database } from '@omni/db';
import { type AgentProvider, type NewAgentProvider, agentProviders } from '@omni/db';
import { eq } from 'drizzle-orm';

export interface ProviderHealthResult {
  healthy: boolean;
  latency: number;
  error?: string;
}

export class ProviderService {
  constructor(private db: Database) {}

  /**
   * List all providers
   */
  async list(options: { active?: boolean } = {}): Promise<AgentProvider[]> {
    let query = this.db.select().from(agentProviders).$dynamic();

    if (options.active !== undefined) {
      query = query.where(eq(agentProviders.isActive, options.active));
    }

    return query.orderBy(agentProviders.name);
  }

  /**
   * Get provider by ID
   */
  async getById(id: string): Promise<AgentProvider> {
    const [result] = await this.db.select().from(agentProviders).where(eq(agentProviders.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('AgentProvider', id);
    }

    return result;
  }

  /**
   * Get provider by name
   */
  async getByName(name: string): Promise<AgentProvider> {
    const [result] = await this.db.select().from(agentProviders).where(eq(agentProviders.name, name)).limit(1);

    if (!result) {
      throw new NotFoundError('AgentProvider', name);
    }

    return result;
  }

  /**
   * Create a new provider
   */
  async create(data: NewAgentProvider): Promise<AgentProvider> {
    const [created] = await this.db.insert(agentProviders).values(data).returning();

    if (!created) {
      throw new Error('Failed to create agent provider');
    }

    return created;
  }

  /**
   * Update a provider
   */
  async update(id: string, data: Partial<NewAgentProvider>): Promise<AgentProvider> {
    const [updated] = await this.db
      .update(agentProviders)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(agentProviders.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('AgentProvider', id);
    }

    return updated;
  }

  /**
   * Delete a provider
   */
  async delete(id: string): Promise<void> {
    const result = await this.db.delete(agentProviders).where(eq(agentProviders.id, id)).returning();

    if (!result.length) {
      throw new NotFoundError('AgentProvider', id);
    }
  }

  /**
   * Health check a provider
   */
  async checkHealth(id: string): Promise<ProviderHealthResult> {
    const provider = await this.getById(id);

    const start = Date.now();

    try {
      // Try to reach the provider's health endpoint
      const healthUrl = new URL('/health', provider.baseUrl).toString();
      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
        signal: AbortSignal.timeout(5000),
      });

      const latency = Date.now() - start;
      const healthy = response.ok;

      // Update provider health status
      await this.db
        .update(agentProviders)
        .set({
          lastHealthCheck: new Date(),
          lastHealthStatus: healthy ? 'healthy' : 'unhealthy',
          lastHealthError: healthy ? null : `HTTP ${response.status}`,
          updatedAt: new Date(),
        })
        .where(eq(agentProviders.id, id));

      return {
        healthy,
        latency,
        error: healthy ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      const latency = Date.now() - start;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Update provider health status
      await this.db
        .update(agentProviders)
        .set({
          lastHealthCheck: new Date(),
          lastHealthStatus: 'error',
          lastHealthError: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(agentProviders.id, id));

      return {
        healthy: false,
        latency,
        error: errorMessage,
      };
    }
  }
}
