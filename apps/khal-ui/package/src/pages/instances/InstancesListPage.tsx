'use client';

/**
 * Instances list — the entry point of the channels vertical. Each instance is a
 * SectionCard row (avatar, live StatusDot, name, channel + profile in mono, and
 * a production read-only tag) that lifts on hover and opens the per-instance
 * detail. Production instances are tagged so an operator sees, before clicking
 * in, which rows are read-only.
 */
import { Avatar, Button, EmptyState, Note, PillBadge, SectionCard, Spinner, StatusDot } from '@khal-os/ui';
import type { Instance } from '@omni/sdk';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SlackOAuthResult } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { useScope } from '../../app/providers/ScopeProvider';
import { PageShell } from '../../components/PageShell';
import { T } from '../../components/tokens';
import '../../components/runtime-styles';
import { CreateInstanceDialog } from './CreateInstanceDialog';
import { SlackConnectButton } from './SlackConnectButton';
import { SLACK_RETURN_PARAM, channelLabel, isProductionInstance, readSlackReturnNonce } from './instance-helpers';

/** Inline outcome surface — this app shows evidence in the page instead of toasts. */
interface PageNotice {
  type: 'success' | 'warning' | 'error';
  text: string;
}

function slackReturnNotice(result: SlackOAuthResult): PageNotice {
  if (result.status === 'done') return { type: 'success', text: `Slack connected — instance ${result.instanceId}.` };
  if (result.status === 'error')
    return { type: 'error', text: `Slack install failed (${result.code}): ${result.message}` };
  return { type: 'warning', text: 'This Slack install is still finishing, or its result was already read.' };
}

/**
 * Drop only `?slack=<nonce>` from the browser URL so a reload cannot replay a
 * consumed install. The path, the other parameters and the hash are left alone,
 * and the pack's memory router is never navigated — the nonce only ever lived in
 * the browser location, which `useLocation()` cannot see.
 */
function clearSlackReturnParam(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SLACK_RETURN_PARAM)) return;
  url.searchParams.delete(SLACK_RETURN_PARAM);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export function InstancesListPage() {
  const scope = useScope();
  const { ext } = useOmniClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<PageNotice | null>(null);
  const slackReturnHandled = useRef(false);

  // Return leg of the Slack install: the callback redirected the browser back to
  // this page with `?slack=<nonce>`. Read it once, strip it before resolving (a
  // result is single-use), then report the outcome and refresh the list.
  useEffect(() => {
    if (slackReturnHandled.current || typeof window === 'undefined') return;
    const nonce = readSlackReturnNonce(window.location.search);
    if (nonce === null) return;
    slackReturnHandled.current = true;
    clearSlackReturnParam();
    void (async () => {
      try {
        setNotice(slackReturnNotice(await ext.slack.oauthResult(nonce)));
      } catch (err) {
        const text = err instanceof Error ? err.message : 'Could not read the Slack install result.';
        setNotice({ type: 'error', text });
      }
      scope.refreshInstances();
    })();
  }, [ext, scope]);

  const instances = scope.instances;

  return (
    <PageShell
      eyebrow="Channels"
      title="Instances"
      description="Channel instances, their connection status, and per-instance configuration."
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" variant="secondary" onClick={() => scope.refreshInstances()}>
            Refresh
          </Button>
          <SlackConnectButton onError={(text) => setNotice(text === null ? null : { type: 'error', text })} />
          <Button size="small" variant="default" onClick={() => setCreating(true)}>
            New instance
          </Button>
        </div>
      }
    >
      {notice && <Note type={notice.type}>{notice.text}</Note>}

      {scope.instancesError && <Note type="error">{scope.instancesError.message}</Note>}

      {scope.instancesLoading && instances.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spinner />
        </div>
      ) : instances.length === 0 ? (
        <SectionCard padding="lg">
          <EmptyState
            title="No instances yet"
            description="Create one to connect a channel."
            action={
              <Button size="small" variant="default" onClick={() => setCreating(true)}>
                New instance
              </Button>
            }
          />
        </SectionCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {instances.map((inst, i) => (
            <InstanceRow key={inst.id} instance={inst} index={i} onOpen={() => navigate(`/instances/${inst.id}`)} />
          ))}
        </div>
      )}

      <CreateInstanceDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          scope.refreshInstances();
          navigate(`/instances/${id}`);
        }}
      />
    </PageShell>
  );
}

function InstanceRow({ instance, index, onOpen }: { instance: Instance; index: number; onOpen: () => void }) {
  const production = isProductionInstance(instance.id);
  const owner = (instance as { ownerIdentifier?: string | null }).ownerIdentifier ?? null;
  return (
    <SectionCard
      padding="md"
      className="omni-card-hover khal-anim-fade-up"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e: ReactKeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{ cursor: 'pointer', animationDelay: `${index * 50}ms` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <StatusDot state={instance.isActive ? 'active' : 'idle'} size="md" pulse={instance.isActive} />
        <Avatar name={instance.name} size="md" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 650, color: T.fg, letterSpacing: '-0.01em' }}>
              {instance.name}
            </span>
            {instance.isDefault && (
              <PillBadge size="sm" variant="muted">
                default
              </PillBadge>
            )}
            {production && (
              <PillBadge size="sm" variant="muted" dot dotColor={T.warn}>
                prod · read-only
              </PillBadge>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 3, fontSize: 12, color: T.muted, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: T.mono }}>{channelLabel(instance.channel)}</span>
            {instance.profileName && <span>· {instance.profileName}</span>}
            {owner && <span style={{ fontFamily: T.mono }}>· {owner}</span>}
          </div>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
            color: T.secondary,
            flexShrink: 0,
          }}
        >
          Open <span style={{ color: T.accent }}>→</span>
        </span>
      </div>
    </SectionCard>
  );
}
