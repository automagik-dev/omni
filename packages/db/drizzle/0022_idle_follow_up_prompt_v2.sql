-- Upgrade the "Idle chat follow-up" automation promptOverride to use
-- 1-based `{{attemptNumber}}` / `{{totalAttempts}}` placeholders instead of the
-- zero-based `{{sequenceIndex}}`.
--
-- Context: in production the agent was reading "This is follow-up #0" and
-- confusing itself into emitting meta-commentary ("_(limite atingido)_") from
-- its own session memory. The new wrapper uses natural 1-based numbering and
-- explicitly forbids stage directions / parenthetical notes.
--
-- Idempotent: only rewrites the built-in row. User-authored automations are
-- untouched.

UPDATE "automations"
SET
  "actions" = '[
    {
      "type": "call_agent",
      "config": {
        "agentId": "{{payload.agentId}}",
        "promptOverride": "Follow-up context: attempt {{attemptNumber}} of {{totalAttempts}} — {{minutes}} minutes of silence since your last message to {{chatName}}.\n\n{{syntheticPrompt}}\n\nRespond with ONLY the customer-facing message. Plain text, no italics, no parentheses, no stage directions, no meta-commentary. Do not refer to yourself as an automation or follow-up bot.",
        "responseAs": "followUpReply"
      }
    },
    {
      "type": "send_message",
      "config": {
        "instanceId": "{{payload.instanceId}}",
        "to": "{{payload.chatId}}",
        "contentTemplate": "{{followUpReply}}"
      }
    }
  ]'::jsonb,
  "updated_at" = NOW()
WHERE "id" = '00000000-0000-4000-8000-000000000f04'::uuid;
