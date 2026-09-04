/**
 * Outbound rich content for the ASC platform Flow channel.
 *
 * The poll body (`resposta`) and `/callbackFlowMsg` both carry a STRING, so
 * neither can deliver a file, a pin or a contact card. `POST /mensagem` is the
 * one endpoint that injects arbitrary content into an EXISTING atendimento:
 *
 *   {"cod": 123, "mensagem": "legenda", "entrante": 0, "bolFlow": true,
 *    "url_arquivo"|"base64_arquivo"+"nome_arquivo"+"mime_type": …,
 *    "localizacao": {latitude, longitude, endereco},
 *    "cartao_contato": {nome, telefone, email},
 *    "ura_opcoes": {"1": …}, "forcar_botoes": true,
 *    "id_mensagem_resposta": <id>}
 *
 * This module builds those field groups. It NEVER throws: every failure returns
 * `null` and the caller degrades to text — the turn must always resolve, or the
 * flow's `api_rest` node polls until it times out.
 */

import { basename } from 'node:path';

import { createDownloadGuard } from '@omni/channel-sdk';
import type { OutgoingContent, OutgoingMessage } from '@omni/channel-sdk';
import type { Logger } from '@omni/core';

import { getMediaBackend } from './media';

/**
 * Outbound ceiling. Meta caps audio/video/document at 16 MB on the interactive
 * paths and the platform is a BSP on top of Meta, so nothing looser is safe;
 * base64 inflates the payload by a third on top of that.
 */
const OUTBOUND_MEDIA_MAX_BYTES = 16 * 1024 * 1024;

/** Deadline for fetching a caller-supplied media URL, matching the client's. */
const OUTBOUND_FETCH_TIMEOUT_MS = 20_000;

/** Rejects an oversized download on the Content-Length, before the body is read. */
const downloadGuard = createDownloadGuard({ maxSizeBytes: OUTBOUND_MEDIA_MAX_BYTES });

/** Content types that leave through `/mensagem` rather than the poll body. */
const MEDIA_TYPES = new Set(['image', 'audio', 'video', 'document']);

/** What the agent gets on the handset when the file could not be sent. */
export const OUTBOUND_MEDIA_FALLBACK_TEXT = '[não foi possível enviar o arquivo]';

/** Whether this content needs `/mensagem` (media, location or contact). */
export function isRichContent(content: OutgoingContent): boolean {
  return MEDIA_TYPES.has(content.type) || content.type === 'location' || content.type === 'contact';
}

