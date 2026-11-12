function escapePdfText(input: string): string {
  // Replace non-WinAnsi chars (like ₹) safely with ASCII equivalent so Type1 Helvetica never produces tofu glyphs
  const ascii = input
    .replace(/\u20B9/g, 'Rs.')
    .replace(/[^\x20-\x7E]/g, ' ');
  return ascii.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export interface PdfReportRow {
  date: string;
  unit: string;
  shift: string;
  fat: string;
  snf: string;
  qty: string;
  rej: string;
  net: string;
  rate: string;
  cost: string;
  status: string;
}

export interface PdfDailyReportInput {
  title: string;
  subtitle: string;
  summaryLines: string[];
  rows: PdfReportRow[];
}

/** Build a valid multi-page binary PDF report using Helvetica Type1 fonts. */
export function buildDailyPdfReport(input: PdfDailyReportInput): Buffer {
  const PAGE_W = 842; // A4 Landscape width in pt
  const PAGE_H = 595; // A4 Landscape height in pt
  const MARGIN_X = 36;
  const ROWS_PER_PAGE = 22;

  const colWidths = [74, 130, 44, 48, 48, 66, 62, 66, 64, 92, 76];
  const headers = ['Date', 'Unit', 'Shift', 'Fat %', 'SNF %', 'Qty (L)', 'Rej (L)', 'Net (L)', 'Rate', 'Amount (Rs)', 'Status'];

  const totalPages = Math.max(1, Math.ceil(input.rows.length / ROWS_PER_PAGE));
  const contentStreams: string[] = [];

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const cmds: string[] = [];
    const drawText = (x: number, y: number, size: number, bold: boolean, text: string) => {
      const font = bold ? '/F2' : '/F1';
      cmds.push(`BT ${font} ${size} Tf 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm (${escapePdfText(text)}) Tj ET`);
    };

    // Header bar
    cmds.push('0.31 0.27 0.90 rg');
    cmds.push(`${MARGIN_X} ${PAGE_H - 64} ${PAGE_W - MARGIN_X * 2} 34 re f`);
    cmds.push('1 1 1 rg');
    drawText(MARGIN_X + 12, PAGE_H - 44, 14, true, input.title);
    drawText(PAGE_W - 140, PAGE_H - 44, 9, false, `Page ${pageIdx + 1} of ${totalPages}`);

    cmds.push('0.2 0.2 0.25 rg');
    drawText(MARGIN_X, PAGE_H - 82, 10, false, input.subtitle);

    let y = PAGE_H - 102;
    if (pageIdx === 0 && input.summaryLines.length > 0) {
      cmds.push('0.96 0.97 0.99 rg');
      const boxH = input.summaryLines.length * 14 + 12;
      cmds.push(`${MARGIN_X} ${y - boxH + 8} ${PAGE_W - MARGIN_X * 2} ${boxH} re f`);
      cmds.push('0.12 0.14 0.2 rg');
      for (const line of input.summaryLines) {
        drawText(MARGIN_X + 10, y - 4, 9.5, true, line);
        y -= 14;
      }
      y -= 14;
    }

    // Table header
    cmds.push('0.93 0.94 0.97 rg');
    cmds.push(`${MARGIN_X} ${y - 6} ${PAGE_W - MARGIN_X * 2} 20 re f`);
    cmds.push('0.15 0.17 0.24 rg');
    let cx = MARGIN_X + 4;
    for (let c = 0; c < headers.length; c++) {
      drawText(cx, y, 8.5, true, headers[c]);
      cx += colWidths[c];
    }
    y -= 20;

    const slice = input.rows.slice(pageIdx * ROWS_PER_PAGE, (pageIdx + 1) * ROWS_PER_PAGE);
    if (slice.length === 0) {
      drawText(MARGIN_X + 8, y - 6, 10, false, 'No milk collection records matched the active filters.');
    } else {
      for (let r = 0; r < slice.length; r++) {
        const row = slice[r];
        if (r % 2 === 1) {
          cmds.push('0.98 0.98 0.99 rg');
          cmds.push(`${MARGIN_X} ${y - 5} ${PAGE_W - MARGIN_X * 2} 17 re f`);
        }
        cmds.push('0.18 0.2 0.25 rg');
        const cells = [
          row.date,
          row.unit.slice(0, 22),
          row.shift,
          row.fat,
          row.snf,
          row.qty,
          row.rej,
          row.net,
          row.rate,
          row.cost,
          row.status,
        ];
        cx = MARGIN_X + 4;
        for (let c = 0; c < cells.length; c++) {
          drawText(cx, y, 8.5, false, cells[c]);
          cx += colWidths[c];
        }
        y -= 18;
      }
    }

    contentStreams.push(cmds.join('\n'));
  }

  // Assemble PDF objects cleanly
  const objects: string[] = [];
  const addObj = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const fontRegularId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBoldId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pagesId = addObj(''); // placeholder, replaced below
  const pageIds: number[] = [];

  for (const streamText of contentStreams) {
    const len = Buffer.byteLength(streamText, 'utf8');
    const contentId = addObj(`<< /Length ${len} >>\nstream\n${streamText}\nendstream`);
    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  objects[pagesId - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
  const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

