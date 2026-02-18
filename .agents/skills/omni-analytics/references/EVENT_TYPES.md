# Omni Event Types

| Event Type | Trigger | Key Payload Fields |
|------------|---------|-------------------|
| `message.received` | Inbound message from any channel | `instanceId`, `chatId`, `from`, `content.type`, `content.text`, `externalId` |
| `message.sent` | Outbound message confirmed delivered | `instanceId`, `chatId`, `to`, `messageId`, `content.type` |
| `message.failed` | Outbound message delivery failed | `instanceId`, `chatId`, `error`, `errorCode`, `retryable` |
| `message.edited` | Message was edited | `instanceId`, `messageId`, `chatId`, `newText` |
| `message.deleted` | Message was deleted | `instanceId`, `messageId`, `chatId`, `deletedByMe` |
| `reaction.received` | Reaction added to a message | `instanceId`, `messageId`, `chatId`, `from`, `emoji` |
| `reaction.removed` | Reaction removed from a message | `instanceId`, `messageId`, `chatId`, `from`, `emoji` |
| `instance.connected` | Channel instance connected | `instanceId`, `profileName`, `ownerIdentifier` |
| `instance.disconnected` | Channel instance disconnected | `instanceId`, `reason`, `willReconnect` |
| `instance.reconnecting` | Instance attempting reconnection | `instanceId`, `attempt`, `maxAttempts` |
| `automation.triggered` | Automation rule matched an event | `automationId`, `triggeredBy`, `eventType` |
| `automation.executed` | Automation action completed | `automationId`, `result`, `duration` |
| `batch.started` | Batch processing job started | `jobId`, `type`, `instanceId`, `itemCount` |
| `batch.completed` | Batch processing job finished | `jobId`, `type`, `processedCount`, `failedCount` |
| `batch.failed` | Batch processing job failed | `jobId`, `type`, `error` |
| `sync.started` | History sync initiated | `instanceId`, `syncType`, `depth` |
| `sync.completed` | History sync finished | `instanceId`, `syncType`, `itemCount` |

## Notes

- All events include `timestamp`, `correlationId`, and `metadata` fields
- Use `omni events search "<type>" --since 7d` to find events
- Use `omni events analytics` for aggregated statistics
- Use `omni journey show <correlationId>` to trace a single message flow
