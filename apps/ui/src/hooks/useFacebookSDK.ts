/**
 * Lazy-load the Facebook JavaScript SDK and expose a typed wrapper around
 * `FB.login()` for the WhatsApp Cloud Embedded Signup flow.
 *
 * Ported from TalkFlow (talkflow_frontend/src/hooks/useFacebookSDK.ts).
 * Adapted for Omni: React 18, no MUI, returns a `loginWithEmbeddedSignup()`
 * helper that wraps the FB.login config_id pattern.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Facebook SDK types — minimal subset of the global FB SDK surface we use
// ---------------------------------------------------------------------------

export interface FBLoginResponse {
  status: 'connected' | 'not_authorized' | 'unknown';
  authResponse?: {
    accessToken?: string;
    code?: string;
    userID?: string;
    expiresIn?: number;
    signedRequest?: string;
  };
}

export interface FBLoginOptions {
  config_id?: string;
  response_type?: string;
  override_default_response_type?: boolean;
  scope?: string;
  extras?: {
    setup?: Record<string, unknown>;
    featureType?: string;
    sessionInfoVersion?: string | number;
    version?: string;
  };
}

declare global {
  interface Window {
    fbAsyncInit?: () => void;
    FB?: {
      init: (params: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }) => void;
      login: (callback: (response: FBLoginResponse) => void, options?: FBLoginOptions) => void;
      getLoginStatus: (callback: (response: FBLoginResponse) => void) => void;
    };
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseFacebookSDKReturn {
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  /**
   * Trigger FB.login() with a Meta `config_id` (Embedded Signup).
   * Returns the full FB login response (which contains `authResponse.code`
   * to be POSTed to the backend for token exchange).
   */
  loginWithEmbeddedSignup: (configId: string) => Promise<FBLoginResponse>;
}

const SDK_VERSION = 'v25.0';
const SDK_SCRIPT_ID = 'facebook-jssdk';
const SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';

/**
 * Lazy-load the Facebook JS SDK.
 *
 * Pass `undefined` (or empty) `appId` while you're still loading the value
 * from the backend — the hook will wait until appId is available.
 */
export function useFacebookSDK(appId?: string): UseFacebookSDKReturn {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    // Prevent double-init under React StrictMode
    if (initRef.current) return;

    // appId not yet available — wait for it
    if (!appId) return;

    initRef.current = true;

    // SDK already on window (page-back navigation)
    if (typeof window !== 'undefined' && window.FB) {
      setIsLoaded(true);
      return;
    }

    // Script already injected but FB not yet initialized — poll until ready
    if (document.getElementById(SDK_SCRIPT_ID)) {
      const checkInterval = window.setInterval(() => {
        if (window.FB) {
          setIsLoaded(true);
          setIsLoading(false);
          window.clearInterval(checkInterval);
        }
      }, 100);
      const timeout = window.setTimeout(() => {
        window.clearInterval(checkInterval);
        if (!window.FB) {
          setError('Timed out loading Facebook SDK');
          setIsLoading(false);
        }
      }, 15000);
      return () => {
        window.clearInterval(checkInterval);
        window.clearTimeout(timeout);
      };
    }

    setIsLoading(true);

    window.fbAsyncInit = () => {
      window.FB?.init({
        appId,
        cookie: true,
        xfbml: true,
        version: SDK_VERSION,
      });
      setIsLoaded(true);
      setIsLoading(false);
    };

    const script = document.createElement('script');
    script.id = SDK_SCRIPT_ID;
    script.src = SDK_SRC;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      setError('Failed to load Facebook SDK. Check your network connection.');
      setIsLoading(false);
    };

    document.head.appendChild(script);
  }, [appId]);

  const loginWithEmbeddedSignup = useCallback((configId: string): Promise<FBLoginResponse> => {
    return new Promise((resolve, reject) => {
      if (!window.FB) {
        reject(new Error('Facebook SDK not loaded'));
        return;
      }
      if (!configId) {
        reject(new Error('Missing Embedded Signup config_id'));
        return;
      }
      window.FB.login(
        (response) => {
          resolve(response);
        },
        {
          config_id: configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: 'whatsapp_business_app_onboarding',
            sessionInfoVersion: '3',
            version: 'v3',
          },
        },
      );
    });
  }, []);

  return { isLoaded, isLoading, error, loginWithEmbeddedSignup };
}
