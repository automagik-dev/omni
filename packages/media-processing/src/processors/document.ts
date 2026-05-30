/**
 * Document Processor
 *
 * Extracts text from documents using local libraries with Gemini OCR fallback for scanned PDFs.
 *
 * Supports:
 * - PDF: pdf-parse (local)
 * - Word: mammoth (local)
 * - Excel: exceljs (local, xlsx/xlsm only)
 * - Text/Markdown/JSON: direct read
 * - Scanned PDFs: Gemini Vision (fallback)
 *
 * Uses centralized retry + circuit breaker for Gemini OCR calls.
 */

import { readFileSync } from 'node:fs';
import { type GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';

import { GEMINI_MODEL } from '../models';
import { calculateCost } from '../pricing';
import { DOCUMENT_OCR_PROMPT } from '../prompts';
import type { ProcessOptions, ProcessingResult } from '../types';
import { getMediaTimeouts } from '../types';
import { BaseProcessor } from './base';

/** Minimum text length to consider extraction successful (below this, assume scanned PDF) */
const MIN_TEXT_LENGTH = 50;

/** JSON file size threshold for summarization (~500 tokens, file path is saved for full access) */
const JSON_SUMMARIZE_THRESHOLD = 2 * 1024;

/** Max array examples to show in JSON summary */
const JSON_MAX_ARRAY_EXAMPLES = 3;

/**
 * Document processor using local libs with Gemini OCR fallback
 */
export class DocumentProcessor extends BaseProcessor {
  readonly name = 'document';
  readonly supportedMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
      this.geminiModel = this.geminiClient.getGenerativeModel({ model: GEMINI_MODEL });
      this.log.info('Gemini model initialized for document OCR');
    }
    return this.geminiModel;
  }

  async process(filePath: string, mimeType: string, options?: ProcessOptions): Promise<ProcessingResult> {
    const startTime = performance.now();
    const normalizedMime = mimeType.toLowerCase();
    const ocrPrompt = options?.prompt ?? DOCUMENT_OCR_PROMPT;

    let result: ProcessingResult;

    // Route to appropriate processor based on MIME type
    if (normalizedMime === 'application/pdf') {
      result = await this.processPdf(filePath, ocrPrompt);
    } else if (
      normalizedMime === 'application/msword' ||
      normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      result = await this.processWord(filePath);
    } else if (normalizedMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
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
  private async processPdf(filePath: string, ocrPrompt: string): Promise<ProcessingResult> {
    try {
      // Dynamic import for pdf-parse
      const pdfParse = (await import('pdf-parse')).default;

      const dataBuffer = readFileSync(filePath);
      const data = await pdfParse(dataBuffer);

      const text = data.text?.trim() ?? '';

      // If text is too short, assume scanned PDF and use OCR
      if (text.length < MIN_TEXT_LENGTH) {
        this.log.info('PDF appears to be scanned, trying OCR fallback...');
        return this.processWithGeminiOcr(filePath, ocrPrompt);
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
        return this.processWithGeminiOcr(filePath, ocrPrompt);
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
   * Process Excel file using exceljs (xlsx/xlsm only — no legacy .xls)
   */
  private async processExcel(filePath: string): Promise<ProcessingResult> {
    try {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      const sheets: string[] = [];
      for (const worksheet of workbook.worksheets) {
        const csv = this.worksheetToCsv(worksheet);
        sheets.push(`## ${worksheet.name}\n\n${csv}`);
      }

      return {
        success: true,
        content: sheets.join('\n\n---\n\n'),
        contentFormat: 'markdown',
        processingType: 'extraction',
        provider: 'local',
        model: 'exceljs',
        processingTimeMs: 0,
        costCents: 0,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.warn('ExcelJS extraction failed, trying OOXML fallback', { error: errorMsg });

      try {
        return await this.processExcelOoxmlFallback(filePath);
      } catch (fallbackError) {
        const fallbackErrorMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        this.log.error('Excel extraction failed', { error: errorMsg, fallbackError: fallbackErrorMsg });
      }

      return this.createFailedResult(errorMsg, 'local', 'exceljs');
    }
  }

  /**
   * Minimal OOXML .xlsx fallback for files that are valid enough to read but trip ExcelJS metadata parsing.
   * Observed in the wild: docProps/core.xml containing un-namespaced `<lastModifiedBy>` makes ExcelJS throw
   * before worksheets are read. This fallback ignores workbook metadata and extracts visible cell text directly.
   */
  private async processExcelOoxmlFallback(filePath: string): Promise<ProcessingResult> {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(readFileSync(filePath));

    const sharedStringsXml = await this.getZipText(zip, 'xl/sharedStrings.xml');
    const sharedStrings = sharedStringsXml ? this.parseSharedStrings(sharedStringsXml) : [];
    const sheetNames = await this.parseWorkbookSheetNames(zip);

    const sheetPaths = Object.keys(zip.files)
      .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (sheetPaths.length === 0) {
      throw new Error('No worksheet XML files found in XLSX archive');
    }

    const sheets: string[] = [];
    for (const [index, sheetPath] of sheetPaths.entries()) {
      const sheetXml = await this.getZipText(zip, sheetPath);
      if (!sheetXml) continue;
      const rows = this.parseWorksheetRows(sheetXml, sharedStrings);
      const sheetName = sheetNames[index] ?? `Sheet${index + 1}`;
      sheets.push(`## ${sheetName}\n\n${rows.join('\n')}`);
    }

    return {
      success: true,
      content: sheets.join('\n\n---\n\n'),
      contentFormat: 'markdown',
      processingType: 'extraction',
      provider: 'local',
      model: 'xlsx-ooxml-fallback',
      processingTimeMs: 0,
      costCents: 0,
    };
  }

  private async getZipText(zip: import('jszip'), path: string): Promise<string | null> {
    const file = zip.file(path);
    return file ? await file.async('text') : null;
  }

  private parseSharedStrings(xml: string): string[] {
    const strings: string[] = [];
    for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
      const siBody = si[1] ?? '';
      const text = [...siBody.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
        .map((match) => this.decodeXml(match[1] ?? ''))
        .join('');
      strings.push(text);
    }
    return strings;
  }

  private async parseWorkbookSheetNames(zip: import('jszip')): Promise<string[]> {
    const workbookXml = await this.getZipText(zip, 'xl/workbook.xml');
    if (!workbookXml) return [];

    return [...workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*>/gi)].map((match) =>
      this.decodeXml(match[1] ?? ''),
    );
  }

  private parseWorksheetRows(xml: string, sharedStrings: string[]): string[] {
    const rows: string[] = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
      const rowBody = rowMatch[1] ?? '';
      const cells = new Map<number, string>();
      for (const cellMatch of rowBody.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
        const attrs = cellMatch[1] ?? '';
        const body = cellMatch[2] ?? '';
        const ref = attrs.match(/\br="([A-Z]+)\d+"/i)?.[1];
        const colIndex = ref ? this.excelColumnToIndex(ref) : cells.size;
        cells.set(colIndex, this.csvEscape(this.parseWorksheetCellValue(attrs, body, sharedStrings)));
      }

      const width = cells.size > 0 ? Math.max(...cells.keys()) + 1 : 0;
      const values = Array.from({ length: width }, (_, idx) => cells.get(idx) ?? '');
      rows.push(values.join(','));
    }
    return rows;
  }

  private parseWorksheetCellValue(attrs: string, body: string, sharedStrings: string[]): string {
    const type = attrs.match(/\bt="([^"]+)"/i)?.[1];
    const rawValue = body.match(/<v>([\s\S]*?)<\/v>/i)?.[1];
    const inlineValue = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
      .map((match) => this.decodeXml(match[1] ?? ''))
      .join('');

    if (type === 's' && rawValue !== undefined) {
      return sharedStrings[Number(rawValue)] ?? '';
    }
    if (inlineValue) return inlineValue;
    if (rawValue !== undefined) return this.decodeXml(rawValue);
    return '';
  }

  private excelColumnToIndex(column: string): number {
    let index = 0;
    for (const char of column.toUpperCase()) {
      index = index * 26 + (char.charCodeAt(0) - 64);
    }
    return index - 1;
  }

  private csvEscape(value: string): string {
    return value.includes(',') || value.includes('"') || value.includes('\n')
      ? `"${value.replace(/"/g, '""')}"`
      : value;
  }

  private decodeXml(value: string): string {
    return value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  /**
   * Convert an ExcelJS worksheet to a CSV string.
   * ExcelJS row.values is 1-indexed (index 0 is undefined).
   */
  private worksheetToCsv(worksheet: import('exceljs').Worksheet): string {
    const rows: string[] = [];
    worksheet.eachRow((row) => {
      const values = (row.values as unknown[]).slice(1); // skip 1-indexed gap
      const csvRow = values
        .map((cell) => {
          if (cell === null || cell === undefined) return '';
          const str = String(cell);
          return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
        })
        .join(',');
      rows.push(csvRow);
    });
    return rows.join('\n');
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
    if (data === null) return 'null';
    if (typeof data !== 'object') return this.getValuePreview(data);
    if (depth > maxDepth) return this.getDepthLimitedPreview(data);

    if (Array.isArray(data)) {
      return this.summarizeArray(data, depth, maxDepth);
    }
    return this.summarizeObject(data as Record<string, unknown>, depth, maxDepth);
  }

  /** Get preview when depth limit is exceeded */
  private getDepthLimitedPreview(data: unknown): string {
    if (Array.isArray(data)) {
      return `Array[${data.length} items] (...)`;
    }
    return 'Object {...}';
  }

  /** Summarize an array value */
  private summarizeArray(data: unknown[], depth: number, maxDepth: number): string {
    if (data.length === 0) return '[] (empty array)';

    const firstItem = data[0];
    if (typeof firstItem !== 'object' || firstItem === null) {
      return this.summarizePrimitiveArray(data);
    }
    return this.summarizeObjectArray(data, depth, maxDepth);
  }

  /** Summarize array of primitives inline */
  private summarizePrimitiveArray(data: unknown[]): string {
    const preview = data
      .slice(0, JSON_MAX_ARRAY_EXAMPLES)
      .map((v) => this.getValuePreview(v))
      .join(', ');
    const suffix = data.length > JSON_MAX_ARRAY_EXAMPLES ? `, ... +${data.length - JSON_MAX_ARRAY_EXAMPLES} more` : '';
    return `[${preview}${suffix}]`;
  }

  /** Summarize array of objects with structure */
  private summarizeObjectArray(data: unknown[], depth: number, maxDepth: number): string {
    const indent = '  '.repeat(depth);
    const lines: string[] = [`Array[${data.length} items]:`];

    const examples = data.slice(0, JSON_MAX_ARRAY_EXAMPLES);
    for (let i = 0; i < examples.length; i++) {
      lines.push(`${indent}  [${i}]: ${this.generateJsonSummary(examples[i], depth + 2, maxDepth)}`);
    }

    if (data.length > JSON_MAX_ARRAY_EXAMPLES) {
      lines.push(`${indent}  ... and ${data.length - JSON_MAX_ARRAY_EXAMPLES} more items`);
    }

    return lines.join('\n');
  }

  /** Summarize an object value */
  private summarizeObject(obj: Record<string, unknown>, depth: number, maxDepth: number): string {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{} (empty object)';

    const indent = '  '.repeat(depth);
    const lines: string[] = [`Object {${keys.length} keys}:`];

    for (const key of keys) {
      const value = obj[key];
      const valueType = this.getJsonValueType(value);
      const isComplex = valueType === 'object' || valueType === 'array';
      const valueStr = isComplex
        ? this.generateJsonSummary(value, depth + 2, maxDepth)
        : `${valueType} = ${this.getValuePreview(value)}`;
      lines.push(`${indent}  "${key}": ${valueStr}`);
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
   * Process document with Gemini OCR (for scanned PDFs) with retry + circuit breaker
   */
  private async processWithGeminiOcr(filePath: string, ocrPrompt: string): Promise<ProcessingResult> {
    const model = this.getGeminiModel();
    if (!model) {
      return this.createFailedResult('Gemini not configured for OCR fallback (missing API key)', 'local', 'pdf-parse');
    }

    const timeouts = getMediaTimeouts();

    try {
      const { text, inputTokens, outputTokens } = await this.executeWithResilience(
        'gemini',
        async () => {
          const pdfData = readFileSync(filePath);

          const result = await model.generateContent([
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: pdfData.toString('base64'),
              },
            },
            { text: ocrPrompt },
          ]);

          const response = result.response;
          const usageMetadata = response.usageMetadata;

          return {
            text: response.text(),
            inputTokens: usageMetadata?.promptTokenCount ?? 0,
            outputTokens: usageMetadata?.candidatesTokenCount ?? 0,
          };
        },
        { timeoutMs: timeouts.documentTimeoutMs },
      );

      const costCents = calculateCost('gemini_vision', GEMINI_MODEL, {
        inputTokens,
        outputTokens,
      });

      return {
        success: true,
        content: text.trim(),
        contentFormat: 'markdown',
        processingType: 'extraction',
        provider: 'google',
        model: GEMINI_MODEL,
        processingTimeMs: 0,
        inputTokens,
        outputTokens,
        costCents,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error('Gemini OCR failed', { error: errorMsg });
      return this.createFailedResult(errorMsg, 'google', GEMINI_MODEL);
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
