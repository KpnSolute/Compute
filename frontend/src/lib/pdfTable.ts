// Minimal, dependency-free PDF writer for compact spreadsheet-style tables.
// Uses the standard (non-embedded) Courier / Courier-Bold base-14 fonts so
// character width is exactly 0.6em — that makes word-wrap width math exact
// instead of a proportional-font heuristic, at the cost of a monospace look.
// The whole file is built as one Latin-1 string; every character we emit is
// code point <= 255 (escText enforces it), so `charCodeAt` doubles as the
// output byte value and no binary buffer handling is needed.

const PAGE_W = 792; // US Letter, landscape, points
const PAGE_H = 612;
const MARGIN = 28;
const TITLE_BLOCK_H = 40;
const CONT_BLOCK_H = 20;
const HEADER_ROW_H = 16;
const ROW_PAD = 3;
const FONT_SIZE = 8.5;
const HEADER_FONT_SIZE = 7.5;
const LINE_H = FONT_SIZE * 1.25;
const CHAR_W_FACTOR = 0.6; // Courier em-width fraction

export interface PdfTableColumn { header: string; width: number }
export interface PdfTableSection { label?: string; rows: string[][] }
export interface PdfTableOptions {
  title: string;
  meta?: string;
  columns: PdfTableColumn[];
  sections: PdfTableSection[];
}

function escText(raw: string): string {
  const normalized = String(raw ?? '')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...');
  const backslashSafe = normalized.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let out = '';
  for (let i = 0; i < backslashSafe.length; i++) {
    const code = backslashSafe.charCodeAt(i);
    out += code > 255 ? '?' : backslashSafe[i];
  }
  return out;
}

function maxCharsFor(colWidth: number, fontSize: number): number {
  const charWidth = fontSize * CHAR_W_FACTOR;
  return Math.max(4, Math.floor((colWidth - ROW_PAD * 2) / charWidth));
}

