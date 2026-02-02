/**
 * WhatsApp Message Types
 *
 * Types derived from actual Baileys payloads observed in production.
 * Each type is documented with the actual JSON structure from debug logs.
 */

// ============================================================================
// MESSAGE KEY - Present on every message
// ============================================================================

/**
 * Message key identifying a specific message
 *
 * @example
 * {
 *   "remoteJid": "100000000000001@lid",
 *   "remoteJidAlt": "5511999990001@s.whatsapp.net",
 *   "fromMe": false,
 *   "id": "AC23570AE54CCF58A8923E45CC6089E8",
 *   "participant": "",
 *   "addressingMode": "lid"
 * }
 */
export interface WAMessageKey {
  /** Chat ID (can be LID format like "100000000000001@lid" or phone format "5511999990001@s.whatsapp.net") */
  remoteJid: string;
  /** Alternative JID - phone number format when remoteJid is LID */
  remoteJidAlt?: string;
  /** True if message is from the connected account */
  fromMe: boolean;
  /** Unique message ID */
  id: string;
  /** Participant JID (for group messages) */
  participant?: string;
  /** Addressing mode: "lid" or "pn" (phone number) */
  addressingMode?: 'lid' | 'pn';
}

// ============================================================================
// MEDIA - Common fields for all media messages
// ============================================================================

/**
 * Common media fields present on all media message types
 */
export interface WAMediaBase {
  /** Encrypted media URL */
  url: string;
  /** MIME type (e.g., "image/jpeg", "audio/ogg; codecs=opus") */
  mimetype: string;
  /** SHA256 hash of decrypted file */
  fileSha256: string;
  /** File size in bytes (as string) */
  fileLength: string;
  /** Key to decrypt the media */
  mediaKey: string;
  /** SHA256 hash of encrypted file */
  fileEncSha256: string;
  /** Direct path for downloading */
  directPath: string;
  /** Timestamp when media key was generated */
  mediaKeyTimestamp: string;
}

// ============================================================================
// TEXT MESSAGES
// ============================================================================

/**
 * Simple text message (conversation)
 *
 * @example
 * { "conversation": "Hello world" }
 */
export interface WAConversationMessage {
  conversation: string;
}

/**
 * Context info for replies and mentions
 */
export interface WAContextInfo {
  /** ID of the message being replied to */
  stanzaId?: string;
  /** JID of the participant whose message is being quoted */
  participant?: string;
  /** The quoted message content */
  quotedMessage?: Record<string, unknown>;
  /** Type of quote */
  quotedType?: 'EXPLICIT' | 'IMPLICIT';
  /** Mentioned JIDs */
  mentionedJid?: string[];
  /** Expiration in seconds (disappearing messages) */
  expiration?: number;
}

/**
 * Extended text message (with reply context, mentions, link preview)
 *
 * @example
 * {
 *   "text": "Reply text",
 *   "previewType": "NONE",
 *   "contextInfo": {
 *     "stanzaId": "AC4D1AE3B43F2AE48CBFF925F9EE6AC0",
 *     "participant": "100000000000001@lid",
 *     "quotedMessage": {...}
 *   }
 * }
 */
export interface WAExtendedTextMessage {
  /** Message text */
  text: string;
  /** Link preview type */
  previewType?: 'NONE' | 'VIDEO' | 'IMAGE';
  /** Reply/mention context */
  contextInfo?: WAContextInfo;
  /** Matched text for link preview */
  matchedText?: string;
  /** Canonical URL for link preview */
  canonicalUrl?: string;
  /** Title for link preview */
  title?: string;
  /** Description for link preview */
  description?: string;
  /** Thumbnail for link preview */
  jpegThumbnail?: string;
}

// ============================================================================
// AUDIO MESSAGE
// ============================================================================

