/**
 * Inbound media for the ASC platform Flow channel.
 *
 * 🔴 The problem. The flow's `api_rest` node hands us `chatInput` = the flow
 * variable `{#MENSAGEM}`, a STRING. When the beneficiary sends audio, an image
 * or a document, that string is the platform's FILE NAME — never the content:
 *
 *   1820260901wamid.HBgMNTU1MTk3Mjg1ODI5…FDQgA.ogg     (audio)
 *   1820260901wamid.HBgMNTU1MTk3Mjg1ODI5…RjNgA.jpg     (image)
 *
 * Shape: `<cod_conta><YYYYMMDD>wamid.<id>.<ext>`. Published as text it reaches
 * the agent as a sentence, and the agent answers nonsense (measured 01/09 on
 * the live number: the audio got "Ainda não conseguimos localizar seu cadastro").
 *
 * The fix. `GET /atendimento?codigo_atendimento=<cod>` returns the ticket with
 * its `mensagens`, and a media message there carries the BYTES inline:
 *
 *   {"tip_msg":"AUDIO","boleano_entrante":"1",
 *    "descricao_msg":"1820260901wamid.….ogg",
 *    "content-type":"audio/ogg; codecs=opus",
 *    "base64_arquivo":"T2dnUwACAAAA…",
 *    "url_arquivo":"https://…/download-file/<uuid>"}
 *
 * The base64 is preferred over `url_arquivo`: it is already in the response we
 * had to make anyway, and it needs no second authenticated round trip.
 *
 * Cost. That response carries every message of the ticket WITH its base64 —
 * 63 KB measured on a ticket with one audio and one image. So it is fetched
 * ONLY when `chatInput` matches the file-name shape; plain text never pays for
 * it. That check is the whole reason this module exists.
 *
 * Delivery. Bytes are stored through the SDK's media backend (the same seam
 * baileys/telegram use) and surfaced on `content.localPath`, which
 * `message-persistence` writes to `messages.mediaLocalPath` and the media
 * processor consumes directly — that is what runs transcription/description.
 * `createDownloadGuard` caps the size, as on every other channel.
 */

import { basename, join } from 'node:path';

import { type MediaStorageBackend, createDownloadGuard, createMediaBackend } from '@omni/channel-sdk';
import type { Logger } from '@omni/core';
import type { ContentType } from '@omni/core/types';

import type { AscFlowClient } from '../client';

const downloadGuard = createDownloadGuard();

/**
 * Built once so remote mode does not construct an S3 client per message. The
 * base path is read on FIRST USE, not at import: the plugin is imported before
 * the process env is fully settled (and the test suite relies on that).
 */
let mediaBackend: MediaStorageBackend | null = null;
function getMediaBackend(): MediaStorageBackend {
  if (!mediaBackend) mediaBackend = createMediaBackend(process.env.MEDIA_STORAGE_PATH || './data/media');
  return mediaBackend;
}

/**
 * `<digits>wamid.<id>.<ext>` — the platform's inbound file name. Anchored end
 * to end and space-free, so a beneficiary who happens to TYPE something with a
 * dot never triggers an `/atendimento` fetch.
 */
const MEDIA_FILENAME_RE = /^\d+wamid\.[^\s/\\]+\.[A-Za-z0-9]{2,5}$/;

/** Whether `chatInput` is a platform file name rather than something typed. */
export function isAscMediaFilename(text: string): boolean {
  return MEDIA_FILENAME_RE.test(text.trim());
}

/** `tip_msg` → Omni content type. Only used when `content-type` is missing. */
const TIP_MSG_TYPES: Record<string, ContentType> = {
  AUDIO: 'audio' as ContentType,
  IMG: 'image' as ContentType,
  IMAGEM: 'image' as ContentType,
  VIDEO: 'video' as ContentType,
};

/** MIME family → Omni content type; anything else is a document. */
function toContentType(mimeType: string, tipMsg: string): ContentType {
  if (mimeType.startsWith('audio/')) return 'audio' as ContentType;
  if (mimeType.startsWith('image/')) return 'image' as ContentType;
  if (mimeType.startsWith('video/')) return 'video' as ContentType;
  if (mimeType) return 'document' as ContentType;
  return TIP_MSG_TYPES[tipMsg.toUpperCase()] ?? ('document' as ContentType);
}

/** Extension of the platform file name, `.bin` when it has none we can use. */
function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]{2,5})$/.exec(filename);
  return match ? `.${match[1]?.toLowerCase()}` : '.bin';
}

