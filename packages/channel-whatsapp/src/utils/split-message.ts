/**
 * Split WhatsApp messages safely while preserving syntax boundaries.
 */

const DEFAULT_MAX_LENGTH = 65_536;

function splitByDelimiter(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const index = text.indexOf(delimiter, cursor);
    if (index === -1) {
      parts.push(text.slice(cursor));
      break;
    }

    parts.push(text.slice(cursor, index + delimiter.length));
    cursor = index + delimiter.length;
  }

  return parts;
}

function hardSplit(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push(text.slice(i, i + maxLength));
  }
  return chunks;
}

function packByLines(oversizedUnit: string, maxLength: number): string[] {
  const lineUnits = splitByDelimiter(oversizedUnit, '\n');
  const packed: string[] = [];
  let lineChunk = '';

  for (const lineUnit of lineUnits) {
    if (lineUnit.length > maxLength) {
      if (lineChunk) packed.push(lineChunk);
      lineChunk = '';
      packed.push(...hardSplit(lineUnit, maxLength));
      continue;
    }

    if (lineChunk.length + lineUnit.length <= maxLength) {
      lineChunk += lineUnit;
    } else {
      if (lineChunk) packed.push(lineChunk);
      lineChunk = lineUnit;
    }
  }

  if (lineChunk) packed.push(lineChunk);
  return packed;
}

function packUnits(units: string[], maxLength: number): string[] {
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current) {
      chunks.push(current);
      current = '';
    }
  };

  for (const unit of units) {
    if (unit.length > maxLength) {
      flush();
      chunks.push(...packByLines(unit, maxLength));
      continue;
    }

    if (current.length + unit.length <= maxLength) {
      current += unit;
    } else {
      flush();
      current = unit;
    }
  }

  flush();
  return chunks;
}

function splitHugeCodeBlock(block: string, maxLength: number): string[] {
  if (!block.startsWith('```') || !block.endsWith('```')) {
    return hardSplit(block, maxLength);
  }

  const firstNewline = block.indexOf('\n');
  const lastFence = block.lastIndexOf('```');

  if (firstNewline === -1 || lastFence <= firstNewline) {
    return hardSplit(block, maxLength);
  }

  const code = block.slice(firstNewline + 1, lastFence);
  const wrapperOverhead = '```\n\n```'.length;
  const innerLimit = maxLength - wrapperOverhead;

  if (innerLimit <= 0) {
    return hardSplit(block, maxLength);
  }

  return hardSplit(code, innerLimit).map((part) => `\`\`\`\n${part}\n\`\`\``);
}

function parseSegments(text: string): Array<{ type: 'text' | 'code'; value: string }> {
  const segments: Array<{ type: 'text' | 'code'; value: string }> = [];
  const codeBlockRegex = /```[\s\S]*?```/g;

  let last = 0;
  let match = codeBlockRegex.exec(text);

  while (match) {
    const start = match.index;
    const end = start + match[0].length;

    if (start > last) {
      segments.push({ type: 'text', value: text.slice(last, start) });
    }

    segments.push({ type: 'code', value: match[0] });
    last = end;
    match = codeBlockRegex.exec(text);
  }

  if (last < text.length) {
    segments.push({ type: 'text', value: text.slice(last) });
  }

  if (segments.length === 0) {
    segments.push({ type: 'text', value: text });
  }

  return segments;
}

/**
 * Split a WhatsApp message into chunks that respect length limits and code fences.
 */
export function splitWhatsAppMessage(text: string, maxLength = DEFAULT_MAX_LENGTH): string[] {
  if (maxLength <= 0) {
    throw new Error('maxLength must be greater than 0');
  }

  if (text.length <= maxLength) {
    return [text];
  }

  const segments = parseSegments(text);
  const chunks: string[] = [];
  let current = '';

  const flushCurrent = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = '';
    }
  };

  const appendPiece = (piece: string) => {
    if (piece.length === 0) {
      return;
    }

    if (piece.length > maxLength) {
      flushCurrent();
      chunks.push(...hardSplit(piece, maxLength));
      return;
    }

    if (current.length + piece.length <= maxLength) {
      current += piece;
      return;
    }

    flushCurrent();
    current = piece;
  };

  for (const segment of segments) {
    if (segment.type === 'text') {
      const paragraphUnits = splitByDelimiter(segment.value, '\n\n');
      const textPieces = packUnits(paragraphUnits, maxLength);
      for (const piece of textPieces) {
        appendPiece(piece);
      }
      continue;
    }

    if (segment.value.length <= maxLength) {
      appendPiece(segment.value);
      continue;
    }

    flushCurrent();
    const splitCode = splitHugeCodeBlock(segment.value, maxLength);
    for (const piece of splitCode) {
      appendPiece(piece);
    }
  }

  flushCurrent();

  return chunks.length > 0 ? chunks : [text];
}
