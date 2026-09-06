/**
 * Microsoft Teams-specific types for the channel plugin
 */

export type MsTeamsAppType = 'MultiTenant' | 'SingleTenant' | 'UserAssignedMsi';

export interface MsTeamsConfig {
  appId: string;
  appPassword: string;
  appType?: MsTeamsAppType;
  tenantId?: string;
}
