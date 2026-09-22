'use client';

/**
 * Operator view of the deployment's Slack app — the read side of the one-click
 * personal install (wish: slack-personal-oauth).
 *
 * It shows whether the app is configured, which of the five settings keys are
 * still unset, the OAuth redirect URL, and the manifest link the API builds for
 * creating the app in Slack. It is read-only by construction: selecting a key
 * calls {@link SlackAppCardProps.onSelectKey}, which opens the settings page's own
 * editor, so the secret masking and the empty-value guard stay in one place. No
 * setting value is rendered here — the three secrets read back masked from the
 * API and never reach this card.
 */
import { Button, Note, PillBadge, Spinner, StatusDot } from '@khal-os/ui';
import type { SlackAppStatus } from '../../api/ext';
import { T } from '../../components/tokens';
import { CardSection, DataRowList } from './shared';

/** The five keys the install reads, in the order `omni slack app setup` fills them. */
const SLACK_APP_KEYS = [
  'slack.app.client_id',
  'slack.app.client_secret',
  'slack.app.signing_secret',
  'slack.app.app_token',
  'server.public_url',
] as const;

export interface SlackAppCardProps {
  /** `GET /slack/app`, or undefined while it loads or fails. */
  status: SlackAppStatus | undefined;
  loading: boolean;
  error: string | null;
  /** Hands the key to the page's existing key-selection/editor path. */
  onSelectKey: (key: string) => void;
}

function manifestLink(manifestUrl: string | null) {
  if (manifestUrl === null) return 'set server.public_url first';
  return (
    <a
      href={manifestUrl}
      target="_blank"
      rel="noreferrer"
      style={{ color: T.accentBlue, fontSize: 13, textDecoration: 'none', fontFamily: T.mono }}
    >
      → create the app in Slack
    </a>
  );
}

function statusRow(status: SlackAppStatus | undefined) {
  if (!status) return { label: 'App', value: '—' };
  const value = status.configured ? 'configured' : `not configured — ${status.missing.length} of 5 settings missing`;
  return { label: 'App', value, statusDot: true, dotColor: status.configured ? T.ok : T.warn };
}

export function SlackAppCard({ status, loading, error, onSelectKey }: SlackAppCardProps) {
  const missing = new Set(status?.missing ?? []);

  return (
    <CardSection
      title="Slack app (one-click install)"
      description="One Slack app per deployment drives the Connect Slack button on the instances page. Select a key to edit it in the editor below; secret values are masked by the API and never shown here."
    >
      {error && (
        <Note type="error" label="Error">
          {error}
        </Note>
      )}
      {loading && !status ? (
        <Spinner size="sm" />
      ) : (
        <DataRowList
          rows={[
            statusRow(status),
            { label: 'Redirect URL', value: status?.redirectUrl ?? 'set server.public_url first' },
            { label: 'App manifest', value: manifestLink(status?.manifestUrl ?? null) },
          ]}
        />
      )}

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {SLACK_APP_KEYS.map((key) => {
          const unset = missing.has(key);
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusDot state={status === undefined ? 'idle' : unset ? 'error' : 'active'} size="sm" />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: T.mono,
                  fontSize: 12.5,
                  color: T.fg,
                  wordBreak: 'break-all',
                }}
              >
                {key}
              </span>
              {status !== undefined && (
                <PillBadge size="sm" variant="muted">
                  {unset ? 'missing' : 'set'}
                </PillBadge>
              )}
              <Button size="small" variant="secondary" onClick={() => onSelectKey(key)}>
                {unset ? 'Set' : 'Edit'}
              </Button>
            </div>
          );
        })}
      </div>
    </CardSection>
  );
}