/**
 * Audio/voice message
 *
 * @example
 * {
 *   "url": "https://mmg.whatsapp.net/...",
 *   "mimetype": "audio/ogg; codecs=opus",
 *   "fileSha256": "j8fiGRz4fVKXQv+oLaR6f+ga+dp5hEOmA8NNI1JdAwM=",
 *   "fileLength": "18446",
 *   "seconds": 9,
 *   "ptt": true,
 *   "mediaKey": "RxihmEt66qsX9PhSZwF8RmKvA7MHrv7mgW2Ge2Rg9V8=",
 *   "waveform": "AAAAAAAAAAAAAAABBAAAKAVKGxAA..."
 * }
 */
export interface WAAudioMessage extends WAMediaBase {
  /** Duration in seconds */
  seconds: number;
  /** Push-to-talk (voice note) - true for voice messages */
  ptt: boolean;
  /** Waveform data (base64 encoded) */
  waveform?: string;
  /** Stream sidecar for progressive playback */
  streamingSidecar?: string;
}

// ============================================================================
// IMAGE MESSAGE
// ============================================================================

/**
 * Image message
 *
 * @example
 * {
 *   "url": "https://mmg.whatsapp.net/...",
 *   "mimetype": "image/jpeg",
 *   "fileLength": "63502",
 *   "height": 1599,
 *   "width": 899,
 *   "mediaKey": "oCC21zT7qHbNj3HIDsSr9fQODAeQIWeqgH/udmHAXWo=",
 *   "jpegThumbnail": "/9j/4AAQSkZJRgABAQAAAQABAAD/..."
 * }
 */
export interface WAImageMessage extends WAMediaBase {
  /** Image height in pixels */
  height: number;
  /** Image width in pixels */
  width: number;
  /** Base64 JPEG thumbnail */
  jpegThumbnail?: string;
  /** Caption text */
  caption?: string;
  /** Context info (for replies) */
  contextInfo?: WAContextInfo;
  /** Scan sidecar for multi-resolution */
  scansSidecar?: string;
  /** Scan lengths for multi-resolution */
  scanLengths?: number[];
  /** Mid quality file hash */
  midQualityFileSha256?: string;
}

// ============================================================================
// VIDEO MESSAGE
// ============================================================================

/**
 * Video message
 */
export interface WAVideoMessage extends WAMediaBase {
  /** Video height in pixels */
  height: number;
  /** Video width in pixels */
  width: number;
  /** Duration in seconds */
  seconds: number;
  /** Base64 JPEG thumbnail */
  jpegThumbnail?: string;
  /** Caption text */
  caption?: string;
  /** True if this is a GIF (video/mp4 played as GIF) */
  gifPlayback?: boolean;
  /** Context info (for replies) */
  contextInfo?: WAContextInfo;
  /** Streaming sidecar */
  streamingSidecar?: string;
}

// ============================================================================
// DOCUMENT MESSAGE
// ============================================================================

/**
 * Document/file message
 */
export interface WADocumentMessage extends WAMediaBase {
  /** Original filename */
  fileName: string;
  /** Number of pages (for PDFs) */
  pageCount?: number;
  /** Base64 JPEG thumbnail (for documents with preview) */
  jpegThumbnail?: string;
  /** Caption text */
  caption?: string;
  /** Context info (for replies) */
  contextInfo?: WAContextInfo;
}

// ============================================================================
// STICKER MESSAGE
// ============================================================================

/**
 * Sticker message
 *
 * @example
 * {
 *   "url": "https://mmg.whatsapp.net/...",
 *   "mimetype": "image/webp",
 *   "fileLength": "27636",
 *   "isAnimated": false,
 *   "isAvatar": false,
 *   "isAiSticker": false,
 *   "isLottie": false
 * }
 */
export interface WAStickerMessage extends WAMediaBase {
  /** True if animated sticker */
  isAnimated: boolean;
  /** True if avatar sticker */
  isAvatar: boolean;
  /** True if AI-generated sticker */
  isAiSticker: boolean;
  /** True if Lottie animation */
  isLottie: boolean;
  /** Sticker sent timestamp */
  stickerSentTs?: string;
  /** Sticker height */
  height?: number;
  /** Sticker width */
  width?: number;
}

