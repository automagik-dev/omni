# Wish: List Group Members with Names

| Field | Value |
|-------|-------|
| **Status** | APPROVED |
| **Slug** | `group-members-with-names` |
| **Date** | 2026-03-31 |
| **Design** | [DESIGN.md](../../brainstorms/group-members-with-names/DESIGN.md) |
| **Issues** | automagik-dev/omni#308 |

## Summary

Add the ability to list group members with their names via CLI and API. Uses Baileys `groupMetadata()` for WhatsApp, enriched with pushName from contacts cache. Follows the existing `fetchGroups` pattern in the SDK.

## Scope

### IN
- SDK interface: add optional `fetchGroupMembers()` method to `ChannelPlugin`
- WhatsApp plugin: implement using `sock.groupMetadata(jid).participants`
- API route: `GET /instances/:id/groups/:jid/members`
- CLI command: `omni instances group-members <instance> <jid>`

### OUT
- No group management (add/remove) — already exists
- No Telegram/Discord/Slack member listing (follow-up per channel)
- No pagination

## Decisions

| Decision | Rationale |
|----------|-----------|
| Optional SDK method | Only WhatsApp initially |
| No pagination | WhatsApp caps at 1024 members |
| Enrich with pushName | Best name source without extra calls |
| Separate `group-members` subcommand | Cleaner than `--members` flag |

## Success Criteria

- [ ] `omni instances group-members <instance> <jid>` shows members with names
- [ ] API `GET /instances/:id/groups/:jid/members` returns `{ members: [{ id, name, role }] }`
- [ ] Non-WhatsApp instances return 501 Not Supported
- [ ] `bun run build` and `bun test` pass

## Execution Strategy

### Wave 1 (sequential — each layer depends on the previous)
| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | SDK interface + WhatsApp plugin + API route + CLI command |

## Execution Groups

### Group 1: Full stack — SDK to CLI

**Goal:** Add group member listing across all 4 layers.

**Deliverables:**
1. In `packages/channel-sdk/src/types/plugin.ts`: add optional `fetchGroupMembers` method after `fetchGroups`:
   ```ts
   fetchGroupMembers?(
     instanceId: string,
     groupJid: string,
   ): Promise<{
     members: Array<{
       id: string;
       name?: string;
       role?: 'admin' | 'superadmin' | 'member';
     }>;
   }>;
   ```
2. In `packages/channel-whatsapp/src/plugin.ts`: implement `fetchGroupMembers` using `sock.groupMetadata(groupJid)`:
   - Map `metadata.participants` to `{ id: p.id, name: pushName || undefined, role: p.admin || 'member' }`
   - Use existing pushName cache or `platform_identities` for name enrichment
3. In `packages/api/src/routes/v2/instances.ts`: add route `GET /:id/groups/:jid/members`:
   - Follow existing `/groups` pattern for auth/access checks
   - Call `plugin.fetchGroupMembers(instanceId, jid)`
   - Return 501 if plugin doesn't support it
4. In `packages/cli/src/commands/instances.ts`: add `group-members <id> <jid>` subcommand:
   - Call API endpoint
   - Display as table: ID | Name | Role

**Acceptance Criteria:**
- [ ] SDK type compiles and is optional
- [ ] WhatsApp plugin returns participants with names
- [ ] API route returns JSON with members array
- [ ] CLI displays table output
- [ ] `bun run build` succeeds
- [ ] `bun test` passes

**Validation:**
```bash
cd /home/genie/workspace/repos/omni && bun run build 2>&1 | tail -5 && bun test 2>&1 | tail -5
```

**depends-on:** none

---

## Files to Create/Modify

```
packages/channel-sdk/src/types/plugin.ts       # Add fetchGroupMembers interface
packages/channel-whatsapp/src/plugin.ts         # Implement fetchGroupMembers
packages/api/src/routes/v2/instances.ts         # Add GET /:id/groups/:jid/members
packages/cli/src/commands/instances.ts          # Add group-members subcommand
```
