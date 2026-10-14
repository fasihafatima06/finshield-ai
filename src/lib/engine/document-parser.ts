import { PDFParse } from 'pdf-parse';
import { MAX_FILE_SIZE } from '@/lib/types';

const MAX_EXTRACTED_CHARACTERS = 100_000;
const MAX_PDF_PAGES = 50;

export interface ParsedDocument {
  text: string;
  csv: string;
  method: 'pdf-text' | 'csv' | 'plain-text';
}

export async function parseUploadedDocument(file: File): Promise<ParsedDocument> {
  if (file.size < 1 || file.size > MAX_FILE_SIZE) {
    throw new Error('Files must be between 1 byte and 10 MB.');
  }

  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (extension === '.pdf') {
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
      throw new Error('The uploaded file is not a valid PDF.');
    }

    const parser = new PDFParse({ data: bytes });
    try {
      const info = await parser.getInfo();
      if (info.total > MAX_PDF_PAGES) {
        throw new Error(`PDFs are limited to ${MAX_PDF_PAGES} pages.`);
      }
      const result = await parser.getText();
      const text = limitText(result.text);
      if (!text.trim()) {
        throw new Error('This PDF has no selectable text. Scanned-image OCR is not available yet.');
      }
      return { text, csv: linesToCsv(text), method: 'pdf-text' };
    } finally {
      await parser.destroy();
    }
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Only UTF-8 CSV and text files are supported.');
  }
  text = limitText(text);
  if (!text.trim()) throw new Error('The uploaded file is empty.');

  if (extension === '.csv') {
    const csv = normalizeCsv(text);
    return { text, csv, method: 'csv' };
  }
  if (extension === '.txt') {
    return { text, csv: linesToCsv(text), method: 'plain-text' };
  }

  throw new Error('Supported uploads are text-based PDF, CSV, and TXT files. Scanned images and XLSX are not supported yet.');
}

function limitText(text: string): string {
  if (text.length > MAX_EXTRACTED_CHARACTERS) {
    throw new Error('Extracted document text exceeds the 100,000 character processing limit.');
  }
  return text;
}

function linesToCsv(text: string): string {
  const rows = [['line', 'text'], ...text.split(/\r?\n/).map((line, index) => [String(index + 1), line])];
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function normalizeCsv(text: string): string {
  return parseCsvRows(text).map((values) => values.map(csvCell).join(',')).join('\r\n');
}

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error('The CSV file contains an unterminated quoted field.');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function csvCell(value: string): string {
  const safeValue = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}
