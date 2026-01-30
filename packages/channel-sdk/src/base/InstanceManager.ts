/**
 * Instance state tracking for channel plugins
 *
 * Manages the state of all connected instances for a channel.
 */

import type { ConnectionStatus, InstanceConfig, InstanceState } from '../types/instance';

/**
 * Manages instance state for a channel plugin
 */
export class InstanceManager {
  /** Instance states by ID */
  private instances = new Map<string, InstanceState>();

  /**
   * Create or update an instance
   */
  setInstance(instanceId: string, config: InstanceConfig, status: ConnectionStatus): void {
    const existing = this.instances.get(instanceId);

    if (existing) {
      existing.status = status;
      existing.config = config;
      existing.lastActivity = new Date();
    } else {
      this.instances.set(instanceId, {
        instanceId,
        config,
        status,
        createdAt: new Date(),
        lastActivity: new Date(),
      });
    }
  }

  /**
   * Update instance status
   */
  updateStatus(instanceId: string, status: ConnectionStatus): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;

    instance.status = status;
    instance.lastActivity = new Date();
    return true;
  }

  /**
   * Get an instance by ID
   */
  get(instanceId: string): InstanceState | undefined {
    return this.instances.get(instanceId);
  }

  /**
   * Get instance status
   */
  getStatus(instanceId: string): ConnectionStatus | undefined {
    return this.instances.get(instanceId)?.status;
  }

  /**
   * Check if an instance exists
   */
  has(instanceId: string): boolean {
    return this.instances.has(instanceId);
  }

  /**
   * Remove an instance
   */
  remove(instanceId: string): boolean {
    return this.instances.delete(instanceId);
  }

  /**
   * Get all instance IDs
   */
  getAllIds(): string[] {
    return Array.from(this.instances.keys());
  }

  /**
   * Get all connected instance IDs
   */
  getConnectedIds(): string[] {
    return Array.from(this.instances.entries())
      .filter(([, state]) => state.status.state === 'connected')
      .map(([id]) => id);
  }

  /**
   * Get all instances
   */
  getAll(): InstanceState[] {
    return Array.from(this.instances.values());
  }

  /**
   * Get count of instances
   */
  count(): number {
    return this.instances.size;
  }

  /**
   * Get count of connected instances
   */
  connectedCount(): number {
    return this.getConnectedIds().length;
  }

  /**
   * Record activity for an instance
   */
  recordActivity(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.lastActivity = new Date();
    }
  }

  /**
   * Clear all instances
   */
  clear(): void {
    this.instances.clear();
  }
}
