/**
 * Document Processor
 *
 * Extracts text from documents using local libraries with Gemini OCR fallback for scanned PDFs.
 *
 * Supports:
 * - PDF: pdf-parse (local)
 * - Word: mammoth (local)
 * - Excel: xlsx (local)
 * - Text/Markdown/JSON: direct read
 * - Scanned PDFs: Gemini Vision (fallback)
 */

import { readFileSync } from 'node:fs';
import { type GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';

import { calculateCost } from '../pricing';
import type { ProcessOptions, ProcessingResult } from '../types';
import { BaseProcessor } from './base';

/** Minimum text length to consider extraction successful (below this, assume scanned PDF) */
const MIN_TEXT_LENGTH = 50;

/** JSON file size threshold for summarization (~500 tokens, file path is saved for full access) */
const JSON_SUMMARIZE_THRESHOLD = 2 * 1024;

/** Max array examples to show in JSON summary */
const JSON_MAX_ARRAY_EXAMPLES = 3;

/** Gemini prompt for document OCR */
const GEMINI_OCR_PROMPT = `Extract and transcribe all text content from this document image.

Instructions:
1. Transcribe ALL visible text exactly as written
2. Preserve the document structure (headings, paragraphs, lists)
3. Use markdown formatting for structure
4. If there are tables, format them as markdown tables
5. If there are images with captions, note them as [Image: caption]
6. Maintain the reading order (top to bottom, left to right)

Output the complete text content in markdown format.`;

/**
 * Document processor using local libs with Gemini OCR fallback
 */
export class DocumentProcessor extends BaseProcessor {
  readonly name = 'document';
  readonly supportedMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
  ] as const;

  private geminiClient: GoogleGenerativeAI | null = null;
  private geminiModel: GenerativeModel | null = null;

  /**
   * Get lazy-initialized Gemini model for OCR fallback
   */
  private getGeminiModel(): GenerativeModel | null {
    if (!this.geminiModel && this.config.geminiApiKey) {
      this.geminiClient = new GoogleGenerativeAI(this.config.geminiApiKey);
      this.geminiModel = this.geminiClient.getGenerativeModel({ model: 'gemini-2.5-flash' });
      this.log.info('Gemini model initialized for document OCR');
    }
    return this.geminiModel;
  }

  async process(filePath: string, mimeType: string, _options?: ProcessOptions): Promise<ProcessingResult> {
    const startTime = performance.now();
    const normalizedMime = mimeType.toLowerCase();

    let result: ProcessingResult;

    // Route to appropriate processor based on MIME type
    if (normalizedMime === 'application/pdf') {
      result = await this.processPdf(filePath);
    } else if (
      normalizedMime === 'application/msword' ||
      normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      result = await this.processWord(filePath);
    } else if (
      normalizedMime === 'application/vnd.ms-excel' ||
      normalizedMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) {
      result = await this.processExcel(filePath);
    } else if (normalizedMime === 'text/csv') {
      result = await this.processCsv(filePath);
    } else if (normalizedMime === 'text/plain' || normalizedMime === 'text/markdown') {
      result = await this.processText(filePath, normalizedMime === 'text/markdown');
    } else if (normalizedMime === 'application/json') {
      result = await this.processJson(filePath);
    } else {
      result = this.createFailedResult(`Unsupported document type: ${mimeType}`, 'local', 'unknown');
    }

    // Update processing time
    result.processingTimeMs = Math.round(performance.now() - startTime);

    if (result.success) {
      this.log.info('Document extraction successful', {
        provider: result.provider,
        model: result.model,
        processingTimeMs: result.processingTimeMs,
        contentLength: result.content?.length ?? 0,
      });
    } else {
      this.log.error('Document extraction failed', { error: result.errorMessage });
    }

    return result;
  }

  /**
   * Process PDF using pdf-parse with Gemini OCR fallback
   */
  private async processPdf(filePath: string): Promise<ProcessingResult> {
    try {
      // Dynamic import for pdf-parse
      const pdfParse = (await import('pdf-parse')).default;

      const dataBuffer = readFileSync(filePath);
      const data = await pdfParse(dataBuffer);

      const text = data.text?.trim() ?? '';

      // If text is too short, assume scanned PDF and use OCR
      if (text.length < MIN_TEXT_LENGTH) {
        this.log.info('PDF appears to be scanned, trying OCR fallback...');
        return this.processWithGeminiOcr(filePath);
      }

      return {
        success: true,
        content: text,
        contentFormat: 'text',
        processingType: 'extraction',
        provider: 'local',
        model: 'pdf-parse',
        processingTimeMs: 0,
        costCents: 0,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error('PDF extraction failed', { error: errorMsg });

      // Try OCR fallback on error
      if (this.config.geminiApiKey) {
        this.log.info('PDF extraction failed, trying OCR fallback...');
        return this.processWithGeminiOcr(filePath);
      }

      return this.createFailedResult(errorMsg, 'local', 'pdf-parse');
    }
  }

  /**
   * Process Word document using mammoth
   */
  private async processWord(filePath: string): Promise<ProcessingResult> {
    try {
      const mammoth = await import('mammoth');

      const result = await mammoth.extractRawText({ path: filePath });
      const text = result.value?.trim() ?? '';

      if (result.messages.length > 0) {
        this.log.debug('Mammoth warnings', { messages: result.messages });
      }

      return {
        success: true,
        content: text,
        contentFormat: 'text',
        processingType: 'extraction',
        provider: 'local',
        model: 'mammoth',
        processingTimeMs: 0,
        costCents: 0,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error('Word extraction failed', { error: errorMsg });
      return this.createFailedResult(errorMsg, 'local', 'mammoth');
    }
  }

  /**
   * Process Excel file using xlsx
   */
  private async processExcel(filePath: string): Promise<ProcessingResult> {
    try {
      const XLSX = await import('xlsx');

      const workbook = XLSX.readFile(filePath);
      const sheets: string[] = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (sheet) {
          const csv = XLSX.utils.sheet_to_csv(sheet);
          sheets.push(`## ${sheetName}\n\n${csv}`);
        }
      }

      const content = sheets.join('\n\n---\n\n');

      return {
        success: true,
        content,
        contentFormat: 'markdown',
        processingType: 'extraction',
        provider: 'local',
        model: 'xlsx',
        processingTimeMs: 0,
        costCents: 0,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error('Excel extraction failed', { error: errorMsg });
      return this.createFailedResult(errorMsg, 'local', 'xlsx');
    }
  }

  /**
   * Process CSV file
   */
  private async processCsv(filePath: string): Promise<ProcessingResult> {
    try {
      const content = readFileSync(filePath, 'utf-8');

      return {
        success: true,
        content,
        contentFormat: 'text',
        processingType: 'extraction',
        provider: 'local',
        model: 'text',
        processingTimeMs: 0,
        costCents: 0,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return this.createFailedResult(errorMsg, 'local', 'text');
    }
  }

  /**
   * Process plain text or markdown files
   */
  private async processText(filePath: string, isMarkdown: boolean): Promise<ProcessingResult> {
    try {
      const content = readFileSync(filePath, 'utf-8');

      return {
        success: true,
        content,
        contentFormat: isMarkdown ? 'markdown' : 'text',
        processingType: 'extraction',
        provider: 'local',
        model: 'text',
        processingTimeMs: 0,
        costCents: 0,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return this.createFailedResult(errorMsg, 'local', 'text');
    }
  }

  /**
   * Process JSON files - small files returned as-is, large files get schema summary
   */
  private async processJson(filePath: string): Promise<ProcessingResult> {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      // For small JSON files, return as-is
      if (content.length < JSON_SUMMARIZE_THRESHOLD) {
        return {
          success: true,
          content,
          contentFormat: 'json',
          processingType: 'extraction',
          provider: 'local',
          model: 'json',
          processingTimeMs: 0,
          costCents: 0,
        };
      }

      // For larger JSON, generate a schema summary with examples
      const summary = this.generateJsonSummary(data);

      return {
        success: true,
        content: summary,
        contentFormat: 'markdown',
        processingType: 'extraction',
        provider: 'local',
        model: 'json-schema',
        processingTimeMs: 0,
        costCents: 0,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return this.createFailedResult(errorMsg, 'local', 'json');
    }
  }

  /**
   * Generate a schema summary of JSON data with examples
   */
  private generateJsonSummary(data: unknown, depth = 0, maxDepth = 5): string {
    const indent = '  '.repeat(depth);

    // Handle primitives first (no depth limit for primitives)
    if (data === null) {
      return 'null';
    }

    if (typeof data !== 'object') {
      return this.getValuePreview(data);
    }

    // Check depth limit for complex types
    if (depth > maxDepth) {
      if (Array.isArray(data)) {
        return `Array[${data.length} items] (...)`;
      }
      return `Object {...}`;
    }

    if (Array.isArray(data)) {
      if (data.length === 0) {
        return '[] (empty array)';
      }

      // For primitive arrays, show inline
      const firstItem = data[0];
      if (typeof firstItem !== 'object' || firstItem === null) {
        const preview = data.slice(0, JSON_MAX_ARRAY_EXAMPLES).map((v) => this.getValuePreview(v)).join(', ');
        const suffix = data.length > JSON_MAX_ARRAY_EXAMPLES ? `, ... +${data.length - JSON_MAX_ARRAY_EXAMPLES} more` : '';
        return `[${preview}${suffix}]`;
      }

      // For object arrays, show structure
      const lines: string[] = [];
      lines.push(`Array[${data.length} items]:`);

      const examples = data.slice(0, JSON_MAX_ARRAY_EXAMPLES);
      for (let i = 0; i < examples.length; i++) {
        lines.push(`${indent}  [${i}]: ${this.generateJsonSummary(examples[i], depth + 2, maxDepth)}`);
      }

      if (data.length > JSON_MAX_ARRAY_EXAMPLES) {
        lines.push(`${indent}  ... and ${data.length - JSON_MAX_ARRAY_EXAMPLES} more items`);
      }

      return lines.join('\n');
    }

    // Object handling
    const obj = data as Record<string, unknown>;
    const keys = Object.keys(obj);

    if (keys.length === 0) {
      return '{} (empty object)';
    }

    const lines: string[] = [];
    lines.push(`Object {${keys.length} keys}:`);

    for (const key of keys) {
      const value = obj[key];
      const valueType = this.getJsonValueType(value);

      if (valueType === 'object' || valueType === 'array') {
        lines.push(`${indent}  "${key}": ${this.generateJsonSummary(value, depth + 2, maxDepth)}`);
      } else {
        const preview = this.getValuePreview(value);
        lines.push(`${indent}  "${key}": ${valueType} = ${preview}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get the type description for a JSON value
   */
  private getJsonValueType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  /**
   * Get a preview string for a primitive value
   */
  private getValuePreview(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'string') {
      if (value.length > 50) {
        return `"${value.substring(0, 50)}..."`;
      }
      return `"${value}"`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return String(value);
  }

  /**
   * Process document with Gemini OCR (for scanned PDFs)
   */
  private async processWithGeminiOcr(filePath: string): Promise<ProcessingResult> {
    const model = this.getGeminiModel();
    if (!model) {
      return this.createFailedResult('Gemini not configured for OCR fallback (missing API key)', 'local', 'pdf-parse');
    }

    try {
      const pdfData = readFileSync(filePath);

      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: pdfData.toString('base64'),
          },
        },
        { text: GEMINI_OCR_PROMPT },
      ]);

      const response = result.response;
      const text = response.text();
      const usageMetadata = response.usageMetadata;

      const inputTokens = usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = usageMetadata?.candidatesTokenCount ?? 0;

      const costCents = calculateCost('gemini_vision', 'gemini-2.5-flash', {
        inputTokens,
        outputTokens,
      });

      return {
        success: true,
        content: text.trim(),
        contentFormat: 'markdown',
        processingType: 'extraction',
        provider: 'google',
        model: 'gemini-2.5-flash',
        processingTimeMs: 0,
        inputTokens,
        outputTokens,
        costCents,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error('Gemini OCR failed', { error: errorMsg });
      return this.createFailedResult(errorMsg, 'google', 'gemini-2.5-flash');
    }
  }

  /**
   * Override createFailedResult to use 'extraction' processing type
   */
  protected override createFailedResult(errorMessage: string, provider: string, model: string): ProcessingResult {
    return {
      success: false,
      contentFormat: 'text',
      processingType: 'extraction',
      provider,
      model,
      processingTimeMs: 0,
      costCents: 0,
      errorMessage,
    };
  }
}