// ============================================================================
// CONTACT MESSAGE
// ============================================================================

/**
 * Contact card message
 *
 * @example
 * {
 *   "displayName": "Test User",
 *   "vcard": "BEGIN:VCARD\nVERSION:3.0\nN:User;Test;;;\nFN:Test User\nitem1.TEL;waid=5511999990001:+55 11 99999-0001\nitem1.X-ABLabel:Mobile\nEND:VCARD"
 * }
 */
export interface WAContactMessage {
  /** Contact display name */
  displayName: string;
  /** vCard format contact data */
  vcard: string;
}

/**
 * Multiple contacts message
 */
export interface WAContactsArrayMessage {
  /** Display name for the contact list */
  displayName: string;
  /** Array of contacts */
  contacts: WAContactMessage[];
}

// ============================================================================
// LOCATION MESSAGE
// ============================================================================

/**
 * Location message
 *
 * @example
 * {
 *   "degreesLatitude": -29.6114797,
 *   "degreesLongitude": -52.186968,
 *   "jpegThumbnail": "/9j/4AAQSkZJRgABAQAAAQABAAD/..."
 * }
 */
export interface WALocationMessage {
  /** Latitude in degrees */
  degreesLatitude: number;
  /** Longitude in degrees */
  degreesLongitude: number;
  /** Base64 JPEG thumbnail of map */
  jpegThumbnail?: string;
  /** Location name/label */
  name?: string;
  /** Address string */
  address?: string;
  /** URL for the location */
  url?: string;
  /** Accuracy in meters */
  accuracyInMeters?: number;
}

/**
 * Live location message
 */
export interface WALiveLocationMessage extends WALocationMessage {
  /** Sequence number for updates */
  sequenceNumber: number;
  /** Time offset in seconds */
  timeOffset?: number;
  /** Speed in meters per second */
  speedInMps?: number;
  /** Degrees clockwise from true north */
  degreesClockwiseFromMagneticNorth?: number;
  /** Caption */
  caption?: string;
}

// ============================================================================
// POLL MESSAGES
// ============================================================================

/**
 * Poll creation message
 */
export interface WAPollCreationMessage {
  /** Poll question/name */
  name: string;
  /** Poll options */
  options: Array<{ optionName: string }>;
  /** Max number of options that can be selected */
  selectableOptionsCount?: number;
}

/**
 * Poll update/vote message
 *
 * @example
 * {
 *   "pollCreationMessageKey": {
 *     "remoteJid": "100000000000001@lid",
 *     "fromMe": false,
 *     "id": "AC04809E9F816ACEB5F794B6081EEAD3"
 *   },
 *   "vote": {
 *     "encPayload": "H3qh6Dj1MTg86DrHqZawnHZn76hwHmFOVyb9XAG6Y4DSq4L6HnAUHxMXMNXvJUSfmTA=",
 *     "encIv": "Ml5iegFbA/3RPTBD"
 *   },
 *   "senderTimestampMs": "1769830272956"
 * }
 */
export interface WAPollUpdateMessage {
  /** Key of the original poll message */
  pollCreationMessageKey: WAMessageKey;
  /** Encrypted vote data */
  vote: {
    encPayload: string;
    encIv: string;
  };
  /** Timestamp when vote was cast */
  senderTimestampMs: string;
}

// ============================================================================
// REACTION MESSAGE
// ============================================================================

/**
 * Reaction message
 */
export interface WAReactionMessage {
  /** Reaction emoji (empty string = reaction removed) */
  text: string;
  /** Key of the message being reacted to */
  key: WAMessageKey;
}

// ============================================================================
// CALL EVENT
// ============================================================================

/**
 * Call status values
 */
export type WACallStatus = 'offer' | 'ringing' | 'reject' | 'accept' | 'timeout' | 'terminate';

