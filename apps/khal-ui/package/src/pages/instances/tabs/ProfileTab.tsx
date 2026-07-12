'use client';

/**
 * Profile tab: edit the connected profile (name / status / picture), view the
 * channel privacy settings, and — for Discord — set the bot presence. Writes are
 * blocked on production; the privacy view is read-only everywhere.
 */
import { Note } from '@khal-os/ui';
import { useState } from 'react';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import { JsonInspector } from '../../../components/JsonInspector';
import { T } from '../../../components/tokens';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { ActionButton, Panel, ToolRow } from '../components';
import { type InstanceTabProps, PRODUCTION_GUARD_REASON } from '../tab-types';

const PRESENCE_STATUSES = ['online', 'dnd', 'idle', 'invisible'];

const fieldStyle = {
  padding: '7px 10px',
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.surface,
  color: T.fg,
  fontSize: 13,
} as const;

export function ProfileTab({ instance, isProduction }: InstanceTabProps) {
  const id = instance.id;
  const guard = isProduction ? PRODUCTION_GUARD_REASON : undefined;
  const isDiscord = instance.channel === 'discord';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <ProfileEdits instanceId={id} instanceName={instance.name} guard={guard} />
      <Privacy instanceId={id} />
      {isDiscord && <Presence instanceId={id} instanceName={instance.name} guard={guard} />}
    </div>
  );
}

function ProfileEdits({
  instanceId,
  instanceName,
  guard,
}: {
  instanceId: string;
  instanceName: string;
  guard?: string;
}) {
  const { ext } = useOmniClient();
  return (
    <Panel title="Profile" description="Update the connected account's name, status, and picture.">
      <ToolRow
        label="Display name"
        placeholder="new display name"
        buttonLabel="Save name"
        effect="live"
        targetName={instanceName}
        targetId={instanceId}
        disabledReason={guard}
        run={(value) => ext.instances.setProfileName(instanceId, value)}
      />
      <ToolRow
        label="Status / bio"
        placeholder="new status text"
        buttonLabel="Save status"
        effect="live"
        targetName={instanceName}
        targetId={instanceId}
        disabledReason={guard}
        run={(value) => ext.instances.setProfileStatus(instanceId, value)}
      />
      <ToolRow
        label="Picture (base64)"
        placeholder="data URL or base64 JPEG"
        buttonLabel="Save picture"
        effect="live"
        targetName={instanceName}
        targetId={instanceId}
        disabledReason={guard}
        run={(value) => ext.instances.setProfilePicture(instanceId, value)}
      />
      <ActionButton
        label="Delete picture"
        effect="live"
        destructive
        targetName={instanceName}
        targetId={instanceId}
        disabledReason={guard}
        run={() => ext.instances.deleteProfilePicture(instanceId)}
      />
    </Panel>
  );
}

function Privacy({ instanceId }: { instanceId: string }) {
  const { ext } = useOmniClient();
  const privacy = useOmniQuery(['instances', instanceId, 'privacy'], () => ext.instances.privacy(instanceId));
  return (
    <Panel title="Privacy" description="Channel privacy settings (read-only).">
      {privacy.error && <Note type="error">{(privacy.error as Error).message}</Note>}
      {privacy.data && <JsonInspector value={privacy.data.data ?? privacy.data} />}
      {privacy.isLoading && <span style={{ fontSize: 12, color: T.muted }}>Loading…</span>}
    </Panel>
  );
}

function Presence({ instanceId, instanceName, guard }: { instanceId: string; instanceName: string; guard?: string }) {
  const { ext } = useOmniClient();
  const [status, setStatus] = useState('online');
  const [activityText, setActivityText] = useState('');
  return (
    <Panel title="Presence (Discord)" description="Set the bot's presence and activity.">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...fieldStyle, minWidth: 140 }}>
          {PRESENCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          value={activityText}
          placeholder="activity text (optional)"
          onChange={(e) => setActivityText(e.target.value)}
          style={{ ...fieldStyle, minWidth: 200 }}
        />
        <ActionButton
          label="Set presence"
          effect="live"
          targetName={instanceName}
          targetId={instanceId}
          disabledReason={guard}
          run={() =>
            ext.instances.setPresence(instanceId, {
              status,
              activityText: activityText.trim() || undefined,
            })
          }
        />
      </div>
    </Panel>
  );
}
