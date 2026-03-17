-- Backfill lastMessageFromMe for existing chats
-- Sets the value based on the most recent message in each chat
UPDATE chats SET last_message_from_me = sub.is_from_me
FROM (
  SELECT DISTINCT ON (chat_id) chat_id, is_from_me
  FROM messages
  WHERE deleted_at IS NULL
  ORDER BY chat_id, platform_timestamp DESC
) sub
WHERE chats.id = sub.chat_id;
