/**
 * WhatsApp-style template preview.
 *
 * Renders a green-tinted message bubble showing HEADER (text/image/etc.),
 * BODY (with `{{N}}` placeholders displayed as-is), FOOTER, and BUTTONS.
 * Not pixel-perfect — just enough for users to sanity-check what a HSM
 * template will look like before submitting it to Meta for approval.
 *
 * The component shape mirrors `WhatsAppTemplateComponent` from
 * packages/core/src/schemas/whatsapp-business.ts.
 */

import { cn } from '@/lib/utils';
import { Copy, FileText, Image as ImageIcon, Link2, Phone, Reply, Video } from 'lucide-react';

export interface PreviewButton {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';
  text: string;
  url?: string;
  phone_number?: string;
}

export interface TemplatePreviewProps {
  header?: { format: 'TEXT'; text: string } | { format: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION' } | null;
  body: string;
  footer?: string;
  buttons?: PreviewButton[];
}

export function TemplatePreview({ header, body, footer, buttons = [] }: TemplatePreviewProps) {
  return (
    <div className="rounded-2xl bg-emerald-50 p-3 dark:bg-emerald-950/30">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Preview</p>

      <div className="overflow-hidden rounded-xl bg-[#dcf8c6] shadow-md dark:bg-[#1a3a2a]">
        {/* Header */}
        {header && header.format === 'TEXT' && header.text && (
          <div className="px-3 pb-1 pt-2">
            <p className="text-sm font-semibold text-foreground">{header.text}</p>
          </div>
        )}
        {header && header.format !== 'TEXT' && (
          <div
            className={cn(
              'flex items-center justify-center bg-[#c8e6c9] dark:bg-[#1e4d35]',
              header.format === 'DOCUMENT' ? 'h-10' : 'h-24',
            )}
          >
            {header.format === 'IMAGE' && <ImageIcon className="h-8 w-8 text-emerald-700 dark:text-emerald-300" />}
            {header.format === 'VIDEO' && <Video className="h-8 w-8 text-emerald-700 dark:text-emerald-300" />}
            {header.format === 'DOCUMENT' && <FileText className="h-6 w-6 text-emerald-700 dark:text-emerald-300" />}
            {header.format === 'LOCATION' && (
              <span className="text-xs text-emerald-700 dark:text-emerald-300">[location]</span>
            )}
          </div>
        )}

        {/* Body */}
        <div className="px-3 py-2">
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{body || '-'}</p>
        </div>

        {/* Footer */}
        {footer && (
          <div className="px-3 pb-2">
            <p className="text-xs text-muted-foreground">{footer}</p>
          </div>
        )}

        {/* Buttons */}
        {buttons.length > 0 && (
          <div className="border-t border-black/5 dark:border-white/5">
            {buttons.map((btn, idx) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: preview-only list, no reordering
                key={idx}
                className={cn(
                  'flex items-center justify-center gap-1 py-1.5 text-center text-xs font-medium text-primary',
                  idx < buttons.length - 1 && 'border-b border-black/5 dark:border-white/5',
                )}
              >
                {btn.type === 'URL' && <Link2 className="h-3 w-3" />}
                {btn.type === 'PHONE_NUMBER' && <Phone className="h-3 w-3" />}
                {btn.type === 'QUICK_REPLY' && <Reply className="h-3 w-3" />}
                {btn.type === 'COPY_CODE' && <Copy className="h-3 w-3" />}
                <span>{btn.text || (btn.type === 'COPY_CODE' ? 'Copy code' : 'Button')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