function wrapText(text: string, maxChars: number): string[] {
  const paragraphs = String(text ?? '').split('\n');
  const lines: string[] = [];
  for (const para of paragraphs) {
    if (!para) { lines.push(''); continue; }
    const words = para.split(/\s+/).filter(Boolean);
    let current = '';
    for (const word of words) {
      const candidate = current ? current + ' ' + word : word;
      if (candidate.length <= maxChars) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      let w = word;
      while (w.length > maxChars) {
        lines.push(w.slice(0, maxChars));
        w = w.slice(maxChars);
      }
      current = w;
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : [''];
}

interface LaidOutRow { cellLines: string[][]; height: number }

function layoutRow(cells: string[], columns: PdfTableColumn[], fontSize: number): LaidOutRow {
  const cellLines = columns.map((col, i) => wrapText(cells[i] ?? '', maxCharsFor(col.width, fontSize)));
  const maxLines = Math.max(1, ...cellLines.map(l => l.length));
  return { cellLines, height: maxLines * LINE_H + ROW_PAD * 2 };
}

function hexToRgUnit(hex: string): [number, number, number] {
  const n = parseInt(hex, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const NAVY = hexToRgUnit('0f1b33');
const GRID = [0.7, 0.7, 0.7] as [number, number, number];
const ZEBRA = [0.965, 0.968, 0.976] as [number, number, number];

function rgOp(rgb: [number, number, number], stroke: boolean): string {
  return `${rgb[0].toFixed(3)} ${rgb[1].toFixed(3)} ${rgb[2].toFixed(3)} ${stroke ? 'RG' : 'rg'}`;
}

interface OutPage { section: PdfTableSection; isContinuation: boolean; rows: LaidOutRow[] }

function paginate(columns: PdfTableColumn[], sections: PdfTableSection[]): OutPage[] {
  const outPages: OutPage[] = [];
  for (const section of sections) {
    if (!section.rows.length) continue;
    let pageRows: LaidOutRow[] = [];
    let isCont = false;
    let used = 0;
    let available = PAGE_H - MARGIN * 2 - TITLE_BLOCK_H - HEADER_ROW_H;
    for (const row of section.rows) {
      const laid = layoutRow(row, columns, FONT_SIZE);
      if (used + laid.height > available && pageRows.length > 0) {
        outPages.push({ section, isContinuation: isCont, rows: pageRows });
        pageRows = [];
        used = 0;
        isCont = true;
        available = PAGE_H - MARGIN * 2 - CONT_BLOCK_H - HEADER_ROW_H;
      }
      pageRows.push(laid);
      used += laid.height;
    }
    if (pageRows.length) outPages.push({ section, isContinuation: isCont, rows: pageRows });
  }
  return outPages;
}

function renderPage(page: OutPage, pageIndex: number, pageCount: number, opts: PdfTableOptions): string {
  const columns = opts.columns;
  const tableWidth = columns.reduce((s, c) => s + c.width, 0);
  let y = PAGE_H - MARGIN;
  let ops = '';

  if (!page.isContinuation) {
    ops += `BT /F2 15 Tf ${MARGIN} ${(y - 15).toFixed(1)} Td (${escText(opts.title)}) Tj ET\n`;
    if (page.section.label) {
      ops += `BT /F2 9 Tf ${(MARGIN + tableWidth - 90).toFixed(1)} ${(y - 15).toFixed(1)} Td (${escText(page.section.label)}) Tj ET\n`;
    }
    if (opts.meta) {
      ops += `BT /F1 8 Tf ${MARGIN} ${(y - 27).toFixed(1)} Td (${escText(opts.meta)}) Tj ET\n`;
    }
    y -= TITLE_BLOCK_H;
  } else {
    ops += `BT /F2 10 Tf ${MARGIN} ${(y - 10).toFixed(1)} Td (${escText(opts.title)} - continued) Tj ET\n`;
    y -= CONT_BLOCK_H;
  }

  // Column header row
  let x = MARGIN;
  ops += rgOp(NAVY, false) + '\n' + rgOp(GRID, true) + '\n0.5 w\n';
  for (const col of columns) {
    ops += `${x.toFixed(1)} ${(y - HEADER_ROW_H).toFixed(1)} ${col.width.toFixed(1)} ${HEADER_ROW_H.toFixed(1)} re B\n`;
    x += col.width;
  }
  x = MARGIN;
  ops += '1 1 1 rg\n';
  for (const col of columns) {
    ops += `BT /F2 ${HEADER_FONT_SIZE} Tf ${(x + ROW_PAD).toFixed(1)} ${(y - HEADER_ROW_H + ROW_PAD + 2).toFixed(1)} Td (${escText(col.header)}) Tj ET\n`;
    x += col.width;
  }
  y -= HEADER_ROW_H;

  // Body rows
  page.rows.forEach((row, ri) => {
    const rowTop = y;
    const zebra = ri % 2 === 1;
    x = MARGIN;
    ops += rgOp(zebra ? ZEBRA : [1, 1, 1], false) + '\n' + rgOp(GRID, true) + '\n0.5 w\n';
    for (const col of columns) {
      ops += `${x.toFixed(1)} ${(rowTop - row.height).toFixed(1)} ${col.width.toFixed(1)} ${row.height.toFixed(1)} re B\n`;
      x += col.width;
    }
    x = MARGIN;
    ops += '0 0 0 rg\n';
    row.cellLines.forEach((lines, ci) => {
      const colWidth = columns[ci].width;
      lines.forEach((line, li) => {
        if (!line) return;
        const ty = rowTop - ROW_PAD - FONT_SIZE - li * LINE_H;
        ops += `BT /F1 ${FONT_SIZE} Tf ${(x + ROW_PAD).toFixed(1)} ${ty.toFixed(1)} Td (${escText(line)}) Tj ET\n`;
      });
      x += colWidth;
    });
    y -= row.height;
  });

  ops += `0.5 0.5 0.5 rg\nBT /F1 7 Tf ${(PAGE_W - MARGIN - 70).toFixed(1)} ${(MARGIN - 14).toFixed(1)} Td (Page ${pageIndex + 1} of ${pageCount}) Tj ET\n`;
  return ops;
}

export function buildTablePdf(opts: PdfTableOptions): Blob {
  const outPages = paginate(opts.columns, opts.sections);
  const pageCount = Math.max(1, outPages.length);
  const pageContents = outPages.map((p, i) => renderPage(p, i, pageCount, opts));

  const objects: string[] = [];
  const pageObjNums: number[] = [];
  // Object numbering: 1 catalog, 2 pages, 3 font regular, 4 font bold,
  // then pairs of (page, content-stream) starting at 5.
  let nextObjNum = 5;
  const pageObjs: string[] = [];
  pageContents.forEach((content) => {
    const pageObjNum = nextObjNum++;
    const contentObjNum = nextObjNum++;
    pageObjNums.push(pageObjNum);
    pageObjs.push(
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjNum} 0 R >>\nendobj\n`,
    );
    pageObjs.push(
      `${contentObjNum} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    );
  });

  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map(n => `${n} 0 R`).join(' ')}] /Count ${pageObjNums.length} >>\nendobj\n`);
  objects.push(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>\nendobj\n`);
  objects.push(`4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`);
  objects.push(...pageObjs);

  let file = '%PDF-1.4\n';
  const offsets: number[] = [0]; // object 0 is the free-list head, no real offset
  for (const obj of objects) {
    offsets.push(file.length);
    file += obj;
  }
  const xrefOffset = file.length;
  const totalObjs = offsets.length; // includes object 0
  let xref = `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
  for (let i = 1; i < totalObjs; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  file += xref;
  file += `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const bytes = new Uint8Array(file.length);
  for (let i = 0; i < file.length; i++) bytes[i] = file.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: 'application/pdf' });
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 120);
}
