// File processing utilities for knowledge base
import { createWorker } from 'tesseract.js';

export interface ProcessedDocument {
  filename: string;
  fileType: string;
  fileSize: number;
  extractedText: string;
  metadata: Record<string, any>;
}

export async function processFile(file: File): Promise<ProcessedDocument> {
  const fileType = file.type || getFileTypeFromName(file.name);
  
  let extractedText = '';
  const metadata: Record<string, any> = {
    originalName: file.name,
    mimeType: file.type,
  };

  try {
    if (fileType.includes('pdf')) {
      extractedText = await extractTextFromPDF(file);
    } else if (fileType.includes('image')) {
      extractedText = await extractTextFromImage(file);
    } else if (fileType.includes('text') || fileType.includes('markdown')) {
      extractedText = await file.text();
    } else if (fileType.includes('csv')) {
      extractedText = await extractTextFromCSV(file);
    } else if (fileType.includes('spreadsheet') || fileType.includes('excel')) {
      extractedText = await extractTextFromExcel(file);
    } else {
      // Fallback: try to read as text
      try {
        extractedText = await file.text();
      } catch {
        extractedText = `Unable to extract text from ${file.name}`;
      }
    }
  } catch (error: any) {
    console.error(`Error processing ${file.name}:`, error);
    extractedText = `Error processing file: ${error.message}`;
  }

  return {
    filename: file.name,
    fileType,
    fileSize: file.size,
    extractedText,
    metadata,
  };
}

function getFileTypeFromName(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const typeMap: Record<string, string> = {
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'csv': 'text/csv',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xls': 'application/vnd.ms-excel',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
  };
  return typeMap[ext || ''] || 'application/octet-stream';
}

async function extractTextFromPDF(file: File): Promise<string> {
  // Use pdf.js via CDN in browser or pdf-parse in Node
  const arrayBuffer = await file.arrayBuffer();
  
  // Dynamic import of pdfjs-dist (client-side)
  if (typeof window !== 'undefined') {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
    
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n';
    }
    
    return fullText.trim();
  }
  
  return 'PDF processing not available in this environment';
}

async function extractTextFromImage(file: File): Promise<string> {
  // Use Tesseract.js for OCR
  const worker = await createWorker('eng');
  const { data: { text } } = await worker.recognize(file);
  await worker.terminate();
  return text;
}

async function extractTextFromCSV(file: File): Promise<string> {
  const text = await file.text();
  // Parse CSV and convert to readable text
  const lines = text.split('\n');
  const headers = lines[0]?.split(',').map(h => h.trim()) || [];
  
  let readable = `CSV with ${lines.length - 1} rows and ${headers.length} columns.\n\n`;
  readable += `Columns: ${headers.join(', ')}\n\n`;
  readable += `Sample data:\n${lines.slice(1, 6).join('\n')}`;
  
  return text + '\n\n' + readable;
}

async function extractTextFromExcel(file: File): Promise<string> {
  // Use xlsx library
  const arrayBuffer = await file.arrayBuffer();
  
  // Dynamic import for xlsx
  if (typeof window !== 'undefined') {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    let fullText = '';
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      const csvData = XLSX.utils.sheet_to_csv(worksheet);
      fullText += `\n\n=== Sheet: ${sheetName} ===\n${csvData}`;
    });
    
    return fullText.trim();
  }
  
  return 'Excel processing not available in this environment';
}

export function truncateText(text: string, maxLength: number = 5000): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '... [truncated]';
}

export function highlightSearchTerms(text: string, searchTerms: string[]): string {
  let highlighted = text;
  searchTerms.forEach(term => {
    const regex = new RegExp(`(${term})`, 'gi');
    highlighted = highlighted.replace(regex, '**$1**');
  });
  return highlighted;
}
