/**
 * WhatsApp Cloud (Meta) — Embedded Signup + Manual connection wizard.
 *
 * Used inside CreateInstanceModal when channel === 'whatsapp-cloud'. Provides
 * two tabs:
 *   1. Embedded Signup — Facebook JS SDK → FB.login(config_id) → backend
 *      exchanges the code for an access token (kept server-side), discovers
 *      WABAs + phone numbers, and returns an opaque `exchangeHandle`. The
 *      user picks a phone, then we POST /connect with the handle (NOT the
 *      raw token, which never crosses the wire after the Meta exchange).
 *   2. Manual — paste accessToken + phoneNumberId + wabaId and POST /connect.
 *
 * Backend routes called (Groups 5+6 of the wish — implemented in parallel):
 *   POST /api/v2/instances/:id/whatsapp-cloud/oauth/exchange
 *   POST /api/v2/instances/:id/whatsapp-cloud/connect
 *
 * Once the omni-side SDK regenerates (`make sdk-generate` after Groups 5+6
 * land), the apiFetch + JSON.parse calls should be replaced with the typed
 * `omni.whatsappCloud.*` wrappers.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFacebookSDK } from '@/hooks/useFacebookSDK';
import { apiFetch } from '@/lib/sdk';
import { cn } from '@/lib/utils';
import { AlertCircle, Check, Phone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Local types — these mirror packages/core/src/schemas/whatsapp-cloud.ts
// (EmbeddedSignupExchangeResponseSchema, WhatsAppBusinessConnectRequestSchema).
// TODO: replace with `import type { ... } from '@omni/sdk'` after make sdk-generate.
// ---------------------------------------------------------------------------

interface DiscoveredPhoneNumber {
  phone_number_id: string;
  wabaId: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
}

interface ExchangeResponse {
  /**
   * Opaque single-use handle (format `eshandle_<uuid>`) that resolves
   * server-side to the long-lived Meta token. The raw token never crosses
   * the wire — pass this handle to `/connect`. TTL ~5 min.
   */
  exchangeHandle: string;
  wabaIds: string[];
  phoneNumbers: DiscoveredPhoneNumber[];
}

interface ConnectResponse {
  status: 'connected' | string;
  displayPhoneNumber?: string;
  qualityRating?: string;
}

// ---------------------------------------------------------------------------
// Config — embedded signup needs an App ID + config_id. We pull from Vite env
// for now; long-term, the backend should expose /whatsapp-cloud/app-config.
// ---------------------------------------------------------------------------

const META_APP_ID = (import.meta.env.VITE_META_APP_ID as string | undefined) ?? '';
const META_CONFIG_ID = (import.meta.env.VITE_META_EMBEDDED_SIGNUP_CONFIG_ID as string | undefined) ?? '';

// ---------------------------------------------------------------------------

interface WhatsAppBusinessConnectProps {
  instanceId: string;
  onConnected: (result: ConnectResponse) => void;
}

type EmbeddedStep = 'idle' | 'awaiting_popup' | 'exchanging' | 'choose_number' | 'connecting' | 'connected';

export function WhatsAppBusinessConnect({ instanceId, onConnected }: WhatsAppBusinessConnectProps) {
  return (
    <Tabs defaultValue="embedded">
      <TabsList className="w-full">
        <TabsTrigger value="embedded" className="flex-1">
          Embedded Signup
        </TabsTrigger>
        <TabsTrigger value="manual" className="flex-1">
          Manual
        </TabsTrigger>
      </TabsList>

      <TabsContent value="embedded">
        <EmbeddedSignupPanel instanceId={instanceId} onConnected={onConnected} />
      </TabsContent>

      <TabsContent value="manual">
        <ManualConnectPanel instanceId={instanceId} onConnected={onConnected} />
      </TabsContent>
    </Tabs>
  );
}

// ===========================================================================
// Embedded Signup panel
// ===========================================================================

