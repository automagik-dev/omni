# WISH: WhatsApp Group Create

> Expose `sock.groupCreate(subject, participants)` as Omni API endpoint + CLI command so agents and users can create WhatsApp groups programmatically.

**Status:** SHIPPED
**Created:** 2026-02-08
**Author:** Omni 🐙
**Requested by:** Helena (CAIFO, Namastex)
**Priority:** HIGH — blocking Helena's C-Level group creation
**Branch:** `feat/group-create`

---

## Context

Helena needs to create a WhatsApp group for the Namastex C-Level team using her instance (`910ab957`). Baileys already supports `sock.groupCreate(subject, participants)` → returns `GroupMetadata`. We just need to expose it through the Omni stack: plugin method → API route → CLI command.

The Baileys API is well-understood (see `docs/BAILEYS-JID-MENTIONS-GROUPS.md`):
```typescript
sock.groupCreate(subject: string, participants: string[]) → Promise<GroupMetadata>
```

Participants must be JIDs (`5511999999999@s.whatsapp.net`). The API/CLI should accept phone numbers and convert automatically.

---

## Scope

### IN SCOPE
- Plugin method: `groupCreate(instanceId, subject, participants)`
- API endpoint: `POST /instances/:id/groups`
- CLI command: `omni instances group-create <instanceId> --subject "Name" --participants "+55..." "+55..."`
- Phone number → JID conversion (automatic, using existing `toJid()`)
- Return full `GroupMetadata` in response (id, subject, participants, owner, etc.)
- Instance access check (`checkInstanceAccess` / `instanceAccess` middleware)

### OUT OF SCOPE
- Group settings management (subject update, description, announce mode, etc.) — separate wish
- Group participant management (add/remove/promote/demote) — separate wish
- Group profile picture — separate wish
- Community creation — separate wish
- LID addressing mode support — tracked separately
- Phone number validation via `onWhatsApp()` before group creation — nice-to-have, not MVP

---

## Execution Groups

### Group 1: Plugin Method

**File:** `packages/channel-whatsapp/src/plugin.ts`

Add `groupCreate` method to `WhatsAppPlugin`:

```typescript
async groupCreate(instanceId: string, subject: string, participants: string[]): Promise<{
  id: string;
  subject: string;
  owner: string | undefined;
  participants: Array<{ id: string; isAdmin?: boolean; isSuperAdmin?: boolean }>;
  creation?: number;
}> {
  const sock = this.getSocket(instanceId);
  const participantJids = participants.map(p => toJid(p));
  const metadata = await sock.groupCreate(subject, participantJids);
  return {
    id: metadata.id,
    subject: metadata.subject,
    owner: metadata.owner,
    participants: metadata.participants.map(p => ({
      id: p.id,
      isAdmin: p.isAdmin,
      isSuperAdmin: p.isSuperAdmin,
    })),
    creation: metadata.creation,
  };
}
```

**Also update:** `packages/channel-whatsapp/src/capabilities.ts` — add `canCreateGroup: true` (if capability tracking exists for this).

### Group 2: API Route

**File:** `packages/api/src/routes/v2/instances.ts`

Add `POST /instances/:id/groups` endpoint:

```typescript
// Schema
const createGroupSchema = z.object({
  subject: z.string().min(1).max(100).describe('Group name/subject'),
  participants: z.array(z.string().min(1)).min(1).describe('Phone numbers or JIDs to add'),
});

// Route
instancesRoutes.post('/:id/groups', instanceAccess, zValidator('json', createGroupSchema), async (c) => {
  const instanceId = c.req.param('id');
  const { subject, participants } = c.req.valid('json');
  const services = c.get('services');

  const { plugin } = await getPluginForInstance(services, c.get('channelRegistry'), instanceId);

  if (typeof (plugin as any).groupCreate !== 'function') {
    throw new ApiError(400, 'UNSUPPORTED', 'This channel does not support group creation');
  }

  const result = await (plugin as any).groupCreate(instanceId, subject, participants);
  return c.json({ data: result }, 201);
});
```

### Group 3: CLI Command

**File:** `packages/cli/src/commands/instances.ts`

Add `group-create` subcommand:

```typescript
instances
  .command('group-create <instanceId>')
  .description('Create a new WhatsApp group')
  .requiredOption('--subject <name>', 'Group name')
  .option('--participants <phones...>', 'Phone numbers to add (space-separated)')
  .action(async (instanceId, opts) => {
    const result = await apiCall(`/instances/${instanceId}/groups`, 'POST', {
      subject: opts.subject,
      participants: opts.participants || [],
    });
    console.log('Group created:');
    console.log(`  ID: ${result.data.id}`);
    console.log(`  Subject: ${result.data.subject}`);
    console.log(`  Participants: ${result.data.participants?.length || 0}`);
  });
```

---

## Validation Commands

```bash
# Typecheck
make typecheck

# Lint
make lint

# Test (no regressions)
bun test --filter "WhatsApp"

# Manual test (requires connected instance)
omni instances group-create 910ab957-362a-41e1-b265-cb26dfd6f522 \
  --subject "C-Level Namastex" \
  --participants "+5511999999999" "+5511888888888"
```

---

## Success Criteria

- [ ] `make typecheck` passes (10/10 packages)
- [ ] `make lint` passes (0 issues)
- [ ] `bun test` — no new test failures
- [ ] `POST /instances/:id/groups` returns `201` with `GroupMetadata`
- [ ] `omni instances group-create` CLI command works
- [ ] Instance access check enforced (non-authorized keys get 403)
- [ ] Phone numbers auto-converted to JIDs
- [ ] Error handling: non-existent numbers, insufficient permissions, WhatsApp limits

---

## Estimated Effort

~30 minutes. Three files, one method each, well-understood Baileys API. Pattern identical to C3 (group invites) which is already shipped.

---

## Dependencies

- Omni API must be running with a connected WhatsApp instance
- Production deploy needed before Helena can use it (SSH access to `10.114.1.118` pending)
