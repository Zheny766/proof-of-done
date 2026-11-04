// A plain PDF of text lines, for PayPal: a dispute takes evidence as PDF, JPG, PNG or GIF files, not
// JSON. Built by hand (Helvetica, A4, line wrapping, as many pages as it takes) so the deal record
// needs no PDF library. Text outside Latin-1 is replaced, since the standard fonts can't draw it.

export type PdfLine = { text: string; bold?: boolean; size?: number; gap?: number };

const PAGE = { width: 595, height: 842, margin: 50 };

const latin1 = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/→/g, '->')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

/** Breaks a line to fit the page: Helvetica averages about half the font size per character. */
function wrap(text: string, size: number): string[] {
  const max = Math.floor((PAGE.width - 2 * PAGE.margin) / (size * 0.5));
  const out: string[] = [];
  for (const para of text.split('\n').map(latin1)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      for (let w = word; w; w = w.slice(max)) {
        const piece = w.slice(0, max);
        if (line && line.length + 1 + piece.length > max) {
          out.push(line);
          line = piece;
        } else line = line ? `${line} ${piece}` : piece;
      }
    }
    out.push(line);
  }
  return out;
}

/** `footer` is printed at the foot of every page, given its number and the page count. */
export function textPdf(lines: PdfLine[], footer?: (page: number, pages: number) => string): Buffer {
  // Lay the lines out into pages of content streams.
  const pages: string[][] = [[]];
  let y = PAGE.height - PAGE.margin;
  for (const l of lines) {
    const size = l.size ?? 10;
    y -= l.gap ?? 0;
    for (const part of wrap(l.text, size)) {
      if (y - size * 1.4 < PAGE.margin) {
        pages.push([]);
        y = PAGE.height - PAGE.margin;
      }
      y -= size * 1.4;
      pages.at(-1)!.push(`BT /${l.bold ? 'F2' : 'F1'} ${size} Tf ${PAGE.margin} ${y.toFixed(1)} Td (${escape(part)}) Tj ET`);
    }
  }

  if (footer) pages.forEach((ops, i) => ops.push(`BT /F1 8 Tf ${PAGE.margin} ${PAGE.margin / 2} Td (${escape(latin1(footer(i + 1, pages.length)))}) Tj ET`));

  // Objects: 1 catalog, 2 page tree, 3-4 fonts, then a page and its content stream per page.
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  pages.forEach((ops, i) => {
    const stream = ops.join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });

  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
