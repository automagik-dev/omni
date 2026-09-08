/**
 * Provider service - manages agent providers
 *
 * TENANT-BOUND SEALING OF PROVIDER CREDENTIALS (G5 deliverable (g); ADR-0008)
 * ---------------------------------------------------------------------------
 * `agent_providers` holds two kinds of secret: the bearer `api_key` used against
 * the provider's HTTP/WS endpoint, and — for the OpenClaw schema — the device
 * identity in `schema_config`, whose `devicePrivateKey` is a raw Ed25519 private
 * key and whose `deviceToken` is its bearer companion. ADR-0008 puts both in the
 * "channel/provider/webhook credentials" class that must be encrypted with
 * tenant-bound context.
 *
 * WHERE THE TENANT COMES FROM, AND WHY IT IS THE SCOPE
 * ----------------------------------------------------
 * Unlike `instances`, `agent_providers` is a G0-`split` table: it has no
 * `tenant_id`, because the tenant-configured half (`tenant_provider_config`) and
 * the immutable catalog half (`platform_provider_catalog`) have not been
 * separated yet (G2 `SPLIT_DESTINATIONS`). So there is no per-row ownership to
 * read, and the honest binding is the ACTIVE TENANT SCOPE: the tenant that
 * configured the credential is the tenant that can use it, and every other
 * context — including a worker that never established a scope — fails closed to
 * a null secret rather than to someone else's key.
 *
 * The `devicePublicKey`, `deviceId`, `origin` and every other `schema_config`
 * field stay in the clear: sealing is scoped to key material, so operators can
 * still read and diff a provider's configuration.
 *
 * DUAL WORLD. With no scope (legacy/worker/CLI) or no master key the codec is
 * the identity function and every column holds exactly the bytes it held before
 * G5. Reads are transitional — legacy plaintext rows keep working while sealing
 * is enabled, because G5 ships no credential backfill.
 */

import { NotFoundError } from '@omni/core';
import type { Database } from '@omni/db';
import { type AgentProvider, type NewAgentProvider, agentProviders } from '@omni/db';
import { eq } from 'drizzle-orm';
import { invalidateProviderCache } from '../plugins/agent-dispatcher';
import { openCredentialField, sealCredentialField } from '../tenancy/sealed-credentials';
import { currentTenantScope, runAfterTenantCommit } from '../tenancy/tenant-scope';

export interface ProviderHealthResult {
  healthy: boolean;
  latency: number;
  error?: string;
}

/**
 * The `schema_config` keys that are key material. Explicit allow-list for the
 * same reason as `instances`: a heuristic that stopped matching would fail OPEN.
 */
const SEALED_SCHEMA_CONFIG_KEYS = ['devicePrivateKey', 'deviceToken'] as const;

/** Apply `codec` to `api_key` and the sealed `schema_config` keys of `row`. */
function mapProviderSecrets<T extends Record<string, unknown>>(
  row: T,
  codec: (value: string) => string | null | undefined,
): T {
  const out: Record<string, unknown> = { ...row };

  if (typeof out.apiKey === 'string') out.apiKey = codec(out.apiKey);

  const schemaConfig = out.schemaConfig;
  if (schemaConfig && typeof schemaConfig === 'object') {
    const config = { ...(schemaConfig as Record<string, unknown>) };
    let changed = false;
    for (const key of SEALED_SCHEMA_CONFIG_KEYS) {
      const value = config[key];
      if (typeof value !== 'string') continue;
      config[key] = codec(value);
      changed = true;
    }
    if (changed) out.schemaConfig = config;
  }

  return out as T;
}

/** Seal the provider secrets present in `data` for `tenantId`. */
function sealProviderSecrets<T extends Record<string, unknown>>(tenantId: string | null, data: T): T {
  if (!tenantId) return data;
  return mapProviderSecrets(data, (value) => sealCredentialField(tenantId, value));
}

/**
 * Open a loaded provider row under `tenantId`. A secret sealed for another
 * tenant (or unreadable because no key is configured) becomes `null` — never the
 * envelope, which would otherwise be sent as an `Authorization: Bearer` value.
 */
function openProviderSecrets<T extends Record<string, unknown>>(tenantId: string | null, row: T): T {
  return mapProviderSecrets(row, (value) => openCredentialField(tenantId, value) ?? null);
}