/**
 * What the agent reads when the bytes could not be resolved. Better than the
 * raw file name (which the agent answers as if it were a sentence) and better
 * than dropping the turn (which would leave the flow polling forever).
 */
export function mediaFallbackText(filename: string): string {
  const ext = extensionOf(filename).slice(1);
  const kind = ['ogg', 'opus', 'mp3', 'm4a', 'wav', 'amr'].includes(ext)
    ? 'um áudio'
    : ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)
      ? 'uma imagem'
      : ['mp4', '3gp', 'mov'].includes(ext)
        ? 'um vídeo'
        : 'um arquivo';
  return `[o beneficiário enviou ${kind}, mas não foi possível ler o conteúdo]`;
}

export interface ResolvedAscMedia {
  type: ContentType;
  mimeType: string;
  /** Backend reference recorded on the message row (relative path or S3 key). */
  localPath: string;
}

interface AscAtendimentoMessage {
  descricao_msg?: string;
  boleano_entrante?: string | number;
  tip_msg?: string;
  base64_arquivo?: string;
  'content-type'?: string;
}

/** The `mensagens` array off an `/atendimento` body, or null when absent. */
function messagesOf(body: unknown): AscAtendimentoMessage[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const list = (body as Record<string, unknown>).mensagens;
  return Array.isArray(list) ? (list as AscAtendimentoMessage[]) : null;
}

/**
 * Fetch the atendimento, find the inbound message whose `descricao_msg` is this
 * file name, and persist its bytes through the media backend.
 *
 * Returns `null` on every failure (platform down, message not there yet,
 * oversized, empty base64) — the caller degrades to text, never throws.
 */
export async function resolveAscInboundMedia(
  params: {
    client: AscFlowClient;
    instanceId: string;
    codAtendimento: string;
    /** `descricao_msg` to look for — the `chatInput` we were handed. */
    filename: string;
    /** Message id used to build the storage key. */
    externalId: string;
    logger: Logger;
  },
  backend: MediaStorageBackend = getMediaBackend(),
): Promise<ResolvedAscMedia | null> {
  const { client, instanceId, codAtendimento, filename, externalId, logger } = params;

  try {
    const { status, body } = await client.get('/atendimento', { codigo_atendimento: codAtendimento });
    const messages = status === 200 ? messagesOf(body) : null;
    if (!messages) {
      logger.warn('[asc-flow] /atendimento did not return mensagens — degrading media to text', {
        instanceId,
        codAtendimento,
        status,
      });
      return null;
    }

    // Newest first: a file name repeats if the beneficiary resends the same
    // asset, and the latest entry is the turn we are answering.
    const wanted = filename.trim();
    const match = [...messages]
      .reverse()
      .find(
        (m) =>
          String(m.boleano_entrante ?? '') === '1' &&
          typeof m.descricao_msg === 'string' &&
          m.descricao_msg.trim() === wanted &&
          typeof m.base64_arquivo === 'string' &&
          m.base64_arquivo.length > 0,
      );

    if (!match) {
      logger.warn('[asc-flow] media not found in the atendimento — degrading to text', {
        instanceId,
        codAtendimento,
        messages: messages.length,
      });
      return null;
    }

    const mimeType = (match['content-type'] ?? '').split(';')[0]?.trim() ?? '';
    const buffer = Buffer.from(match.base64_arquivo as string, 'base64');
    if (buffer.length === 0) {
      logger.warn('[asc-flow] media base64 decoded to zero bytes — degrading to text', {
        instanceId,
        codAtendimento,
      });
      return null;
    }
    downloadGuard.checkSize(buffer.length, logger, { instanceId, channel: 'asc-flow' });

    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    // The external id can be a platform-supplied string: strip directories and
    // anything non-alphanumeric so it can never escape the media root.
    const safeExternalId = basename(externalId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const key = join(instanceId, yearMonth, `${safeExternalId}${extensionOf(wanted)}`);

    const stored = await backend.store({ key, buffer, mimeType: mimeType || undefined });

    logger.info('[asc-flow] inbound media resolved', {
      instanceId,
      codAtendimento,
      mimeType,
      size: stored.size,
      mode: backend.mode,
    });

    return {
      type: toContentType(mimeType, match.tip_msg ?? ''),
      mimeType: mimeType || 'application/octet-stream',
      localPath: stored.reference,
    };
  } catch (err) {
    logger.warn('[asc-flow] inbound media resolution failed — degrading to text', {
      instanceId,
      codAtendimento,
      err: String(err),
    });
    return null;
  }
}