function EmbeddedSignupPanel({
  instanceId,
  onConnected,
}: {
  instanceId: string;
  onConnected: (result: ConnectResponse) => void;
}) {
  const { isLoaded, isLoading, error: sdkError, loginWithEmbeddedSignup } = useFacebookSDK(META_APP_ID || undefined);

  const [step, setStep] = useState<EmbeddedStep>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [phones, setPhones] = useState<DiscoveredPhoneNumber[]>([]);
  // Opaque single-use handle from /oauth/exchange — server-side resolves it
  // to the long-lived Meta token on /connect. Raw token never lives in the
  // browser. TTL ~5 min (see packages/api/src/lib/oauth-token-cache.ts).
  const [exchangeHandle, setExchangeHandle] = useState<string>('');
  const [selectedPhoneId, setSelectedPhoneId] = useState<string>('');

  // Capture session info posted by the Facebook popup
  useEffect(() => {
    const sessionInfo: { phone_number_id?: string; waba_id?: string } = {};
    const handleMessage = (event: MessageEvent) => {
      if (!event.origin.includes('facebook.com')) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type === 'WA_EMBEDDED_SIGNUP') {
          const info = data.data;
          if (info?.phone_number_id) sessionInfo.phone_number_id = String(info.phone_number_id);
          if (info?.waba_id) sessionInfo.waba_id = String(info.waba_id);
        }
      } catch {
        // ignore non-JSON messages
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleLogin = useCallback(async () => {
    setErrorMessage('');
    if (!META_CONFIG_ID) {
      setErrorMessage('VITE_META_EMBEDDED_SIGNUP_CONFIG_ID is not configured. Use the Manual tab instead.');
      return;
    }
    if (!isLoaded) {
      setErrorMessage('Facebook SDK not loaded yet.');
      return;
    }

    setStep('awaiting_popup');
    try {
      const response = await loginWithEmbeddedSignup(META_CONFIG_ID);
      const code = response.authResponse?.code;
      if (!code) {
        setStep('idle');
        setErrorMessage(
          response.status === 'unknown'
            ? 'Popup blocked or closed. Allow popups for this site and try again.'
            : 'Authorization cancelled. Please try again.',
        );
        return;
      }

      // Exchange code for access token + discover phone numbers
      setStep('exchanging');
      // TODO: switch to omni.whatsappCloud.exchangeCode(...) after make sdk-generate
      const res = await apiFetch(`/instances/${instanceId}/whatsapp-cloud/oauth/exchange`, {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Exchange failed: ${res.status}`);
      }
      const data: ExchangeResponse = await res.json();

      if (!data.phoneNumbers || data.phoneNumbers.length === 0) {
        setStep('idle');
        setErrorMessage('No phone numbers were discovered on this WhatsApp Business Account.');
        return;
      }

      setExchangeHandle(data.exchangeHandle);
      setPhones(data.phoneNumbers);
      setSelectedPhoneId(data.phoneNumbers[0]?.phone_number_id ?? '');
      setStep('choose_number');
    } catch (err) {
      setStep('idle');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to exchange OAuth code.');
    }
  }, [instanceId, isLoaded, loginWithEmbeddedSignup]);

  const handleConfirmNumber = useCallback(async () => {
    const phone = phones.find((p) => p.phone_number_id === selectedPhoneId);
    if (!phone) {
      setErrorMessage('Please pick a phone number.');
      return;
    }
    setErrorMessage('');
    setStep('connecting');

    try {
      // TODO: switch to omni.whatsappCloud.connect(...) after make sdk-generate
      const res = await apiFetch(`/instances/${instanceId}/whatsapp-cloud/connect`, {
        method: 'POST',
        body: JSON.stringify({
          exchangeHandle,
          phoneNumberId: phone.phone_number_id,
          wabaId: phone.wabaId,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Connect failed: ${res.status}`);
      }
      const data: ConnectResponse = await res.json();
      setStep('connected');
      onConnected(data);
    } catch (err) {
      setStep('choose_number');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to connect WhatsApp Cloud.');
    }
  }, [exchangeHandle, instanceId, onConnected, phones, selectedPhoneId]);

  // --- Render -------------------------------------------------------------

  if (sdkError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm text-destructive">{sdkError}</p>
        <p className="mt-2 text-xs text-muted-foreground">Use the Manual tab to paste credentials instead.</p>
      </div>
    );
  }

  if (!META_APP_ID) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
        <p className="text-sm font-medium">Embedded Signup is not configured.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Set <code className="font-mono">VITE_META_APP_ID</code> and{' '}
          <code className="font-mono">VITE_META_EMBEDDED_SIGNUP_CONFIG_ID</code> in your <code>.env</code>, or use the
          Manual tab.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      {step === 'connected' && (
        <div className="flex flex-col items-center space-y-2 py-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
            <Check className="h-6 w-6 text-green-500" />
          </div>
          <p className="font-medium">Connected to WhatsApp Cloud</p>
        </div>
      )}

      {step === 'choose_number' && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Pick the phone number to connect</p>
          <div className="space-y-2">
            {phones.map((phone) => {
              const selected = phone.phone_number_id === selectedPhoneId;
              return (
                <button
                  key={phone.phone_number_id}
                  type="button"
                  onClick={() => setSelectedPhoneId(phone.phone_number_id)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                    selected ? 'border-primary bg-primary/5' : 'hover:border-primary/40 hover:bg-accent',
                  )}
                >
                  <div
                    className={cn(
                      'mt-0.5 flex h-8 w-8 items-center justify-center rounded-full',
                      selected ? 'bg-primary/15' : 'bg-muted',
                    )}
                  >
                    <Phone className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{phone.display_phone_number ?? phone.phone_number_id}</p>
                    <p className="text-xs text-muted-foreground">
                      {phone.verified_name ?? 'Unverified'} {phone.quality_rating ? `· ${phone.quality_rating}` : ''}
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      WABA {phone.wabaId} · PNID {phone.phone_number_id}
                    </p>
                  </div>
                  {selected && <Check className="h-5 w-5 text-primary" />}
                </button>
              );
            })}
          </div>
          {errorMessage && <ErrorAlert message={errorMessage} />}
          <Button onClick={handleConfirmNumber} className="w-full" disabled={!selectedPhoneId}>
            Connect this number
          </Button>
        </div>
      )}

      {(step === 'idle' || step === 'awaiting_popup' || step === 'exchanging' || step === 'connecting') && (
        <div className="space-y-3">
          <Button
            onClick={handleLogin}
            disabled={!isLoaded || step !== 'idle'}
            className="w-full bg-[#1877F2] text-white hover:bg-[#1565d8]"
            size="lg"
          >
            {step === 'awaiting_popup' && (
              <>
                <Spinner size="sm" className="mr-2 text-white" />
                Waiting for authorization...
              </>
            )}
            {step === 'exchanging' && (
              <>
                <Spinner size="sm" className="mr-2 text-white" />
                Exchanging credentials...
              </>
            )}
            {step === 'connecting' && (
              <>
                <Spinner size="sm" className="mr-2 text-white" />
                Connecting...
              </>
            )}
            {step === 'idle' && (isLoading ? 'Loading Facebook SDK...' : 'Continue with Facebook')}
          </Button>
          <p className="text-xs text-muted-foreground">
            We'll open Meta's Embedded Signup in a popup. Allow popups for this site.
          </p>
          {errorMessage && <ErrorAlert message={errorMessage} />}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Manual panel
// ===========================================================================

function ManualConnectPanel({
  instanceId,
  onConnected,
}: {
  instanceId: string;
  onConnected: (result: ConnectResponse) => void;
}) {
  const [form, setForm] = useState({ accessToken: '', phoneNumberId: '', wabaId: '' });
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [connected, setConnected] = useState(false);

  const isValid = form.accessToken.trim() && form.phoneNumberId.trim() && form.wabaId.trim();

  const handleSubmit = useCallback(async () => {
    if (!isValid || submitting) return;
    setErrorMessage('');
    setSubmitting(true);
    try {
      // TODO: switch to omni.whatsappCloud.connect(...) after make sdk-generate
      const res = await apiFetch(`/instances/${instanceId}/whatsapp-cloud/connect`, {
        method: 'POST',
        body: JSON.stringify({
          accessToken: form.accessToken.trim(),
          phoneNumberId: form.phoneNumberId.trim(),
          wabaId: form.wabaId.trim(),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Connect failed: ${res.status}`);
      }
      const data: ConnectResponse = await res.json();
      setConnected(true);
      onConnected(data);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to connect WhatsApp Cloud.');
    } finally {
      setSubmitting(false);
    }
  }, [form, instanceId, isValid, onConnected, submitting]);

  if (connected) {
    return (
      <div className="flex flex-col items-center space-y-2 py-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
          <Check className="h-6 w-6 text-green-500" />
        </div>
        <p className="font-medium">Connected to WhatsApp Cloud</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-4">
      <div className="space-y-2">
        <label htmlFor="wac-token" className="text-sm font-medium">
          Access Token
        </label>
        <Input
          id="wac-token"
          type="password"
          autoComplete="off"
          value={form.accessToken}
          onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
          placeholder="Paste your System User token (long-lived)"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="wac-phone-id" className="text-sm font-medium">
          Phone Number ID
        </label>
        <Input
          id="wac-phone-id"
          value={form.phoneNumberId}
          onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })}
          placeholder="e.g. 123456789012345"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="wac-waba-id" className="text-sm font-medium">
          WABA ID
        </label>
        <Input
          id="wac-waba-id"
          value={form.wabaId}
          onChange={(e) => setForm({ ...form, wabaId: e.target.value })}
          placeholder="WhatsApp Business Account ID"
        />
      </div>

      {errorMessage && <ErrorAlert message={errorMessage} />}

      <Button onClick={handleSubmit} disabled={!isValid || submitting} className="w-full">
        {submitting ? (
          <>
            <Spinner size="sm" className="mr-2" />
            Connecting...
          </>
        ) : (
          'Connect'
        )}
      </Button>
    </div>
  );
}

// ===========================================================================
// Helpers
// ===========================================================================

function ErrorAlert({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <p className="break-words">{message}</p>
    </div>
  );
}
