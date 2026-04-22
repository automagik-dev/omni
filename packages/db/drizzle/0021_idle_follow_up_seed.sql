-- Seed the default idle-chat follow-up automation.
-- The follow-up sweeper publishes `chat.idle_timeout`; without an
-- automation subscribed to that event, arming is a no-op in production.
-- Source of truth for the structure lives at
-- docs/examples/automations/idle-follow-up.yaml.

INSERT INTO "automations" (
  "id",
  "name",
  "description",
  "trigger_event_type",
  "trigger_conditions",
  "condition_logic",
  "actions",
  "enabled",
  "priority",
  "created_at",
  "updated_at"
)
SELECT
  '00000000-0000-4000-8000-000000000f04'::uuid,
  'Idle chat follow-up',
  'Ask the agent to draft a follow-up when a customer goes idle after an agent reply. Paired with per-agent/per-instance follow-up config (see omni follow-up set ...).',
  'chat.idle_timeout',
  '[]'::jsonb,
  'and',
  '[
    {
      "type": "call_agent",
      "config": {
        "agentId": "{{payload.agentId}}",
        "promptOverride": "The customer has been idle for {{minutes}} minutes since your last reply. This is follow-up #{{sequenceIndex}} in the sequence.\n\n{{syntheticPrompt}}\n\nWrite a short, warm follow-up message to {{chatName}} in their preferred language. Do not mention that this is an automated follow-up.",
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
  true,
  100,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "automations" WHERE "name" = 'Idle chat follow-up'
);