export class ProviderService {
  /**
   * Extra per-provider cache evictions wired by the service container — the
   * dispatcher's provider cache is reached statically, but
   * `AgentRunnerService.clientCache` (the legacy `run()`/`stream()` path and
   * the `call_agent` automation action) caches a client holding the provider's
   * CREDENTIAL and is only reachable through the container. Without this hook a
   * rotated `api_key` or changed `base_url` kept being served from that cache
   * until the process restarted.
   */
  private readonly clientCacheInvalidators: Array<(providerId: string) => void> = [];

  constructor(private db: Database) {}

  /** Register an additional eviction to run after a provider is updated or deleted. */
  onProviderChanged(invalidate: (providerId: string) => void): void {
    this.clientCacheInvalidators.push(invalidate);
  }

  /**
   * Evict every cache that baked this provider's row in. Deferred to commit
   * (same rule as `InstanceService.update`): inside the request transaction a
   * concurrent dispatch still reads the OLD row and would re-cache stale
   * credentials right after an immediate eviction; on rollback the eviction is
   * dropped with the write it belonged to. Best-effort — a failing invalidator
   * must not turn a committed write into an error.
   */
  private invalidateCaches(providerId: string): void {
    runAfterTenantCommit(() => {
      invalidateProviderCache(providerId);
      for (const invalidate of this.clientCacheInvalidators) {
        try {
          invalidate(providerId);
        } catch {
          // Best-effort cache eviction — see the doc comment above.
        }
      }
    });
  }

  /** The tenant this service seals under / opens with; null on legacy paths. */
  private get tenantId(): string | null {
    return currentTenantScope()?.tenantId ?? null;
  }

  /**
   * List all providers
   */
  async list(options: { active?: boolean } = {}): Promise<AgentProvider[]> {
    let query = this.db.select().from(agentProviders).$dynamic();

    if (options.active !== undefined) {
      query = query.where(eq(agentProviders.isActive, options.active));
    }

    const rows = await query.orderBy(agentProviders.name);
    const tenantId = this.tenantId;
    return rows.map((row) => openProviderSecrets(tenantId, row));
  }

  /**
   * Get provider by ID
   */
  async getById(id: string): Promise<AgentProvider> {
    const [result] = await this.db.select().from(agentProviders).where(eq(agentProviders.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('AgentProvider', id);
    }

    return openProviderSecrets(this.tenantId, result);
  }

  /**
   * Get provider by name
   */
  async getByName(name: string): Promise<AgentProvider> {
    const [result] = await this.db.select().from(agentProviders).where(eq(agentProviders.name, name)).limit(1);

    if (!result) {
      throw new NotFoundError('AgentProvider', name);
    }

    return openProviderSecrets(this.tenantId, result);
  }

  /**
   * Create a new provider
   */
  async create(data: NewAgentProvider): Promise<AgentProvider> {
    const tenantId = this.tenantId;
    const [created] = await this.db.insert(agentProviders).values(sealProviderSecrets(tenantId, data)).returning();

    if (!created) {
      throw new Error('Failed to create agent provider');
    }

    return openProviderSecrets(tenantId, created);
  }

  /**
   * Update a provider
   */
  async update(id: string, data: Partial<NewAgentProvider>): Promise<AgentProvider> {
    const tenantId = this.tenantId;
    const [updated] = await this.db
      .update(agentProviders)
      .set({ ...sealProviderSecrets(tenantId, data), updatedAt: new Date() })
      .where(eq(agentProviders.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('AgentProvider', id);
    }

    this.invalidateCaches(id);

    return openProviderSecrets(tenantId, updated);
  }

  /**
   * Delete a provider
   */
  async delete(id: string): Promise<void> {
    const result = await this.db.delete(agentProviders).where(eq(agentProviders.id, id)).returning();

    if (!result.length) {
      throw new NotFoundError('AgentProvider', id);
    }

    this.invalidateCaches(id);
  }

  /**
   * Health check a provider
   */
  async checkHealth(id: string): Promise<ProviderHealthResult> {
    const provider = await this.getById(id);

    const start = Date.now();

    try {
      // For WebSocket-based providers (openclaw schema), convert ws:// → http:// for health probe
      const baseUrl = provider.baseUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
      const healthUrl = new URL('/health', baseUrl).toString();
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
