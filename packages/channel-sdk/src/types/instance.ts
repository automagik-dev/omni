/**
 * Instance configuration and connection status types
 */

/**
 * Configuration for connecting a channel instance
 */
export interface InstanceConfig {
  /** Instance identifier */
  instanceId: string;

  /** Channel-specific credentials */
  credentials: Record<string, unknown>;

  /** Channel-specific options */
  options?: Record<string, unknown>;

  /** Webhook URL for this instance (if applicable) */
  webhookUrl?: string;
}

/**
 * Connection status for a channel instance
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/**
 * Connection status response
 */
export interface ConnectionStatus {
  /** Current connection state */
  state: ConnectionState;

  /** When the current state was entered */
  since: Date;

  /** Human-readable status message */
  message?: string;

  /** Error details if state is 'error' */
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };

  /** Connection metadata */
  metadata?: {
    /** Profile name on the platform */
    profileName?: string;
    /** Profile picture URL */
    profilePicUrl?: string;
    /** Phone number or identifier */
    ownerIdentifier?: string;
  };

  /** QR code if waiting for scan (e.g., WhatsApp) */
  qrCode?: {
    code: string;
    expiresAt: Date;
  };
}

/**
 * Internal instance state tracked by the SDK
 */
export interface InstanceState {
  /** Instance identifier */
  instanceId: string;

  /** Current connection status */
  status: ConnectionStatus;

  /** Configuration used to connect */
  config: InstanceConfig;

  /** When the instance was created */
  createdAt: Date;

  /** Last activity timestamp */
  lastActivity: Date;
}
