/**
 * Instance Monitor
 *
 * Provides robustness features for channel instances:
 * - Health monitoring with periodic checks
 * - Automatic reconnection with exponential backoff
 * - Connection pooling to limit concurrent operations
 *
 * WORKER TENANT CONTEXT (wish: omni-full-multitenancy, G5; ADR-0008)
 * ------------------------------------------------------------------
 * This module is periodic work: a 30-second health INTERVAL, a 5-second
 * reconnect drain, and a once-per-boot pooled reconnect. None of them has a
 * request, a credential or an envelope, so nothing hands them a tenant. Before
 * the conversion every path read the WHOLE `instances` table and then re-read /
 * DEACTIVATED single rows on the ambient pool — the unscoped worker access that
 * kept `plugins/instance-monitor.ts::instances` in `pending-G5-conversion`.
 *
 * Two shapes, both established by earlier legs:
 *
 *   * WHOLE-TABLE SWEEPS (`runHealthCheck`, `reconnectWithPool`) adopt
 *     `runForEachActiveTenantRow` — the daily-sync / turn-monitor precedent. A
 *     cron must ENUMERATE whose work exists (under RLS enforcement the global
 *     scan is not expressible at all), and only the discrete `listActive` READ
 *     is scoped: the per-row plugin `getStatus`/`connect` calls are NETWORK work
 *     and must never be held inside a worker transaction.
 *   * SINGLE-ROW PATHS (`fetchInstanceById`, `markInstanceInactive`) derive
 *     their tenant from the INSTANCE-OWNER REGISTRY — the same trusted
 *     persisted-ownership derivation the publish path uses, and one this module
 *     already feeds from every row it loads. The reconnect queue is an in-memory
 *     structure keyed by instance id with no envelope of its own, so the
 *     registry is the only non-caller-controlled answer available to it.
 *
 * THE DUAL WORLD: with no auth plane wired (`setAuthPlane` never called — the
 * shape every existing test and every flag-off deployment produces), or with the
 * flag off, every path is EXACTLY the pre-G5 one: one ambient scan, no
 * enumeration, not one additional query. The tenant fan-out binds only to the
 * multitenancy world, where tenants exist at all.
 */

import type { ChannelPlugin, ChannelRegistry } from '@omni/channel-sdk';
import type { Database } from '@omni/db';
import { instances } from '@omni/db';
import { eq } from 'drizzle-orm';

import { lookupInstanceOwner, rememberInstanceOwners } from '../tenancy/instance-owner-registry';
import { runForEachActiveTenantRow } from '../tenancy/periodic-tenant-work';
import { scopedHandle } from '../tenancy/tenant-scope';
import { runTenantWorkDb } from '../tenancy/worker-tenant-context';
import { createLogger } from './logger';

const logger = createLogger({ module: 'instance-monitor' });

// ============================================================================
// Types
// ============================================================================

interface InstanceInfo {
  id: string;
  name: string;
  channel: string;
  ownerIdentifier: string | null;
  /** Persisted ownership (G2 root), carried so the sweep can seed the registry. */
  tenantId: string | null;
}

interface ReconnectState {
  instanceId: string;
  attempts: number;
  lastAttempt: Date;
  nextAttempt: Date;
  error?: string;
}

interface ReconnectResults {
  attempted: number;
  succeeded: number;
  failed: number;
  errors: Array<{ instanceId: string; error: string }>;
}

// ============================================================================
// Configuration
// ============================================================================

export interface MonitorConfig {
  /** Health check interval in ms (default: 30 seconds) */
  healthCheckIntervalMs?: number;
  /** Max concurrent reconnection attempts (default: 3) */
  maxConcurrentReconnects?: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  backoffBaseMs?: number;
  /** Max backoff delay in ms (default: 5 minutes) */
  backoffMaxMs?: number;
  /** Max reconnection attempts before giving up (default: 10) */
  maxReconnectAttempts?: number;
  /** Whether to auto-reconnect failed instances (default: true) */
  autoReconnect?: boolean;
}