/**
 * Call event
 *
 * @example
 * {
 *   "chatId": "100000000000001@lid",
 *   "from": "100000000000001@lid",
 *   "id": "ACFAA356CDA59950438DE08129BB9CA9",
 *   "date": "2026-01-31T03:21:53.000Z",
 *   "offline": false,
 *   "status": "offer",
 *   "isVideo": true,
 *   "isGroup": false
 * }
 */
export interface WACallEvent {
  /** Chat ID */
  chatId: string;
  /** Caller JID */
  from: string;
  /** Unique call ID */
  id: string;
  /** Call timestamp */
  date: Date | string;
  /** True if call was received while offline */
  offline: boolean;
  /** Call status */
  status: WACallStatus;
  /** True if video call */
  isVideo: boolean;
  /** True if group call */
  isGroup: boolean;
}

// ============================================================================
// PRESENCE UPDATE
// ============================================================================

/**
 * Presence status values
 */
export type WAPresenceStatus = 'available' | 'unavailable' | 'composing' | 'recording' | 'paused';

/**
 * Presence data for a participant
 */
export interface WAPresenceData {
  /** Last known presence status */
  lastKnownPresence: WAPresenceStatus;
  /** Last seen timestamp (Unix) */
  lastSeen?: number;
}

/**
 * Presence update event
 */
export interface WAPresenceUpdate {
  /** Chat ID */
  id: string;
  /** Presence data by participant JID */
  presences: Record<string, WAPresenceData>;
}

// ============================================================================
// GROUP EVENTS
// ============================================================================

/**
 * Group participant action types
 */
export type WAGroupAction = 'add' | 'remove' | 'promote' | 'demote';

/**
 * Group participant info
 */
export interface WAGroupParticipant {
  /** Participant LID */
  id: string;
  /** Phone number JID */
  phoneNumber?: string;
  /** Admin status: "admin", "superadmin", or null */
  admin: 'admin' | 'superadmin' | null;
}

/**
 * Group participants update event
 *
 * @example
 * {
 *   "id": "120363000000000001@g.us",
 *   "author": "100000000000001@lid",
 *   "participants": [{
 *     "id": "100000000000002@lid",
 *     "phoneNumber": "5511999990002@s.whatsapp.net",
 *     "admin": null
 *   }],
 *   "action": "promote"
 * }
 */
export interface WAGroupParticipantsUpdate {
  /** Group JID */
  id: string;
  /** JID of user who performed the action */
  author: string;
  /** Affected participants */
  participants: WAGroupParticipant[];
  /** Action performed */
  action: WAGroupAction;
}

// ============================================================================
// MESSAGE RECEIPT
// ============================================================================

/**
 * Message receipt update
 *
 * @example
 * {
 *   "key": {
 *     "remoteJid": "120363000000000001@g.us",
 *     "id": "ACB1DC3366CA6C77B71347E8E0692854",
 *     "fromMe": false,
 *     "participant": "100000000000003@lid"
 *   },
 *   "receipt": {
 *     "userJid": "100000000000003@lid",
 *     "readTimestamp": 1769830223
 *   }
 * }
 */
export interface WAMessageReceiptUpdate {
  /** Message key */
  key: WAMessageKey;
  /** Receipt data */
  receipt: {
    /** JID of user who read/received */
    userJid: string;
    /** Read timestamp (Unix) */
    readTimestamp?: number;
    /** Received timestamp (Unix) */
    receiptTimestamp?: number;
    /** Play timestamp for audio/video */
    playedTimestamp?: number;
  };
}

// ============================================================================
// PIX PAYMENT MESSAGE
// ============================================================================

/**
 * PIX key type values
 */
export type WAPixKeyType = 'PHONE' | 'EMAIL' | 'CPF' | 'EVP';

/**
 * PIX static code payment settings
 */
