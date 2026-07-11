---
title: "Remote Media Mode (S3/MinIO)"
created: 2026-07-03
updated: 2026-07-04
tags: [media, storage, s3, minio, remote, presigned-url]
status: current
---

# Remote Media Mode (S3/MinIO)

> Omni stores ingested media (images, audio, video, documents) in one of two
> backends. `local` keeps bytes on the API pod's disk; `remote` offloads them to
> an S3-compatible object store (AWS S3, MinIO, ...) and hands agents short-lived
> **presigned URLs** instead of local paths. This page is the engineering-internal
> reference for the remote backend.

> Related: [[processing|Media Processing Pipeline]]

## Overview

The backend is selected by `OMNI_MEDIA_MODE` and resolved once at boot by
`resolveMediaBackendConfig` in
`packages/channel-sdk/src/media-backends/config.ts`.

- **`local` (default)** — unchanged legacy behavior. Media is written under
  `MEDIA_STORAGE_PATH` and referenced by an on-disk path.
- **`remote`** — media is uploaded to S3 under a stable key
  (`<instanceId>/<yyyy-mm>/<messageId>.<ext>`). The **key**, never a URL, is what
  gets persisted to `messages.mediaLocalPath`. At dispatch time the key is turned
  into a **presigned GET URL** with a bounded TTL and delivered to the agent as
  `ProviderFile.url`.

Remote mode fails **loudly** on boot: if `OMNI_MEDIA_MODE=remote` but any of
`OMNI_MEDIA_S3_BUCKET`, `OMNI_MEDIA_S3_ACCESS_KEY`, or `OMNI_MEDIA_S3_SECRET_KEY`
is missing, the API throws rather than silently falling back to local disk. This
prevents a misconfigured deployment from writing media to an ephemeral pod
filesystem it will later lose.

The mode value itself is validated the same way: only `local` and `remote` are
accepted (unset defaults to `local`). Any other value — `s3`, `minio`, `aws`,
a typo — throws on boot instead of silently selecting local disk. All
`OMNI_MEDIA_*` parsing goes through a Zod schema in
`packages/channel-sdk/src/media-backends/config.ts`.

## Configuration (`OMNI_MEDIA_*`)

| Var | Default | Purpose |
|-----|---------|---------|
| `OMNI_MEDIA_MODE` | `local` | `local` \| `remote`. Selects the backend. Any other value **throws on boot**. |
| `OMNI_MEDIA_S3_ENDPOINT` | _(empty)_ | S3-compatible endpoint (e.g. `http://minio:9000`). Empty → real AWS S3, derived from region. |
| `OMNI_MEDIA_S3_PUBLIC_ENDPOINT` | _(empty)_ | Optional externally-reachable endpoint used **only** to generate presigned GET URLs. Uploads/reads keep using `OMNI_MEDIA_S3_ENDPOINT`. Empty → presign with `OMNI_MEDIA_S3_ENDPOINT`. |
| `OMNI_MEDIA_S3_BUCKET` | — | Bucket name. **Required** in remote mode. |
| `OMNI_MEDIA_S3_REGION` | `us-east-1` | AWS region for SigV4 signing. |
| `OMNI_MEDIA_S3_ACCESS_KEY` | — | Access key id. **Required** in remote mode. |
| `OMNI_MEDIA_S3_SECRET_KEY` | — | Secret key. **Required** in remote mode. |
| `OMNI_MEDIA_S3_FORCE_PATH_STYLE` | `true` | Path-style addressing. MinIO/self-hosted need `true`; real AWS S3 wants `false`. |
| `OMNI_MEDIA_S3_PRESIGN_TTL_SECONDS` | `3600` | Default lifetime of a presigned GET URL, in seconds. |

Booleans accept `1/true/yes/on` and `0/false/no/off`. `PRESIGN_TTL_SECONDS`
falls back to the default for non-positive or unparseable values.

