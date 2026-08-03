/**
 * WhatsApp HSM template builder.
 *
 * Lets users define a HEADER (text or image — toggle), BODY (with `{{N}}`
 * placeholders), FOOTER and a BUTTONS array (QUICK_REPLY / URL / PHONE_NUMBER
 * / COPY_CODE, up to 10). Submits via POST /api/v2/instances/:id/whatsapp-templates.
 *
 * Mirrors `WhatsAppTemplateComponent` from packages/core/src/schemas/whatsapp-business.ts.
 *
 * Tailwind-only — no MUI primitives. Use plain inputs/buttons; no design-system
 * <Select>, <FormGroup>, <Accordion> exist yet in apps/ui — we improvise with
 * native HTML controls.
 *
 * TODO: switch to omni.templates.create(...) after make sdk-generate.
 */

import { type PreviewButton, TemplatePreview } from '@/components/templates/TemplatePreview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { apiFetch } from '@/lib/sdk';
import { cn } from '@/lib/utils';
import { AlertCircle, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

// ---------------------------------------------------------------------------
// Constants (mirror packages/core/src/schemas/whatsapp-business.ts)
// ---------------------------------------------------------------------------

const MAX_BUTTONS = 10;
const MAX_BODY_CHARS = 1024;
const MAX_HEADER_CHARS = 60;
const MAX_FOOTER_CHARS = 60;
const MAX_BUTTON_TEXT = 25;

const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
type Category = (typeof CATEGORIES)[number];

const LANGUAGES = [
  { code: 'pt_BR', label: 'Portuguese (BR)' },
  { code: 'en_US', label: 'English (US)' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
];

// Header format selector — IMAGE-only for now (the simplest media path); the
// wish allows VIDEO/DOCUMENT/LOCATION but those require an extra upload-handle
// step we keep out of v1.
type HeaderMode = 'NONE' | 'TEXT' | 'IMAGE';

interface TemplateButtonDraft {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';
  text: string;
  url?: string;
  phone_number?: string;
  example?: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TemplateBuilderProps {
  instanceId: string;
  onCreated: () => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------

export function TemplateBuilder({ instanceId, onCreated, onCancel }: TemplateBuilderProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('MARKETING');
  const [language, setLanguage] = useState('pt_BR');

  const [headerMode, setHeaderMode] = useState<HeaderMode>('NONE');
  const [headerText, setHeaderText] = useState('');
  const [headerImageHandle, setHeaderImageHandle] = useState('');

  const [body, setBody] = useState('');
  const [footer, setFooter] = useState('');
  const [buttons, setButtons] = useState<TemplateButtonDraft[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  const nameError = useMemo(() => {
    if (!name) return 'Required';
    if (!/^[a-z0-9_]+$/.test(name)) return 'Use lowercase letters, numbers and underscores only';
    return null;
  }, [name]);

  const bodyError = useMemo(() => {
    if (!body.trim()) return 'Body is required';
    if (body.length > MAX_BODY_CHARS) return `Max ${MAX_BODY_CHARS} characters`;
    return null;
  }, [body]);

  const buttonErrors = useMemo<(string | null)[]>(() => {
    return buttons.map((btn) => {
      if (!btn.text && btn.type !== 'COPY_CODE') return 'Button text is required';
      if (btn.type === 'URL' && !btn.url) return 'URL is required';
      if (btn.type === 'PHONE_NUMBER' && !btn.phone_number) return 'Phone number is required';
      return null;
    });
  }, [buttons]);

  const isValid = !nameError && !bodyError && buttonErrors.every((e) => !e);

  // -------------------------------------------------------------------------
  // Mutators
  // -------------------------------------------------------------------------

  const addButton = useCallback((type: TemplateButtonDraft['type']) => {
    setButtons((prev) => {
      if (prev.length >= MAX_BUTTONS) return prev;
      const next: TemplateButtonDraft = { type, text: '' };
      if (type === 'URL') next.url = '';
      if (type === 'PHONE_NUMBER') next.phone_number = '';
      if (type === 'COPY_CODE') {
        next.text = 'Copy code';
        next.example = '';
      }
      return [...prev, next];
    });
  }, []);

  const updateButton = useCallback((idx: number, patch: Partial<TemplateButtonDraft>) => {
    setButtons((prev) => prev.map((btn, i) => (i === idx ? { ...btn, ...patch } : btn)));
  }, []);

  const removeButton = useCallback((idx: number) => {
    setButtons((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // -------------------------------------------------------------------------
  // Build payload + submit
  // -------------------------------------------------------------------------

  const buildComponents = useCallback(() => {
    type Component =
      | { type: 'HEADER'; format: 'TEXT' | 'IMAGE'; text?: string; example?: { header_handle?: string[] } }
      | { type: 'BODY'; text: string }
      | { type: 'FOOTER'; text: string }
      | { type: 'BUTTONS'; buttons: TemplateButtonDraft[] };

    const components: Component[] = [];
    if (headerMode === 'TEXT' && headerText) {
      components.push({ type: 'HEADER', format: 'TEXT', text: headerText });
    } else if (headerMode === 'IMAGE' && headerImageHandle) {
      components.push({
        type: 'HEADER',
        format: 'IMAGE',
        example: { header_handle: [headerImageHandle] },
      });
    }
    components.push({ type: 'BODY', text: body });
    if (footer) components.push({ type: 'FOOTER', text: footer });
    if (buttons.length > 0) components.push({ type: 'BUTTONS', buttons });
    return components;
  }, [body, buttons, footer, headerImageHandle, headerMode, headerText]);

  const handleSubmit = useCallback(async () => {
    if (!isValid || submitting) return;
    setErrorMessage('');
    setSubmitting(true);
    try {
      // TODO: switch to omni.templates.create(...) after make sdk-generate
      const res = await apiFetch(`/instances/${instanceId}/whatsapp-templates`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          language,
          category,
          components: buildComponents(),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Create failed: ${res.status}`);
      }
      onCreated();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create template.');
    } finally {
      setSubmitting(false);
    }
  }, [buildComponents, category, instanceId, isValid, language, name, onCreated, submitting]);

  // -------------------------------------------------------------------------
  // Preview helpers
  // -------------------------------------------------------------------------

  const previewButtons: PreviewButton[] = buttons.map((btn) => ({
    type: btn.type,
    text: btn.text,
    url: btn.url,
    phone_number: btn.phone_number,
  }));

  const previewHeader =
    headerMode === 'TEXT' && headerText
      ? { format: 'TEXT' as const, text: headerText }
      : headerMode === 'IMAGE'
        ? { format: 'IMAGE' as const }
        : null;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* Form */}
      <div className="space-y-4">
        {/* Name + category + language */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="tpl-name" className="text-xs font-medium">
              Name
            </label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              placeholder="welcome_message"
            />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="tpl-category" className="text-xs font-medium">
              Category
            </label>
            <select
              id="tpl-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="flex h-10 w-full rounded-md border border-input bg-input/50 px-3 py-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="tpl-language" className="text-xs font-medium">
              Language
            </label>
            <select
              id="tpl-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-input/50 px-3 py-2 text-sm"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Header */}
        <div className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">Header (optional)</p>
            <div className="flex gap-1 rounded-md border p-0.5">
              {(['NONE', 'TEXT', 'IMAGE'] as HeaderMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setHeaderMode(mode)}
                  className={cn(
                    'rounded px-2 py-1 text-xs transition-colors',
                    headerMode === mode ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  {mode === 'NONE' ? 'None' : mode === 'TEXT' ? 'Text' : 'Image'}
                </button>
              ))}
            </div>
          </div>

          {headerMode === 'TEXT' && (
            <div className="space-y-1">
              <Input
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value.slice(0, MAX_HEADER_CHARS))}
                placeholder="Welcome to our store!"
                maxLength={MAX_HEADER_CHARS}
              />
              <p className="text-right text-xs text-muted-foreground">
                {headerText.length}/{MAX_HEADER_CHARS}
              </p>
            </div>
          )}

          {headerMode === 'IMAGE' && (
            <div className="space-y-1">
              <Input
                value={headerImageHandle}
                onChange={(e) => setHeaderImageHandle(e.target.value)}
                placeholder="Header media handle (from /upload-header-media)"
              />
              <p className="text-xs text-muted-foreground">
                Upload an image first via the upload-header-media endpoint and paste the returned handle here.
              </p>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="space-y-1">
          <label htmlFor="tpl-body" className="text-sm font-medium">
            Body
          </label>
          <textarea
            id="tpl-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            maxLength={MAX_BODY_CHARS}
            className="flex w-full rounded-md border border-input bg-input/50 px-3 py-2 text-sm"
            placeholder={'Hello {{1}}, your order {{2}} is confirmed.'}
          />
          <div className="flex justify-between text-xs">
            <span className={cn('text-muted-foreground', bodyError && 'text-destructive')}>
              {bodyError ?? 'Use {{1}}, {{2}}... for placeholders'}
            </span>
            <span className="text-muted-foreground">
              {body.length}/{MAX_BODY_CHARS}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="space-y-1">
          <label htmlFor="tpl-footer" className="text-sm font-medium">
            Footer (optional)
          </label>
          <Input
            id="tpl-footer"
            value={footer}
            onChange={(e) => setFooter(e.target.value.slice(0, MAX_FOOTER_CHARS))}
            placeholder="Reply STOP to unsubscribe"
            maxLength={MAX_FOOTER_CHARS}
          />
          <p className="text-right text-xs text-muted-foreground">
            {footer.length}/{MAX_FOOTER_CHARS}
          </p>
        </div>

        {/* Buttons */}
        <div className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">
              Buttons ({buttons.length}/{MAX_BUTTONS})
            </p>
            <select
              value=""
              onChange={(e) => {
                const next = e.target.value;
                if (next) addButton(next as TemplateButtonDraft['type']);
              }}
              disabled={buttons.length >= MAX_BUTTONS}
              className="h-8 rounded-md border border-input bg-input/50 px-2 text-xs"
            >
              <option value="">+ Add button</option>
              <option value="QUICK_REPLY">Quick Reply</option>
              <option value="URL">URL</option>
              <option value="PHONE_NUMBER">Phone Number</option>
              <option value="COPY_CODE">Copy Code</option>
            </select>
          </div>

          {buttons.length === 0 ? (
            <p className="text-xs text-muted-foreground">No buttons yet. Add up to {MAX_BUTTONS}.</p>
          ) : (
            <div className="space-y-3">
              {buttons.map((btn, idx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: editable list with explicit remove
                <div key={idx} className="rounded-md border bg-card/40 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{btn.type}</span>
                    <button
                      type="button"
                      onClick={() => removeButton(idx)}
                      className="text-destructive hover:opacity-80"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    <Input
                      value={btn.text}
                      onChange={(e) => updateButton(idx, { text: e.target.value.slice(0, MAX_BUTTON_TEXT) })}
                      placeholder="Button text"
                      maxLength={MAX_BUTTON_TEXT}
                    />
                    {btn.type === 'URL' && (
                      <Input
                        value={btn.url ?? ''}
                        onChange={(e) => updateButton(idx, { url: e.target.value })}
                        placeholder="https://example.com/{{1}}"
                      />
                    )}
                    {btn.type === 'PHONE_NUMBER' && (
                      <Input
                        value={btn.phone_number ?? ''}
                        onChange={(e) => updateButton(idx, { phone_number: e.target.value })}
                        placeholder="+15551234567"
                      />
                    )}
                    {btn.type === 'COPY_CODE' && (
                      <Input
                        value={btn.example ?? ''}
                        onChange={(e) => updateButton(idx, { example: e.target.value })}
                        placeholder="ABC123 (example code)"
                      />
                    )}
                    {buttonErrors[idx] && <p className="text-xs text-destructive">{buttonErrors[idx]}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {errorMessage && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p className="break-words">{errorMessage}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || submitting}>
            {submitting ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Creating...
              </>
            ) : (
              'Create template'
            )}
          </Button>
        </div>
      </div>

      {/* Preview column */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <TemplatePreview header={previewHeader} body={body} footer={footer} buttons={previewButtons} />
      </div>
    </div>
  );
}
