/**
 * Pure helpers for the WhatsApp template builder and list (#1276).
 *
 * Kept out of the React components so the Meta payload rules are testable:
 * Meta rejects (`INVALID_FORMAT`) any template whose `{{n}}` variables come
 * without sample values in `example.body_text` / `example.header_text`.
 */

export type TemplateStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DELETED';
export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

export interface TemplateRow {
  id: string;
  metaId?: string | null;
  name: string;
  language: string;
  category: TemplateCategory;
  status: TemplateStatus;
  qualityScore?: string | null;
  rejectionReason?: string | null;
}

/** Shape of GET /instances/:id/whatsapp-templates. */
export interface TemplatesListResponse {
  items: TemplateRow[];
  meta: { count: number };
}

export type HeaderMode = 'NONE' | 'TEXT' | 'IMAGE';

export interface TemplateButtonDraft {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';
  text: string;
  url?: string;
  phone_number?: string;
  example?: string;
}

export interface TemplateDraft {
  headerMode: HeaderMode;
  headerText: string;
  /** Sample for the header's `{{1}}`, when it has one. */
  headerSample: string;
  headerImageHandle: string;
  body: string;
  /** Sample per body variable, keyed by its number (`{{2}}` → `bodySamples[2]`). */
  bodySamples: Record<number, string>;
  footer: string;
  buttons: TemplateButtonDraft[];
}

export type TemplateComponent =
  | {
      type: 'HEADER';
      format: 'TEXT' | 'IMAGE';
      text?: string;
      example?: { header_text?: string[]; header_handle?: string[] };
    }
  | { type: 'BODY'; text: string; example?: { body_text: string[][] } }
  | { type: 'FOOTER'; text: string }
  | { type: 'BUTTONS'; buttons: TemplateButtonDraft[] };

/** Distinct `{{n}}` variable numbers in `text`, ascending. */
export function extractVariables(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    found.add(Number.parseInt(match[1] ?? '', 10));
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Validation message for the variables of a text, or null when they are fine.
 * Meta requires them to be numbered 1..n without gaps, each with a sample.
 */
export function variablesError(text: string, samples: Record<number, string>, maxVariables?: number): string | null {
  const variables = extractVariables(text);
  if (maxVariables !== undefined && variables.length > maxVariables) {
    return `Use at most ${maxVariables} variable${maxVariables === 1 ? '' : 's'} here`;
  }
  if (variables.some((n, i) => n !== i + 1)) {
    return 'Number variables in order, starting at {{1}} with no gaps';
  }
  const missing = variables.filter((n) => !samples[n]?.trim());
  if (missing.length > 0) {
    return `Add a sample value for ${missing.map((n) => `{{${n}}}`).join(', ')}`;
  }
  return null;
}

/** Meta component payload for the builder's draft, including variable samples. */
export function buildTemplateComponents(draft: TemplateDraft): TemplateComponent[] {
  const components: TemplateComponent[] = [];

  if (draft.headerMode === 'TEXT' && draft.headerText) {
    const header: TemplateComponent = { type: 'HEADER', format: 'TEXT', text: draft.headerText };
    if (extractVariables(draft.headerText).length > 0) header.example = { header_text: [draft.headerSample] };
    components.push(header);
  } else if (draft.headerMode === 'IMAGE' && draft.headerImageHandle) {
    components.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [draft.headerImageHandle] } });
  }

  const bodyVariables = extractVariables(draft.body);
  components.push(
    bodyVariables.length > 0
      ? {
          type: 'BODY',
          text: draft.body,
          example: { body_text: [bodyVariables.map((n) => draft.bodySamples[n] ?? '')] },
        }
      : { type: 'BODY', text: draft.body },
  );

  if (draft.footer) components.push({ type: 'FOOTER', text: draft.footer });
  if (draft.buttons.length > 0) components.push({ type: 'BUTTONS', buttons: draft.buttons });
  return components;
}

export interface TemplateToast {
  kind: 'success' | 'error';
  message: string;
}

/** Toast for a template just created, based on the status Meta returned. */
export function createdTemplateToast(
  template: Pick<TemplateRow, 'name' | 'status' | 'rejectionReason'>,
): TemplateToast {
  switch (template.status) {
    case 'APPROVED':
      return { kind: 'success', message: `Template "${template.name}" approved` };
    case 'REJECTED':
      return {
        kind: 'error',
        message: `Meta rejected "${template.name}"${template.rejectionReason ? `: ${template.rejectionReason}` : ''}`,
      };
    case 'PENDING':
      return { kind: 'success', message: 'Template submitted for review' };
    default:
      return { kind: 'error', message: `Template "${template.name}" is ${template.status.toLowerCase()}` };
  }
}
