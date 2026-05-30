/**
 * Tests for media processors
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AudioProcessor, DocumentProcessor, ImageProcessor, VideoProcessor } from '../src/processors';
import type { ProcessorConfig } from '../src/types';

const mockConfig: ProcessorConfig = {
  groqApiKey: undefined,
  openaiApiKey: undefined,
  geminiApiKey: undefined,
  defaultLanguage: 'pt',
  maxFileSizeMb: 25,
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('processors', () => {
  describe('AudioProcessor', () => {
    const processor = new AudioProcessor(mockConfig);

    describe('canProcess', () => {
      it('handles audio/* wildcard', () => {
        expect(processor.canProcess('audio/ogg')).toBe(true);
        expect(processor.canProcess('audio/mp3')).toBe(true);
        expect(processor.canProcess('audio/wav')).toBe(true);
        expect(processor.canProcess('audio/unknown')).toBe(true);
      });

      it('handles specific audio types', () => {
        expect(processor.canProcess('audio/opus')).toBe(true);
        expect(processor.canProcess('audio/webm')).toBe(true);
        expect(processor.canProcess('audio/m4a')).toBe(true);
      });

      it('rejects non-audio types', () => {
        expect(processor.canProcess('image/jpeg')).toBe(false);
        expect(processor.canProcess('video/mp4')).toBe(false);
        expect(processor.canProcess('application/pdf')).toBe(false);
      });

      it('handles empty/null mime types', () => {
        expect(processor.canProcess('')).toBe(false);
      });
    });

    describe('process (without API keys)', () => {
      it('returns error when no API keys configured', async () => {
        const result = await processor.process('/nonexistent/audio.ogg', 'audio/ogg');
        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain('not configured');
      });
    });

    it('falls back from OpenAI audio-chat to OpenAI transcriptions before Gemini/Groq', async () => {
      const audioPath = join(tmpdir(), `omni-audio-processor-${Date.now()}.mp3`);
      await writeFile(audioPath, Buffer.from('fake-audio'));
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).includes('/chat/completions')) {
          return new Response('audio chat unavailable', { status: 400 });
        }
        return new Response(JSON.stringify({ text: 'fallback transcript' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      try {
        const processorWithOpenAi = new AudioProcessor({
          ...mockConfig,
          openaiApiKey: 'test-openai-key',
          geminiApiKey: 'test-gemini-key',
          groqApiKey: undefined,
          audioProvider: 'openai',
          audioModel: 'gpt-audio-mini',
        });

        const result = await processorWithOpenAi.process(audioPath, 'audio/mpeg', { language: 'pt-BR' });

        expect(result.success).toBe(true);
        expect(result.content).toBe('fallback transcript');
        expect(result.provider).toBe('openai');
        expect(result.model).toBe('gpt-4o-transcribe');
        expect(calls.map((call) => call.url)).toEqual([
          'https://api.openai.com/v1/chat/completions',
          'https://api.openai.com/v1/audio/transcriptions',
        ]);
      } finally {
        await rm(audioPath, { force: true });
      }
    });

    it('does not use synchronous ffmpeg/file normalization in the event loop', () => {
      const source = readFileSync(new URL('../src/processors/audio.ts', import.meta.url), 'utf8');
      expect(source).not.toContain('execFileSync');
      expect(source).not.toContain('readFileSync');
      expect(source).not.toContain('mkdtempSync');
      expect(source).not.toContain('rmSync');
    });

    it('checks provider upload limit after ffmpeg normalization', () => {
      const source = readFileSync(new URL('../src/processors/audio.ts', import.meta.url), 'utf8');
      expect(source).toContain('const normalizedStats = await fs.stat(output);');
      expect(source).toContain('normalizedStats.size > PROVIDER_AUDIO_TARGET_BYTES');
      expect(source).toContain('Normalized audio still exceeds provider upload limit');
    });
  });

  describe('ImageProcessor', () => {
    const processor = new ImageProcessor(mockConfig);

    describe('canProcess', () => {
      it('handles image/* wildcard', () => {
        expect(processor.canProcess('image/jpeg')).toBe(true);
        expect(processor.canProcess('image/png')).toBe(true);
        expect(processor.canProcess('image/gif')).toBe(true);
      });

      it('handles specific image types', () => {
        expect(processor.canProcess('image/webp')).toBe(true);
        expect(processor.canProcess('image/heic')).toBe(true);
      });

      it('rejects non-image types', () => {
        expect(processor.canProcess('audio/ogg')).toBe(false);
        expect(processor.canProcess('video/mp4')).toBe(false);
        expect(processor.canProcess('application/pdf')).toBe(false);
      });
    });

    describe('process (without API keys)', () => {
      it('returns error when no API keys configured', async () => {
        const result = await processor.process('/nonexistent/image.jpg', 'image/jpeg');
        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain('API');
      });
    });
  });

  describe('DocumentProcessor', () => {
    const processor = new DocumentProcessor(mockConfig);

    describe('canProcess', () => {
      it('handles PDF', () => {
        expect(processor.canProcess('application/pdf')).toBe(true);
      });

      it('handles Word documents', () => {
        expect(processor.canProcess('application/msword')).toBe(true);
        expect(processor.canProcess('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(
          true,
        );
      });

      it('handles Excel documents', () => {
        expect(processor.canProcess('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
      });

      it('handles text files', () => {
        expect(processor.canProcess('text/plain')).toBe(true);
        expect(processor.canProcess('text/markdown')).toBe(true);
        expect(processor.canProcess('text/csv')).toBe(true);
        expect(processor.canProcess('application/json')).toBe(true);
      });

      it('rejects non-document types', () => {
        expect(processor.canProcess('audio/ogg')).toBe(false);
        expect(processor.canProcess('image/jpeg')).toBe(false);
        expect(processor.canProcess('video/mp4')).toBe(false);
      });
    });

    it('falls back to OOXML extraction when ExcelJS cannot parse workbook metadata', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      zip.file(
        '[Content_Types].xml',
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
      );
      zip.file(
        'docProps/core.xml',
        '<?xml version="1.0"?><coreProperties><lastModifiedBy>Some User</lastModifiedBy></coreProperties>',
      );
      zip.file(
        'xl/workbook.xml',
        '<?xml version="1.0"?><workbook><sheets><sheet name="Budget &amp; Ops" sheetId="1" r:id="rId1"/></sheets></workbook>',
      );
      zip.file('xl/sharedStrings.xml', '<sst><si><t>Name</t></si><si><t>Total</t></si><si><t>ACME, Inc</t></si></sst>');
      zip.file(
        'xl/worksheets/sheet1.xml',
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>',
      );

      const excelPath = join(tmpdir(), `omni-excel-fallback-${Date.now()}.xlsx`);
      await writeFile(excelPath, Buffer.from(await zip.generateAsync({ type: 'uint8array' })));

      try {
        const result = await processor.process(
          excelPath,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );

        expect(result.success).toBe(true);
        expect(result.model).toBe('xlsx-ooxml-fallback');
        expect(result.content).toContain('## Budget & Ops');
        expect(result.content).toContain('Name,Total');
        expect(result.content).toContain('"ACME, Inc",42');
      } finally {
        await rm(excelPath, { force: true });
      }
    });
  });

  describe('VideoProcessor', () => {
    const processor = new VideoProcessor(mockConfig);

    describe('canProcess', () => {
      it('handles common video types', () => {
        expect(processor.canProcess('video/mp4')).toBe(true);
        expect(processor.canProcess('video/webm')).toBe(true);
        expect(processor.canProcess('video/quicktime')).toBe(true);
      });

      it('handles additional video types', () => {
        expect(processor.canProcess('video/x-msvideo')).toBe(true);
        expect(processor.canProcess('video/mpeg')).toBe(true);
        expect(processor.canProcess('video/3gpp')).toBe(true);
      });

      it('rejects non-video types', () => {
        expect(processor.canProcess('audio/ogg')).toBe(false);
        expect(processor.canProcess('image/jpeg')).toBe(false);
        expect(processor.canProcess('application/pdf')).toBe(false);
      });
    });

    it('normalizes oversized videos before provider upload instead of dropping them', () => {
      const source = readFileSync(new URL('../src/processors/video.ts', import.meta.url), 'utf8');
      expect(source).toContain('prepareVideoForGemini');
      expect(source).not.toContain('Video too large');
    });

    describe('process (without API keys)', () => {
      it('returns error when no API keys configured', async () => {
        const result = await processor.process('/nonexistent/video.mp4', 'video/mp4');
        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain('API');
      });
    });
  });
});