/** Read stored bytes: a media-backend reference first, a plain path second. */
async function readMediaBytes(reference: string, logger: Logger): Promise<Buffer> {
  // A public URL is fetched HERE and forwarded as bytes — the platform refuses
  // a foreign `url_arquivo` (see `buildMediaFields`).
  if (/^https?:\/\//i.test(reference)) {
    // The URL comes from the caller, so it is not trusted with either the clock
    // or memory: without a deadline a tarpit host hangs the turn forever, and
    // without the guard the whole body is buffered before `withBytes` gets to
    // reject it — a multi-GB file was downloaded in full to then be refused.
    const response = await fetch(reference, { signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`fetch ${reference} failed: HTTP ${response.status}`);
    downloadGuard.checkResponse(response, logger, { url: reference, channel: 'asc-flow' });
    return Buffer.from(await response.arrayBuffer());
  }
  try {
    return await getMediaBackend().read(reference);
  } catch {
    // Not a backend key — an absolute path handed straight off disk.
    return Buffer.from(await Bun.file(reference).arrayBuffer());
  }
}

/**
 * The file fields for a media send: the bytes go inline as base64.
 *
 * `url_arquivo` is NOT used for a public URL. The platform refuses one from a
 * domain it does not own — measured 02/09 on the live number, an
 * upload.wikimedia.org image came back `HTTP 400, cod_error 9`, while the same
 * image as base64 went through. So the URL is only a place to READ bytes from,
 * never something to hand the platform.
 */
async function buildMediaFields(message: OutgoingMessage, logger: Logger): Promise<Record<string, unknown> | null> {
  const { content } = message;
  const url = content.mediaUrl;
  const name = content.filename || basename(content.localPath || url || '') || 'arquivo';
  const mimeType = content.mimeType || Bun.file(name).type || 'application/octet-stream';

  // `POST /api/v2/messages/send/media` with a `base64` (or a voice note's
  // `audioBuffer`) hands the bytes on the METADATA, not on the content.
  const inline = inlineBytesOf(message);
  if (inline) return withBytes(inline, name, mimeType, logger);

  const reference = content.localPath || url;
  if (!reference) {
    logger.warn('[asc-flow] media send has neither mediaUrl nor localPath — degrading to text');
    return null;
  }

  try {
    return withBytes(await readMediaBytes(reference, logger), name, mimeType, logger);
  } catch (err) {
    logger.warn('[asc-flow] could not read outbound media — degrading to text', {
      reference,
      err: String(err),
    });
    return null;
  }
}

/** Bytes handed on the metadata by the API's send/media route, if any. */
function inlineBytesOf(message: OutgoingMessage): Buffer | null {
  const meta = message.metadata ?? {};
  if (Buffer.isBuffer(meta.audioBuffer)) return meta.audioBuffer;
  if (typeof meta.base64 === 'string' && meta.base64) return Buffer.from(meta.base64, 'base64');
  return null;
}

/** The inline-file fields, or `null` when the bytes fail the size guard. */
function withBytes(bytes: Buffer, name: string, mimeType: string, logger: Logger): Record<string, unknown> | null {
  if (bytes.length === 0 || bytes.length > OUTBOUND_MEDIA_MAX_BYTES) {
    logger.warn('[asc-flow] outbound media rejected by the size guard — degrading to text', {
      size: bytes.length,
      max: OUTBOUND_MEDIA_MAX_BYTES,
    });
    return null;
  }
  return { base64_arquivo: bytes.toString('base64'), nome_arquivo: name, mime_type: mimeType };
}

/**
 * The `/mensagem` field group for whatever rich content this message carries,
 * or `null` when it could not be built (the caller then sends plain text).
 */
export async function buildRichFields(
  message: OutgoingMessage,
  logger: Logger,
): Promise<Record<string, unknown> | null> {
  const { content } = message;
  if (MEDIA_TYPES.has(content.type)) return buildMediaFields(message, logger);

  if (content.type === 'location') {
    const loc = content.location;
    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) {
      logger.warn('[asc-flow] location send without usable coordinates — degrading to text');
      return null;
    }
    const endereco = [loc.name, loc.address].filter(Boolean).join(' - ');
    return {
      localizacao: {
        latitude: String(loc.latitude),
        longitude: String(loc.longitude),
        ...(endereco ? { endereco } : {}),
      },
    };
  }

  if (content.type === 'contact') {
    // `cod_contato` is a platform-side contact id Omni has no equivalent for —
    // the card goes out with the three fields Omni does carry.
    const card = content.contact;
    if (!card?.name?.trim()) {
      logger.warn('[asc-flow] contact send without a name — degrading to text');
      return null;
    }
    return {
      cartao_contato: {
        nome: card.name.trim(),
        ...(card.phone ? { telefone: card.phone } : {}),
        ...(card.email ? { email: card.email } : {}),
      },
    };
  }

  return null;
}

/** `id_mensagem_resposta` when the quoted id is a platform message id. */
export function buildReplyField(replyTo: string | undefined): Record<string, unknown> {
  const trimmed = replyTo?.trim() ?? '';
  // Omni's own ids are UUIDs; only the platform's numeric ids mean anything to
  // `/mensagem`, and an unknown id is ignored rather than failing the turn.
  return /^\d+$/.test(trimmed) ? { id_mensagem_resposta: Number(trimmed) } : {};
}