## Dispatch behavior: presigned URLs and TTL

Presigning happens **at dispatch time**, not at ingest time, so URLs are minted
fresh and expire quickly:

- **Image / video / document** — the stored S3 key is presigned into a GET URL
  and emitted as `ProviderFile.url` (with no `path`). The URL is valid for
  `OMNI_MEDIA_S3_PRESIGN_TTL_SECONDS` and is rejected by the store once it
  expires. In local mode the same code path emits `ProviderFile.path` (no url).
- **Audio** — stays **URL-less**. Audio is not handed to the agent as a link;
  the media-processor reads the bytes back from S3 and transcribes them, so the
  agent receives transcript text. (Vision similarly reads image bytes from S3 in
  remote mode.) This is why the dispatch path excludes audio from presigned
  files.

The presigned URL retrieves the exact stored bytes with the original
content-type; once the TTL elapses the object store returns a `4xx`.

When the agent runtime lives outside the cluster/network that hosts the object
store, set `OMNI_MEDIA_S3_PUBLIC_ENDPOINT` to the externally-reachable host
(e.g. an Ingress/LoadBalancer in front of MinIO). Presigned URLs are then
signed against that host, while the API keeps uploading/reading through
`OMNI_MEDIA_S3_ENDPOINT`. Without it, a URL like `http://minio:9000/…` is only
fetchable by co-located workloads.

## Kubernetes default: remote + bundled MinIO

The Helm chart (`deploy/helm/omni`) is built for remote mode as the intended
production/dev-stack posture:

- The **dev overlay** turns on a **bundled MinIO** (`minio.enabled=true`) and
  sets `media.mode=remote`, giving a self-contained k8s stack with no external
  dependencies. A bootstrap Job creates the `omni-media` bucket idempotently.
- The **base `values.yaml`** ships `media.mode=local` and `minio.enabled=false`
  (no unused workload); the S3 env is only rendered when `media.mode=remote`.
  The `OMNI_MEDIA_S3_*` env is wired from `media.s3.*`.

### Pointing at external (managed) S3

For production, keep the bundled MinIO **off** and point at a managed bucket:

```yaml
media:
  mode: remote
  s3:
    bucket: my-prod-omni-media
    region: eu-west-1
    endpoint: ""                 # empty → AWS S3 derived from region
    forcePathStyle: false        # real AWS S3 uses virtual-hosted-style
    existingSecret: omni-media-s3 # Secret holding the two creds keys
    accessKeyKey: OMNI_MEDIA_S3_ACCESS_KEY
    secretKeyKey: OMNI_MEDIA_S3_SECRET_KEY
minio:
  enabled: false                 # do not run the bundled store
```

When `media.s3.existingSecret` is set, the chart references the two credential
keys from that Secret instead of rendering plaintext creds, and `minio.enabled`
is typically `false`. The bucket must already exist (the bundled bootstrap Job
only runs for the in-cluster MinIO).

## Verifying end-to-end

The full remote path — store → presign at dispatch → GET returns the stored
bytes — is covered against a real `minio/minio` container by:

- `packages/api/src/services/__tests__/s3-backend-remote.test.ts` (backend
  round-trip, public presign endpoint, no orphaned objects on empty/aborted
  streams)
- `packages/api/src/plugins/__tests__/agent-dispatcher-media-remote.test.ts`
  (dispatch emits `ProviderFile.url`)
- `packages/api/src/plugins/__tests__/media-remote-e2e.test.ts` (store through
  `MediaStorageService`, drive dispatch, `fetch()` the presigned URL, assert the
  bytes)
- `packages/api/src/plugins/__tests__/media-processor-remote.test.ts` (realtime
  processing fetches S3 bytes into a temp file and cleans it up)
- `packages/api/src/services/__tests__/batch-jobs-remote.test.ts` (batch
  `processItem` succeeds on items whose stored reference is an S3 key)

These skip with a clear reason when Docker is unavailable.
