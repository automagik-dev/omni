# PR 1270 automation review

The findings were checked against the actual send, webhook, credential and storage paths. Corrections cover:

- Entire nested gateway configurations are redacted in CLI output, preserving explicit null clears.
- GET network/5xx failures may retry. POST network/5xx, invalid JSON, malformed accepted responses and unknown routing keys require reconciliation, with explicit channel error codes.
- Invalid Evolution batch items are isolated after authentication and instance binding; valid siblings continue. Warnings contain only local instance ID and item index.
- `READ_BY_ME` does not acknowledge an outbound recipient read.
- Z-API connection callbacks are serialized per instance. Timestamped callbacks cannot regress state; untimestamped callbacks must agree with the current provider state.
- Startup and queued reconnect open credentials using the persisted row tenant, through the existing credential codec.
- Gateway connect/rotation persists before activation and serializes same-instance rotations in the current API process. Queued connects reread their persisted defaults inside that queue, so a request without new credentials cannot restore a configuration read before an earlier rotation. Failed persistence never activates new credentials; failed activation detaches locally and retains the durable configuration for recovery. Operators still need one lifecycle owner per instance when running multiple API replicas.
- Rejected Z-API uploads are discarded through local/S3 storage backends. Unknown accepted sends retain their bytes for reconciliation. Storage services are cached per database handle, avoiding an earlier request's captured database/root in tests.
- Official Z-API capabilities exclude Web pairing/reactions and declare the three-button limit.
- Template sending records journey checkpoints and sent metrics; OpenAPI includes instance-not-found and capability errors.
- Environment teardown removes absent variables rather than assigning undefined. Test route descriptions and stale validation counts were corrected.

The receipt-isolation warning did not reproduce: persistence resolves the chat with the instance ID and chat ID before looking up the message by chat ID and external ID, inside tenant consumer context. Evolution already accepts LID routing keys; the actual failure was another unsupported routing key after provider acceptance.

Query-token authentication remains for vendor compatibility. Authorization takes precedence when available; ingress access logs must redact query strings. Header support in deployed vendor webhook configuration must be verified before removing query authentication.

Validation is offline: mocked fetch/event bus/database tests, TypeScript, lint and repository static gates. No database migration or authenticated provider call was run. The docstring-coverage suggestion is an advisory metric; comments document the new failure and lifecycle boundaries without adding redundant comments to every method.