const DEFAULT_CONFIG: Required<MonitorConfig> = {
  healthCheckIntervalMs: 30_000,
  maxConcurrentReconnects: 3,
  backoffBaseMs: 1000,
  backoffMaxMs: 300_000, // 5 minutes
  maxReconnectAttempts: 10,
  autoReconnect: true,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Maximum age (ms) for an in-flight 'reconnecting' or 'connecting' state
 * before the monitor assumes the plugin-level retry loop has silently died
 * and takes over the reconnect itself (issue #408).
 */
const STALE_TRANSITION_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Check if an instance needs reconnection based on its status.
 *
 * IMPORTANT: Do NOT reconnect instances in 'reconnecting' state — the
 * Baileys connection handler is already managing the reconnect with its
 * own exponential backoff. Having two systems reconnect the same instance
 * creates duplicate sockets and rapid connect/disconnect churn that
 * WhatsApp interprets as bot activity (leading to temp bans).
 *
 * EXCEPTION: If the transition state is older than
 * STALE_TRANSITION_MAX_AGE_MS, the plugin-side loop has likely died
 * without transitioning us out. Fall through to reconnect anyway.
 */
function needsReconnect(status: { state: string; since?: Date }): boolean {
  if (status.state === 'disconnected' || status.state === 'error') {
    return true;
  }

  if (status.state === 'reconnecting' || status.state === 'connecting') {
    const since = status.since instanceof Date ? status.since.getTime() : Number.NaN;
    if (Number.isFinite(since) && Date.now() - since > STALE_TRANSITION_MAX_AGE_MS) {
      return true;
    }
  }

  return false;
}

/**
 * Check if an instance was previously authenticated
 */
function wasAuthenticated(instance: InstanceInfo): boolean {
  return !!instance.ownerIdentifier;
}

/** Extract Slack-specific config from profileMetadata into connection options */
function applySlackMetadata(
  options: Record<string, unknown>,
  metadata: Record<string, unknown> | null | undefined,
): void {
  if (!metadata) return;
  if (metadata.replyToMode) options.replyToMode = metadata.replyToMode;
  if (metadata.streamMode) options.streamMode = metadata.streamMode;
  if (metadata.dmPolicy) options.dmPolicy = metadata.dmPolicy;
  if (metadata.dmAllowlist) options.dmAllowlist = metadata.dmAllowlist;
}

/** Build channel-specific connection options from instance DB fields */
function buildInstanceConnectOptions(instance: {
  channel: string;
  telegramBotToken?: string | null;
  telegramReactionLevel?: string | null;
  discordBotToken?: string | null;
  slackBotToken?: string | null;
  slackAppToken?: string | null;
  slackSigningSecret?: string | null;
  profileMetadata?: Record<string, unknown> | null;
  gupshupApiKey?: string | null;
  gupshupAppName?: string | null;
  gupshupSourcePhone?: string | null;
  gupshupCallbackUrl?: string | null;
  gupshupAuthToken?: string | null;
  gupshupEventId?: string | null;
  webhookVerifyToken?: string | null;
  twilioAccountSid?: string | null;
  twilioAuthToken?: string | null;
  twilioFrom?: string | null;
  twilioMessagingServiceSid?: string | null;
  twilioStatusCallbackUrl?: string | null;
  twilioWebhookUrl?: string | null;
  twilioValidateSignature?: boolean | null;
  metaAccessToken?: string | null;
  metaPhoneNumberId?: string | null;
  metaWabaId?: string | null;
  metaAppId?: string | null;
  metaBusinessId?: string | null;
  metaApiVersion?: string | null;
  metaDisplayPhoneNumber?: string | null;
  metaConnectionMethod?: string | null;
  hermesBaseUrl?: string | null;
  hermesUsername?: string | null;
  hermesPassword?: string | null;
  hermesMediaId?: string | null;
  hermesTemplateNamespace?: string | null;
  ascFlowBaseUrl?: string | null;
  ascFlowLogin?: string | null;
  ascFlowChave?: string | null;
  ascFlowHandoffMode?: string | null;
  ascFlowHandoffServico?: number | null;
}): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (instance.telegramBotToken) options.token = instance.telegramBotToken;
  if (instance.channel === 'telegram') options.telegramReactionLevel = instance.telegramReactionLevel;
  if (instance.discordBotToken) options.token = instance.discordBotToken;
  if (instance.channel === 'slack') {
    if (instance.slackBotToken) options.botToken = instance.slackBotToken;
    if (instance.slackAppToken) options.appToken = instance.slackAppToken;
    if (instance.slackSigningSecret) options.signingSecret = instance.slackSigningSecret;
    applySlackMetadata(options, instance.profileMetadata);
  }
  if (instance.channel === 'gupshup') {
    applyGupshupOptions(options, instance);
  }
  if (instance.channel === 'twilio-whatsapp') {
    applyTwilioWhatsAppOptions(options, instance);
  }
  if (instance.channel === 'whatsapp-business') {
    applyWhatsAppBusinessOptions(options, instance);
  }
  if (instance.channel === 'hermes') {
    applyHermesOptions(options, instance);
  }
  if (instance.channel === 'asc-flow') {
    applyAscFlowOptions(options, instance);
  }
  return options;
}

/**
 * asc-flow reconnect credentials — the plugin's `connect()` reads these from
 * `config.options` (same keys as `config.credentials` in the manual connect
 * route). Persisted on `instances` by the create/connect/PATCH routes. The
 * optional webhook verify token reuses the shared webhookVerifyToken column.
 */
function applyAscFlowOptions(
  options: Record<string, unknown>,
  instance: {
    ascFlowBaseUrl?: string | null;
    ascFlowLogin?: string | null;
    ascFlowChave?: string | null;
    ascFlowHandoffMode?: string | null;
    ascFlowHandoffServico?: number | null;
    webhookVerifyToken?: string | null;
  },
): void {
  if (instance.ascFlowBaseUrl) options.ascFlowBaseUrl = instance.ascFlowBaseUrl;
  if (instance.ascFlowLogin) options.ascFlowLogin = instance.ascFlowLogin;
  if (instance.ascFlowChave) options.ascFlowChave = instance.ascFlowChave;
  if (instance.ascFlowHandoffMode) options.ascFlowHandoffMode = instance.ascFlowHandoffMode;
  if (instance.ascFlowHandoffServico != null) options.ascFlowHandoffServico = instance.ascFlowHandoffServico;
  if (instance.webhookVerifyToken) options.webhookVerifyToken = instance.webhookVerifyToken;
}

/**
 * hermes reconnect credentials — the plugin's `connect()` reads these from
 * `config.options` (same keys as `config.credentials` in the manual connect
 * route). Persisted on `instances` by the create/connect/PATCH routes.
 */
function applyHermesOptions(
  options: Record<string, unknown>,
  instance: {
    hermesBaseUrl?: string | null;
    hermesUsername?: string | null;
    hermesPassword?: string | null;
    hermesMediaId?: string | null;
    hermesTemplateNamespace?: string | null;
  },
): void {
  if (instance.hermesBaseUrl) options.hermesBaseUrl = instance.hermesBaseUrl;
  if (instance.hermesUsername) options.hermesUsername = instance.hermesUsername;
  if (instance.hermesPassword) options.hermesPassword = instance.hermesPassword;
  if (instance.hermesMediaId) options.hermesMediaId = instance.hermesMediaId;
  if (instance.hermesTemplateNamespace) options.hermesTemplateNamespace = instance.hermesTemplateNamespace;
}

/**
 * whatsapp-business reconnect credentials — the plugin's `connect()` reads these
 * from `config.options` (same keys as `config.credentials` in the manual
 * connect route). Persisted on `instances` by the connect/oauth routes.
 */
function applyWhatsAppBusinessOptions(
  options: Record<string, unknown>,
  instance: {
    metaAccessToken?: string | null;
    metaPhoneNumberId?: string | null;
    metaWabaId?: string | null;
    metaAppId?: string | null;
    metaBusinessId?: string | null;
    metaApiVersion?: string | null;
    metaDisplayPhoneNumber?: string | null;
    metaConnectionMethod?: string | null;
  },
): void {
  if (instance.metaAccessToken) options.metaAccessToken = instance.metaAccessToken;
  if (instance.metaPhoneNumberId) options.metaPhoneNumberId = instance.metaPhoneNumberId;
  if (instance.metaWabaId) options.metaWabaId = instance.metaWabaId;
  if (instance.metaAppId) options.metaAppId = instance.metaAppId;
  if (instance.metaBusinessId) options.metaBusinessId = instance.metaBusinessId;
  if (instance.metaApiVersion) options.metaApiVersion = instance.metaApiVersion;
  if (instance.metaDisplayPhoneNumber) options.metaDisplayPhoneNumber = instance.metaDisplayPhoneNumber;
  if (instance.metaConnectionMethod) options.metaConnectionMethod = instance.metaConnectionMethod;
}

function applyGupshupOptions(
  options: Record<string, unknown>,
  instance: {
    gupshupCallbackUrl?: string | null;
    gupshupAuthToken?: string | null;
    gupshupEventId?: string | null;
    gupshupApiKey?: string | null;
    gupshupAppName?: string | null;
    gupshupSourcePhone?: string | null;
    webhookVerifyToken?: string | null;
  },
): void {
  if (instance.gupshupCallbackUrl) options.gupshupCallbackUrl = instance.gupshupCallbackUrl;
  if (instance.gupshupAuthToken) options.gupshupAuthToken = instance.gupshupAuthToken;
  if (instance.gupshupEventId) options.gupshupEventId = instance.gupshupEventId;
  if (instance.gupshupApiKey) options.gupshupApiKey = instance.gupshupApiKey;
  if (instance.gupshupAppName) options.gupshupAppName = instance.gupshupAppName;
  if (instance.gupshupSourcePhone) options.gupshupSourcePhone = instance.gupshupSourcePhone;
  if (instance.webhookVerifyToken) options.webhookVerifyToken = instance.webhookVerifyToken;
}

function applyTwilioWhatsAppOptions(
  options: Record<string, unknown>,
  instance: {
    twilioAccountSid?: string | null;
    twilioAuthToken?: string | null;
    twilioFrom?: string | null;
    twilioMessagingServiceSid?: string | null;
    twilioStatusCallbackUrl?: string | null;
    twilioWebhookUrl?: string | null;
    twilioValidateSignature?: boolean | null;
  },
): void {
  if (instance.twilioAccountSid) options.twilioAccountSid = instance.twilioAccountSid;
  if (instance.twilioAuthToken) options.twilioAuthToken = instance.twilioAuthToken;
  if (instance.twilioFrom) options.twilioFrom = instance.twilioFrom;
  if (instance.twilioMessagingServiceSid) options.twilioMessagingServiceSid = instance.twilioMessagingServiceSid;
  if (instance.twilioStatusCallbackUrl) options.twilioStatusCallbackUrl = instance.twilioStatusCallbackUrl;
  if (instance.twilioWebhookUrl) options.twilioWebhookUrl = instance.twilioWebhookUrl;
  if (instance.twilioValidateSignature !== undefined && instance.twilioValidateSignature !== null) {
    options.twilioValidateSignature = instance.twilioValidateSignature;
  }
}

/**
 * Connect a single instance via its plugin
 */
async function connectInstance(
  instance: {
    id: string;
    channel: string;
    telegramBotToken?: string | null;
    telegramReactionLevel?: string | null;
    discordBotToken?: string | null;
    guildConfigOverrides?: Record<string, unknown> | null;
    discordPresence?: Record<string, unknown> | null;
    slackBotToken?: string | null;
    slackAppToken?: string | null;
    slackSigningSecret?: string | null;
    profileMetadata?: Record<string, unknown> | null;
    gupshupApiKey?: string | null;
    gupshupAppName?: string | null;
    gupshupSourcePhone?: string | null;
    gupshupCallbackUrl?: string | null;
    gupshupAuthToken?: string | null;
    gupshupEventId?: string | null;
    webhookVerifyToken?: string | null;
    twilioAccountSid?: string | null;
    twilioAuthToken?: string | null;
    twilioFrom?: string | null;
    twilioMessagingServiceSid?: string | null;
    twilioStatusCallbackUrl?: string | null;
    twilioWebhookUrl?: string | null;
    twilioValidateSignature?: boolean | null;
  },
  registry: ChannelRegistry,
): Promise<void> {
  const plugin = registry.get(instance.channel as Parameters<typeof registry.get>[0]);
  if (!plugin) {
    throw new Error(`No plugin for channel: ${instance.channel}`);
  }

  // Hydrate per-guild config overrides into the plugin cache before connecting.
  if ('loadGuildConfigs' in plugin && instance.guildConfigOverrides) {
    (plugin as { loadGuildConfigs: (iId: string, cfg: Record<string, unknown>) => void }).loadGuildConfigs(
      instance.id,
      instance.guildConfigOverrides,
    );
  }

  const options = buildInstanceConnectOptions(instance);
  // Re-apply persisted presence on reconnect (plugin reads options.presence in handleConnected)
  if (instance.discordPresence) {
    options.presence = instance.discordPresence;
  }

  await plugin.connect(instance.id, {
    instanceId: instance.id,
    credentials: {},
    options,
  });
}

/**
 * Process a single batch result and update counters
 *
 * Note: Failed reconnections do NOT mark instance as inactive.
 * The InstanceMonitor will retry with exponential backoff.
 */
async function handleBatchResult(
  result: PromiseSettledResult<string>,
  instance: { id: string; name: string },
  _db: Database,
  results: ReconnectResults,
): Promise<void> {
  if (result.status === 'fulfilled') {
    results.succeeded++;
    logger.info('Instance reconnected', { instanceId: instance.id, name: instance.name });
  } else {
    results.failed++;
    const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
    results.errors.push({ instanceId: instance.id, error });
    logger.warn('Instance reconnection failed at startup, monitor will retry', {
      instanceId: instance.id,
      name: instance.name,
      error,
    });
    // Don't mark as inactive - let InstanceMonitor handle retries with backoff
  }
}

/**
 * Delay execution for a specified duration
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Instance Monitor Class
// ============================================================================

export class InstanceMonitor {
  private config: Required<MonitorConfig>;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectQueue: Map<string, ReconnectState> = new Map();
  private activeReconnects = 0;
  private isRunning = false;

  /**
   * The auth-plane read connection, injected after construction by `index.ts`
   * (mirrors `batchJobs.setAuthPlane` / `followUpSweeper.setAuthPlane`). Per
   * ADR-0003 it is the only runtime-process identity that may enumerate
   * `tenants`, and its ABSENCE is the legacy world: without it every sweep is
   * the pre-G5 single ambient pass.
   */
  private authPlaneDb: Database | null = null;
  /** Environment used for the flag/enforcement decisions. Tests override it. */
  private env: NodeJS.ProcessEnv | undefined;

  /**
   * The handle every query in this class uses.
   *
   * Opening a worker tenant scope is only half the conversion: the scope carries
   * the tenant-stamped TRANSACTION, and `set_config('app.tenant_id', …, true)`
   * is transaction-local. A query issued on the injected pool inside that scope
   * takes a DIFFERENT pooled connection, which never saw the stamp — unscoped
   * before enforcement, fail-closed under RLS, and invisible to any probe that
   * only asserts `currentTenantScope()`. `scopedHandle` is the one bridge, and
   * it is the same accessor every converted service uses (`services/batch-jobs.ts`,
   * `services/agent-replay.ts`). Outside a scope it returns the ambient pool, so
   * the legacy/flag-off statement is byte-for-byte the pre-G5 one.
   */
  private get db(): Database {
    return scopedHandle(this.pool);
  }

  constructor(
    private readonly pool: Database,
    private readonly registry: ChannelRegistry,
    config: MonitorConfig = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Opt this monitor into the tenant fan-out (wired by `index.ts` once services
   * exist). Until it is called the monitor runs its pre-G5 ambient sweep; the
   * first health check is a full interval away, so wiring during the same
   * startup tick happens long before any tick fires.
   */
  setAuthPlane(authPlaneDb: Database, env?: NodeJS.ProcessEnv): void {
    this.authPlaneDb = authPlaneDb;
    this.env = env;
  }

  /**
   * The TRUSTED tenant of a single instance, for the paths that hold only an
   * instance id (the in-memory reconnect queue, `forceReconnect`).
   *
   * Read from the instance-owner registry — persisted `instances.tenant_id` this
   * process already loaded — never from any caller-supplied value. Unknown
   * instances resolve to `null` and their block runs exactly as it did pre-G5
   * (and fails closed under enforcement, which is the correct posture for an
   * instance whose ownership this process has never observed).
   */
  private tenantOf(instanceId: string): string | null {
    return lookupInstanceOwner(instanceId);
  }

  /**
   * Start the instance monitor
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Monitor already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting instance monitor', {
      healthCheckInterval: this.config.healthCheckIntervalMs,
      maxConcurrentReconnects: this.config.maxConcurrentReconnects,
      autoReconnect: this.config.autoReconnect,
    });

    // Start periodic health checks
    this.healthCheckTimer = setInterval(() => {
      this.runHealthCheck().catch((err) => {
        logger.error('Health check failed', { error: String(err) });
      });
    }, this.config.healthCheckIntervalMs);

    // Process reconnect queue periodically
    setInterval(() => {
      this.processReconnectQueue().catch((err) => {
        logger.error('Reconnect queue processing failed', { error: String(err) });
      });
    }, 5000);
  }

  /**
   * Stop the instance monitor
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    this.reconnectQueue.clear();
    logger.info('Instance monitor stopped');
  }

  /**
   * Run health check on all active instances.
   *
   * G5 (ADR-0008): the sweep is fanned out across tenants. Only the discrete
   * `fetchActiveInstances` READ runs inside a tenant's worker scope; the
   * per-instance health probe (`checkInstanceHealth` → `plugin.getStatus`) is a
   * network/in-process plugin call and runs OUTSIDE it, so no pooled connection
   * is pinned across the round trip.
   *
   * Legacy (no auth plane wired, or flag off): the helper runs exactly one
   * ambient pass with `tenantId === null` — the pre-G5 loop, statement for
   * statement.
   */
  async runHealthCheck(): Promise<void> {
    if (!this.authPlaneDb) {
      const activeInstances = await this.fetchActiveInstances();
      for (const instance of activeInstances) {
        await this.checkInstanceHealth(instance);
      }
      return;
    }

    await runForEachActiveTenantRow(
      {
        // The POOL: the fan-out opens the per-tenant transaction itself. Queries
        // inside the scope reach it through `this.db` (`scopedHandle`).
        db: this.pool,
        authPlaneDb: this.authPlaneDb,
        jobName: 'instance-health-check',
        listActive: () => this.fetchActiveInstances(),
        env: this.env,
      },
      (instance) => this.checkInstanceHealth(instance),
    );
  }

  /**
   * Fetch all active instances from database
   */
  private async fetchActiveInstances(): Promise<InstanceInfo[]> {
    const rows = await this.db
      .select({
        id: instances.id,
        name: instances.name,
        channel: instances.channel,
        ownerIdentifier: instances.ownerIdentifier,
        tenantId: instances.tenantId,
      })
      .from(instances)
      .where(eq(instances.isActive, true));

    // G5 (ADR-0008): this health-check sweep is one of the few places the
    // process loads EVERY active instance row, so it is a natural place to
    // teach the ownership registry that lets channel-plugin publishes stamp a
    // trusted tenant. See `tenancy/instance-owner-registry.ts`.
    rememberInstanceOwners(rows);
    return rows;
  }

  /**
   * Check health of a single instance and schedule reconnect if needed
   */
  private async checkInstanceHealth(instance: InstanceInfo): Promise<void> {
    const plugin = this.getPluginForInstance(instance);
    if (!plugin) return;

    try {
      const status = await plugin.getStatus(instance.id);

      if (needsReconnect(status)) {
        this.handleUnhealthyInstance(instance, status.state, status.message);
      }
    } catch (error) {
      logger.error('Health check failed for instance', { instanceId: instance.id, error: String(error) });
      this.handleHealthCheckError(instance, String(error));
    }
  }

  /**
   * Get plugin for an instance, logging warning if not found
   */
  private getPluginForInstance(instance: InstanceInfo): ChannelPlugin | null {
    const plugin = this.registry.get(instance.channel as Parameters<typeof this.registry.get>[0]);
    if (!plugin) {
      logger.warn('No plugin for instance', { instanceId: instance.id, channel: instance.channel });
    }
    return plugin ?? null;
  }

  /**
   * Handle an unhealthy instance by scheduling reconnect if appropriate
   */
  private handleUnhealthyInstance(instance: InstanceInfo, state: string, message?: string): void {
    if (!wasAuthenticated(instance)) {
      logger.debug('Skipping reconnect for never-authenticated instance', {
        instanceId: instance.id,
        name: instance.name,
        state,
      });
      return;
    }

    logger.warn('Instance unhealthy', {
      instanceId: instance.id,
      name: instance.name,
      state,
      message,
    });

    if (this.config.autoReconnect) {
      this.scheduleReconnect(instance.id, instance.channel, message);
    }
  }

  /**
   * Handle a health check error
   */
  private handleHealthCheckError(instance: InstanceInfo, error: string): void {
    if (this.config.autoReconnect && wasAuthenticated(instance)) {
      this.scheduleReconnect(instance.id, instance.channel, error);
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   *
   * If the instance is already queued and waiting for its next attempt,
   * we do NOT bump the counter — repeated health-check calls should not
   * accelerate the backoff or create duplicate attempts.
   */
  scheduleReconnect(instanceId: string, _channel: string, error?: string): void {
    const existing = this.reconnectQueue.get(instanceId);

    if (existing && existing.attempts >= this.config.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached', { instanceId, attempts: existing.attempts });
      this.markInstanceInactive(instanceId).catch(() => {});
      this.reconnectQueue.delete(instanceId);
      return;
    }

    // If already queued and not yet due, don't re-schedule — let the
    // existing backoff timer play out.  This prevents the 30s health
    // check from bumping attempts on every tick.
    if (existing && existing.nextAttempt > new Date()) {
      return;
    }

    const attempts = existing ? existing.attempts + 1 : 1;
    const backoffMs = Math.min(this.config.backoffBaseMs * 2 ** (attempts - 1), this.config.backoffMaxMs);

    const state: ReconnectState = {
      instanceId,
      attempts,
      lastAttempt: new Date(),
      nextAttempt: new Date(Date.now() + backoffMs),
      error,
    };

    this.reconnectQueue.set(instanceId, state);
    logger.info('Scheduled reconnect', {
      instanceId,
      attempt: attempts,
      backoffMs,
      nextAttempt: state.nextAttempt.toISOString(),
    });
  }

  /**
   * Process the reconnection queue
   */
  private async processReconnectQueue(): Promise<void> {
    if (this.reconnectQueue.size === 0) return;
    if (this.activeReconnects >= this.config.maxConcurrentReconnects) return;

    const readyToReconnect = this.getReadyReconnects();
    const toProcess = readyToReconnect.slice(0, this.config.maxConcurrentReconnects - this.activeReconnects);

    for (const state of toProcess) {
      this.attemptReconnect(state).catch(() => {});
    }
  }

  /**
   * Get reconnects that are ready to be processed
   */
  private getReadyReconnects(): ReconnectState[] {
    const now = new Date();
    const ready: ReconnectState[] = [];

    for (const state of this.reconnectQueue.values()) {
      if (state.nextAttempt <= now) {
        ready.push(state);
      }
    }

    return ready.sort((a, b) => a.nextAttempt.getTime() - b.nextAttempt.getTime());
  }

  /**
   * Attempt to reconnect an instance
   */
  private async attemptReconnect(state: ReconnectState): Promise<void> {
    this.activeReconnects++;

    try {
      logger.info('Attempting reconnect', { instanceId: state.instanceId, attempt: state.attempts });

      const instance = await this.fetchInstanceById(state.instanceId);
      if (!instance) {
        logger.warn('Instance not found, removing from queue', { instanceId: state.instanceId });
        this.reconnectQueue.delete(state.instanceId);
        return;
      }

      await connectInstance(instance, this.registry);
      this.reconnectQueue.delete(state.instanceId);
      logger.info('Reconnect successful', { instanceId: state.instanceId, attempts: state.attempts });
    } catch (error) {
      await this.handleReconnectFailure(state, String(error));
    } finally {
      this.activeReconnects--;
    }
  }

  /**
   * Handle a failed reconnection attempt
   */
  private async handleReconnectFailure(state: ReconnectState, error: string): Promise<void> {
    logger.error('Reconnect failed', { instanceId: state.instanceId, attempt: state.attempts, error });

    const instance = await this.fetchInstanceById(state.instanceId);
    if (instance) {
      this.scheduleReconnect(state.instanceId, instance.channel, error);
    }
  }

  /**
   * Fetch an instance by ID (includes bot token columns for reconnect)
   */
  private async fetchInstanceById(instanceId: string): Promise<{
    id: string;
    channel: string;
    telegramBotToken?: string | null;
    telegramReactionLevel?: string | null;
    discordBotToken?: string | null;
    guildConfigOverrides?: Record<string, unknown> | null;
    discordPresence?: Record<string, unknown> | null;
    slackBotToken?: string | null;
    slackAppToken?: string | null;
    slackSigningSecret?: string | null;
    profileMetadata?: Record<string, unknown> | null;
    gupshupApiKey?: string | null;
    gupshupAppName?: string | null;
    gupshupSourcePhone?: string | null;
    gupshupCallbackUrl?: string | null;
    gupshupAuthToken?: string | null;
    gupshupEventId?: string | null;
    webhookVerifyToken?: string | null;
    twilioAccountSid?: string | null;
    twilioAuthToken?: string | null;
    twilioFrom?: string | null;
    twilioMessagingServiceSid?: string | null;
    twilioStatusCallbackUrl?: string | null;
    twilioWebhookUrl?: string | null;
    twilioValidateSignature?: boolean | null;
  } | null> {
    // Discrete DB block in the INSTANCE's own world: its tenant comes from the
    // ownership registry, not from the queue entry that asked for it.
    const [instance] = await runTenantWorkDb(this.pool, this.tenantOf(instanceId), () =>
      this.db.select().from(instances).where(eq(instances.id, instanceId)).limit(1),
    );
    if (instance) rememberInstanceOwners([instance]);
    return instance ?? null;
  }

  /**
   * Mark an instance as inactive in the database.
   *
   * This is the sweep's only WRITE, and it is a deactivation — exactly the
   * effect that must never cross a tenant boundary. Same registry-derived
   * tenant as the read above; ambient (and fail-closed under enforcement) for an
   * instance whose ownership this process never observed.
   */
  private async markInstanceInactive(instanceId: string): Promise<void> {
    await runTenantWorkDb(this.pool, this.tenantOf(instanceId), () =>
      this.db.update(instances).set({ isActive: false }).where(eq(instances.id, instanceId)),
    );
    logger.info('Marked instance as inactive', { instanceId });
  }

  /**
   * Get current monitor status
   */
  getStatus(): {
    isRunning: boolean;
    activeReconnects: number;
    queuedReconnects: number;
    reconnectQueue: Array<{ instanceId: string; attempts: number; nextAttempt: string }>;
  } {
    return {
      isRunning: this.isRunning,
      activeReconnects: this.activeReconnects,
      queuedReconnects: this.reconnectQueue.size,
      reconnectQueue: Array.from(this.reconnectQueue.values()).map((s) => ({
        instanceId: s.instanceId,
        attempts: s.attempts,
        nextAttempt: s.nextAttempt.toISOString(),
      })),
    };
  }

  /**
   * Manually trigger reconnection for an instance
   */
  async forceReconnect(instanceId: string): Promise<void> {
    const instance = await this.fetchInstanceById(instanceId);
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`);
    }

    this.reconnectQueue.delete(instanceId);
    this.scheduleReconnect(instanceId, instance.channel, 'Manual reconnect requested');
  }

  /**
   * Clear reconnect queue for an instance
   */
  clearReconnectQueue(instanceId: string): void {
    this.reconnectQueue.delete(instanceId);
  }
}

// ============================================================================
// Connection Pool for Startup
// ============================================================================

/**
 * Reconnect instances with connection pooling.
 *
 * G5 (ADR-0008): the startup reconnect is a whole-table `instances` scan with no
 * request and no credential, so it is fanned out across tenants exactly like the
 * health check. `authPlaneDb` is what opts it in — `index.ts` resolves an
 * auth-plane handle for the duration of the boot reconnect and closes it right
 * after, because at that point in startup the long-lived services (and their
 * `services.authPlane`) do not exist yet. Without it this is the pre-G5 single
 * ambient scan, byte for byte.
 *
 * The connect itself is a NETWORK call per instance and stays outside every
 * scope: only the row READ is scoped.
 */
export async function reconnectWithPool(
  db: Database,
  registry: ChannelRegistry,
  options: {
    maxConcurrent?: number;
    delayBetweenMs?: number;
    authPlaneDb?: Database;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<ReconnectResults> {
  const { maxConcurrent = 3, delayBetweenMs = 500, authPlaneDb, env } = options;

  const results: ReconnectResults = { attempted: 0, succeeded: 0, failed: 0, errors: [] };

  const loadActive = async (): Promise<
    Array<{ id: string; name: string; channel: string; tenantId: string | null }>
  > => {
    // `scopedHandle` for the same reason the class uses it: inside a per-tenant
    // worker scope this is that tenant's stamped transaction, and outside one it
    // is `db` itself — the pre-G5 statement, unchanged.
    const rows = await scopedHandle(db).select().from(instances).where(eq(instances.isActive, true));
    // G5 (ADR-0008): the startup reconnect is the FIRST bulk load of instance
    // rows in the process, and it happens before any channel plugin can emit —
    // so seeding the ownership registry here is what makes the very first
    // `message.received` of a boot carry a trusted tenant rather than a legacy
    // envelope.
    rememberInstanceOwners(rows);
    return rows as Array<{ id: string; name: string; channel: string; tenantId: string | null }>;
  };

  // LEGACY WORLD: one ambient scan, then the pre-G5 batching. Unchanged.
  if (!authPlaneDb) {
    const activeInstances = await loadActive();
    results.attempted = activeInstances.length;
    logger.info('Starting pooled reconnection', {
      instanceCount: activeInstances.length,
      maxConcurrent,
      delayBetweenMs,
    });
    if (activeInstances.length === 0) return results;
    await processInstanceBatches(activeInstances, registry, db, results, maxConcurrent, delayBetweenMs);
    logger.info('Pooled reconnection complete', { ...results });
    return results;
  }

  // TENANT WORLD: the read is scoped per active tenant; the batching (and every
  // `plugin.connect`) runs outside that scope.
  //
  // The enumerated rows are collected into ONE pending list and batched
  // together, so `maxConcurrent` stays the process-wide ceiling it has always
  // been and the waves are tenant-MIXED. That is deliberate: the ceiling exists
  // to protect this process's socket/CPU budget at boot, and making it
  // per-tenant would multiply the real concurrency by the tenant count. Pinned
  // by the `concurrency ceiling is GLOBAL` probe in
  // `plugins/__tests__/instance-monitor-worker-scope.test.ts`.
  const pending: Array<{ id: string; name: string; channel: string }> = [];
  await runForEachActiveTenantRow(
    { db, authPlaneDb, jobName: 'startup-reconnect', listActive: loadActive, env },
    async (instance) => {
      pending.push(instance);
    },
  );
  results.attempted = pending.length;
  logger.info('Starting pooled reconnection', { instanceCount: pending.length, maxConcurrent, delayBetweenMs });
  if (pending.length === 0) return results;

  await processInstanceBatches(pending, registry, db, results, maxConcurrent, delayBetweenMs);
  logger.info('Pooled reconnection complete', { ...results });
  return results;
}

/**
 * Process instances in batches with concurrency control
 */
async function processInstanceBatches(
  allInstances: Array<{ id: string; name: string; channel: string }>,
  registry: ChannelRegistry,
  db: Database,
  results: ReconnectResults,
  maxConcurrent: number,
  delayBetweenMs: number,
): Promise<void> {
  for (let i = 0; i < allInstances.length; i += maxConcurrent) {
    const batch = allInstances.slice(i, i + maxConcurrent);
    await processSingleBatch(batch, registry, db, results);

    const hasMoreBatches = i + maxConcurrent < allInstances.length;
    if (hasMoreBatches) {
      await delay(delayBetweenMs);
    }
  }
}

/**
 * Process a single batch of instances
 */
async function processSingleBatch(
  batch: Array<{ id: string; name: string; channel: string }>,
  registry: ChannelRegistry,
  db: Database,
  results: ReconnectResults,
): Promise<void> {
  const batchResults = await Promise.allSettled(
    batch.map((instance) => connectInstance(instance, registry).then(() => instance.id)),
  );

  for (let j = 0; j < batchResults.length; j++) {
    const result = batchResults[j];
    const instance = batch[j];
    if (!result || !instance) continue;

    await handleBatchResult(result, instance, db, results);
  }
}
