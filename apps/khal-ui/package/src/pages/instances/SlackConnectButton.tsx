'use client';

/**
 * Starts the one-click personal Slack install from the instances page.
 *
 * One click posts `POST /slack/oauth/start` (entry `ui`, mode `user`) through the
 * BFF and hands the browser to the Slack authorize URL it returns. Slack sends
 * the person back to `<returnTo>?slack=<nonce>`, which {@link InstancesListPage}
 * finishes; nothing here talks to a Slack host and no credential value is read,
 * rendered or logged.
 *
 * `returnTo` is this page's origin + pathname only. The API's allowlist refuses a
 * `returnTo` carrying a query or fragment (it appends `?slack=<nonce>` itself)
 * and accepts an absolute URL only on the `server.public_url` origin — when the
 * dashboard is served elsewhere the start call answers 400 and that message is
 * surfaced by the page. The pack mounts a memory router, so the browser location,
 * not `useLocation()`, is the only place this address lives.
 *
 * When the deployment has no Slack app registered the control is disabled and
 * names the settings keys still missing, via the pure helper in
 * `instance-helpers.ts`.
 */
import { Button } from '@khal-os/ui';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { slackMissingKeysText } from './instance-helpers';

const MISSING_KEYS_HINT_ID = 'slack-connect-missing-keys';

/** Where Slack should return to: this page's origin + path, never its query or hash. */
function currentReturnTo(): string | null {
  if (typeof window === 'undefined') return null;
  return `${window.location.origin}${window.location.pathname}`;
}

export interface SlackConnectButtonProps {
  /** Reports a failed start (or clears a stale notice) to the page's inline surface. */
  onError: (message: string | null) => void;
}

export function SlackConnectButton({ onError }: SlackConnectButtonProps) {
  const { ext } = useOmniClient();
  const status = useOmniQuery(['slack', 'app'], () => ext.slack.appStatus(), { staleTime: 30_000 });
  const start = useOmniMutation({
    mutationFn: (returnTo: string) => ext.slack.oauthStart({ mode: 'user', entry: 'ui', returnTo }),
  });

  const app = status.data;
  // Why the control is disabled: the missing settings keys (from the pure helper)
  // or, if the status read itself failed, that failure — never a dead button
  // with no explanation.
  const missingKeysHint = app && !app.configured ? slackMissingKeysText(app.missing) : null;
  const hint = missingKeysHint ?? (status.error instanceof Error ? status.error.message : null);

  const connect = async () => {
    const returnTo = currentReturnTo();
    if (returnTo === null) return;
    onError(null);
    try {
      const { authorizeUrl } = await start.mutateAsync(returnTo);
      window.location.assign(authorizeUrl);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not start the Slack install.');
    }
  };

  return (
    <>
      <Button
        size="small"
        variant="secondary"
        disabled={!app?.configured || start.isPending}
        loading={start.isPending}
        title={hint ?? undefined}
        aria-describedby={hint ? MISSING_KEYS_HINT_ID : undefined}
        onClick={() => void connect()}
      >
        Connect Slack
      </Button>
      {hint && (
        <span
          id={MISSING_KEYS_HINT_ID}
          style={{ alignSelf: 'center', maxWidth: 300, fontSize: 11, lineHeight: 1.35, color: T.muted }}
        >
          {hint}
        </span>
      )}
    </>
  );
}
