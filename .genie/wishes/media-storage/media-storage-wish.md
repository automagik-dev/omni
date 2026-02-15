# WISH: Media Storage

> Implement S3 storage backend and unify media download behavior across all channels.

**Status:** DRAFT
**Created:** 2026-02-02
**Author:** WISH Agent
**Beads:** omni-t4u, omni-fu8

---

## Context

**Current State:**
- Media stored locally at `./data/media/{instanceId}/{YYYY-MM}/{messageId}.ext`
- WhatsApp downloads media to local storage ✅
- Discord only stores CDN URLs (no local download) ❌
- S3 type stub exists but not implemented
- No CDN integration

**Problems:**
1. Discord CDN URLs can expire → media lost
2. Inconsistent behavior between channels
3. Local storage doesn't scale
4. No redundancy/backup
5. Media processing requires local files

**Goal:** Unified media storage with S3 support and consistent download behavior.

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | S3-compatible API (AWS S3, Cloudflare R2, MinIO) |
| **DEC-1** | Decision | Support both local and S3 storage backends |
| **DEC-2** | Decision | All channels must download to storage (not just keep URLs) |
| **DEC-3** | Decision | Presigned URLs for serving (not proxy through API) |
| **DEC-4** | Decision | R2 preferred over S3 (cheaper egress) |

---

## Scope

### IN SCOPE

- S3 storage backend implementation
- Discord media download (fix omni-fu8)
- Unified MediaStorageService interface
- Presigned URL generation
- Migration tool (local → S3)
- Configuration via env vars

### OUT OF SCOPE

- Media processing (transcription, description) - separate wish
- Video transcoding
- Image optimization/resizing
- Multi-region replication

---

## Execution Group A: Fix Discord Download

**Goal:** Make Discord download media like WhatsApp does.

**Beads:** omni-fu8

**Deliverables:**
- [ ] Update `packages/channel-discord/src/handlers/messages.ts`
- [ ] Download attachments to local storage
- [ ] Store `mediaLocalPath` in message record
- [ ] Keep original `mediaUrl` for reference

**Acceptance Criteria:**
- [ ] Discord attachments saved to `./data/media/`
- [ ] `message.mediaLocalPath` populated
- [ ] Media still accessible if Discord CDN expires

---

## Execution Group B: Storage Interface

**Goal:** Abstract storage behind interface supporting local and S3.

**Deliverables:**
- [ ] `packages/core/src/storage/types.ts` - Storage interface
- [ ] `packages/core/src/storage/local.ts` - Local filesystem (current behavior)
- [ ] `packages/core/src/storage/s3.ts` - S3-compatible storage
- [ ] `packages/core/src/storage/index.ts` - Factory based on config

**Interface:**

```typescript
interface StorageBackend {
  store(key: string, data: Buffer, metadata?: StorageMetadata): Promise<StorageResult>;
  retrieve(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getUrl(key: string, expiresIn?: number): Promise<string>;
  list(prefix: string): AsyncGenerator<StorageItem>;
}

interface StorageMetadata {
  contentType: string;
  filename?: string;
  instanceId?: string;
}

interface StorageResult {
  key: string;
  url: string;  // Public URL or presigned URL
  size: number;
}
```

**Acceptance Criteria:**
- [ ] Can switch between local/S3 via config
- [ ] Same interface for both backends
- [ ] Presigned URLs work for S3

---

## Execution Group C: S3 Implementation

**Goal:** Implement S3-compatible storage backend.

**Deliverables:**
- [ ] `packages/core/src/storage/s3.ts`
- [ ] AWS SDK v3 integration (or lighter client)
- [ ] Multipart upload for large files
- [ ] Presigned URL generation

**Configuration:**

```bash
# Storage backend selection
MEDIA_STORAGE_TYPE=s3  # local | s3

# S3 configuration
S3_BUCKET=omni-media
S3_REGION=auto
S3_ENDPOINT=https://xxx.r2.cloudflarestorage.com  # For R2/MinIO
S3_ACCESS_KEY_ID=xxx
S3_SECRET_ACCESS_KEY=xxx
S3_PUBLIC_URL=https://media.example.com  # CDN URL prefix

# Local fallback
MEDIA_STORAGE_PATH=./data/media
```

**Acceptance Criteria:**
- [ ] Files upload to S3/R2
- [ ] Presigned URLs work for download
- [ ] Large files use multipart upload
- [ ] Works with Cloudflare R2

---

## Execution Group D: Migration & Serving

**Goal:** Migrate existing media and update serving endpoint.

**Deliverables:**
- [ ] Migration script: local → S3
- [ ] Update `/api/v2/media/:instanceId/*` route
- [ ] Redirect to presigned URLs (or proxy for local)

**Migration Script:**

```bash
# Migrate all media to S3
bun run scripts/migrate-media.ts --source local --dest s3

# Migrate specific instance
bun run scripts/migrate-media.ts --instance <id> --source local --dest s3

# Dry run
bun run scripts/migrate-media.ts --dry-run
```

**Serving Logic:**

```typescript
// For S3: Redirect to presigned URL
if (config.storageType === 's3') {
  const url = await storage.getUrl(key, 3600); // 1 hour expiry
  return c.redirect(url, 302);
}

// For local: Serve file directly (current behavior)
return c.body(await storage.retrieve(key));
```

**Acceptance Criteria:**
- [ ] Migration preserves all media
- [ ] Updates `mediaLocalPath` → `mediaStorageKey` in DB
- [ ] Serving endpoint works for both backends
- [ ] No breaking changes to existing URLs

---

## Technical Notes

### Key Format

```
{instanceId}/{YYYY}/{MM}/{messageId}.{ext}

Example:
550e8400-e29b-41d4-a716-446655440000/2026/02/msg-abc123.jpg
```

### R2 vs S3

Cloudflare R2 recommended because:
- Zero egress fees (S3 charges for bandwidth)
- S3-compatible API
- Global distribution via Cloudflare CDN
- Cheaper for read-heavy workloads

### Database Schema Update

```sql
-- Consider adding
ALTER TABLE messages ADD COLUMN media_storage_key TEXT;
ALTER TABLE messages ADD COLUMN media_storage_type VARCHAR(10); -- 'local' | 's3'
```

Or just use `mediaLocalPath` for both (it's really a storage key).

---

## Dependencies

- AWS SDK v3 or compatible client

## Depends On

- None

## Enables

- Scalable media storage
- Media processing pipeline (needs files to process)
- CDN delivery
- Backup/redundancy