export interface WAPixStaticCode {
  /** Merchant/receiver name */
  merchant_name: string;
  /** PIX key value */
  key: string;
  /** Type of PIX key */
  key_type: WAPixKeyType;
}

/**
 * PIX payment settings
 */
export interface WAPixPaymentSetting {
  /** Payment type - always 'pix_static_code' for PIX copia e cola */
  type: 'pix_static_code';
  /** PIX static code data */
  pix_static_code: WAPixStaticCode;
}

/**
 * PIX payment info button
 */
export interface WAPixButton {
  /** Button name - always 'payment_info' for PIX */
  name: 'payment_info';
  /** JSON string containing payment settings */
  buttonParamsJson: string;
}

/**
 * PIX interactive message (native flow)
 *
 * @example
 * {
 *   "interactiveMessage": {
 *     "nativeFlowMessage": {
 *       "buttons": [{
 *         "name": "payment_info",
 *         "buttonParamsJson": "{\"payment_settings\":[{\"type\":\"pix_static_code\",\"pix_static_code\":{\"merchant_name\":\"Store Name\",\"key\":\"email@example.com\",\"key_type\":\"EMAIL\"}}]}"
 *       }]
 *     }
 *   }
 * }
 */
export interface WAPixMessage {
  interactiveMessage: {
    nativeFlowMessage: {
      buttons: WAPixButton[];
    };
  };
}

// ============================================================================
// FULL MESSAGE WRAPPER
// ============================================================================

/**
 * Message context info (device metadata)
 */
export interface WAMessageContextInfo {
  deviceListMetadata?: {
    senderKeyHash: string;
    senderTimestamp: string;
    recipientKeyHash: string;
    recipientTimestamp: string;
  };
  deviceListMetadataVersion?: number;
  messageSecret?: string;
}

/**
 * Full message wrapper as received from Baileys
 */
export interface WAFullMessage {
  /** Message key */
  key: WAMessageKey;
  /** Unix timestamp */
  messageTimestamp: number;
  /** Sender's display name */
  pushName: string;
  /** True if broadcast message */
  broadcast: boolean;
  /** Message status: 0=ERROR, 1=PENDING, 2=SERVER_ACK, 3=DELIVERY_ACK, 4=READ, 5=PLAYED */
  status?: number;
  /** Message content - one of these will be present */
  message: {
    conversation?: string;
    extendedTextMessage?: WAExtendedTextMessage;
    imageMessage?: WAImageMessage;
    audioMessage?: WAAudioMessage;
    videoMessage?: WAVideoMessage;
    documentMessage?: WADocumentMessage;
    stickerMessage?: WAStickerMessage;
    contactMessage?: WAContactMessage;
    contactsArrayMessage?: WAContactsArrayMessage;
    locationMessage?: WALocationMessage;
    liveLocationMessage?: WALiveLocationMessage;
    pollCreationMessage?: WAPollCreationMessage;
    pollCreationMessageV3?: WAPollCreationMessage;
    pollUpdateMessage?: WAPollUpdateMessage;
    reactionMessage?: WAReactionMessage;
    protocolMessage?: Record<string, unknown>;
    messageContextInfo?: WAMessageContextInfo;
  };
}

// ============================================================================
// CHAT UPDATE
// ============================================================================

/**
 * Chat update event
 */
export interface WAChatUpdate {
  /** Chat JID */
  id: string;
  /** Updated messages in the chat */
  messages?: Array<{ message: WAFullMessage }>;
  /** Conversation timestamp */
  conversationTimestamp?: number;
  /** Unread message count */
  unreadCount?: number;
  /** True if chat is read-only (left group) */
  readOnly?: boolean;
}

// ============================================================================
// CONTACT UPDATE
// ============================================================================

/**
 * Contact update event
 */
export interface WAContactUpdate {
  /** Contact JID */
  id: string;
  /** Contact's push name (display name) */
  notify?: string;
  /** Contact's status message */
  status?: string;
  /** Profile picture URL */
  imgUrl?: string;
}
