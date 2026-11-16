// Port of internal/extract: text from PDF, DOCX, EPUB, TXT/MD, and images (via Gemini vision).
import { geminiExtractImageText } from './llm.js';

const ext = (name = '') => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

let pdfjsPromise;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

async function extractPdf(buffer) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Rebuild lines from text items so section headings stay on their own line.
    let line = '';
    let lastY = null;
    const lines = [];
    for (const item of content.items) {
      const y = item.transform ? Math.round(item.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
        lines.push(line);
        line = '';
      }
      line += (line && !line.endsWith(' ') ? ' ' : '') + item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = '';
      }
      lastY = y;
    }
    if (line) lines.push(line);
    pages.push(lines.map((l) => l.trim()).filter(Boolean).join('\n'));
  }
  return pages.join('\n');
}

async function extractDocx(buffer) {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value || '';
}

async function extractEpub(buffer) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const parts = [];
  const names = Object.keys(zip.files).filter((n) => /\.(xhtml|html|htm)$/i.test(n)).sort();
  for (const name of names) {
    const html = await zip.files[name].async('string');
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

const toBase64 = (buffer) => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** Extract plain text from a File/Blob, choosing the method by file extension. */
export async function textFromFile(file) {
  const kind = ext(file.name);
  const buffer = await file.arrayBuffer();
  switch (kind) {
    case 'pdf': return extractPdf(buffer);
    case 'docx': return extractDocx(buffer);
    case 'epub': return extractEpub(buffer);
    case 'txt':
    case 'md': return new TextDecoder().decode(buffer);
    case 'jpg': case 'jpeg': case 'png': case 'webp': case 'gif': case 'bmp': {
      const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' }[kind];
      return geminiExtractImageText(toBase64(buffer), mime);
    }
    default:
      throw new Error(`Extension '${kind}' is not supported for analysis`);
  }
}
