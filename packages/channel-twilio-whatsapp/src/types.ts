/**
 * Twilio WhatsApp channel types.
 */

export interface TwilioWhatsAppConfig {
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFrom?: string;
  twilioMessagingServiceSid?: string;
  twilioStatusCallbackUrl?: string;
  twilioWebhookUrl?: string;
  twilioValidateSignature: boolean;
}

export interface TwilioSendMessageInput {
  to: string;
  body?: string;
  mediaUrl?: string | string[];
  statusCallbackUrl?: string;
}

export interface TwilioMessageResponse {
  sid: string;
  status?: string;
  body?: string | null;
  from?: string | null;
  to?: string | null;
  error_code?: number | string | null;
  error_message?: string | null;
  messaging_service_sid?: string | null;
  [key: string]: unknown;
}

export interface TwilioTypingIndicatorResponse {
  success: boolean;
  [key: string]: unknown;
}

export interface TwilioWebhookParams {
  MessageSid?: string;
  SmsSid?: string;
  SmsMessageSid?: string;
  AccountSid?: string;
  MessagingServiceSid?: string;
  From?: string;
  To?: string;
  Body?: string;
  NumMedia?: string;
  NumSegments?: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
  ProfileName?: string;
  WaId?: string;
  Latitude?: string;
  Longitude?: string;
  Address?: string;
  Label?: string;
  ButtonText?: string;
  ButtonPayload?: string;
  ButtonType?: string;
  InteractiveData?: string;
  FlowData?: string;
  ChannelMetadata?: string;
  OriginalRepliedMessageSid?: string;
  OriginalRepliedMessageSender?: string;
  MessageStatus?: string;
  SmsStatus?: string;
  EventType?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  [key: string]: string | undefined;
}
