import PDFDocument from 'pdfkit';
import type { ReconTanker } from './reconReport';

export interface ReconPdfInput {
  title: string;
  address: string | null;
  from: string; // dd/mm/yyyy
  to: string;
  tankers: ReconTanker[];
}

// Landscape, 1080 x 595 pt like the union's own report
const PAGE_W = 1080;
const PAGE_H = 595;
const MARGIN = 14;
const ROW_H = 18;
const TOP_AFTER_HEADER = 112;

// Column widths (sum = PAGE_W - 2 * MARGIN)
const COLS = [
  { key: 'cell', w: 38, align: 'center' },
  { key: 'name', w: 208, align: 'center' },
  { key: 'dc', w: 70, align: 'center' },
  { key: 'sl', w: 56, align: 'right' },
  { key: 'sf', w: 42, align: 'right' },
  { key: 'ss', w: 42, align: 'right' },
  { key: 'ul', w: 56, align: 'right' },
  { key: 'uf', w: 44, align: 'right' },
  { key: 'us', w: 44, align: 'right' },
  { key: 'ut', w: 40, align: 'right' },
  { key: 'um', w: 70, align: 'right' },
  { key: 'loc', w: 208, align: 'center' },
  { key: 'bl', w: 56, align: 'right' },
  { key: 'bf', w: 42, align: 'right' },
  { key: 'bs', w: 42, align: 'right' },
] as const;

const f2 = (v: number) => v.toFixed(2);
const f1 = (v: number) => v.toFixed(1);

export function buildReconPdf(input: ReconPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const xs: number[] = [];
    let x = MARGIN;
    for (const c of COLS) {
      xs.push(x);
      x += c.w;
    }
    const right = x;

    const text = (s: string, cx: number, y: number, w: number, align: 'left' | 'center' | 'right', font = 'Helvetica', size = 8) => {
      doc.font(font).fontSize(size).fillColor('#000').text(s, cx + 3, y, { width: w - 6, align, lineBreak: false, ellipsis: true });
    };

    let y = 0;
    const header = () => {
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#000').text(input.title, 0, 14, { width: PAGE_W, align: 'center' });
      let ty = 32;
      if (input.address) {
        doc.font('Helvetica').fontSize(8).text(input.address, 0, ty, { width: PAGE_W, align: 'center' });
        ty += 12;
      }
      doc.font('Helvetica-Bold').fontSize(11).text('Quantity And Quality Reconciliation Report', 0, ty + 2, { width: PAGE_W, align: 'center' });
      doc.font('Helvetica').fontSize(9.5).text(`From Date : ${input.from}   To Date : ${input.to}`, 0, ty + 18, { width: PAGE_W, align: 'center' });

      // group header
      const gy = TOP_AFTER_HEADER - 38;
      doc.lineWidth(0.6).strokeColor('#000');
      doc.rect(MARGIN, gy, right - MARGIN, 38).stroke();
      const g1 = xs[3];
      const g2 = xs[6];
      const g3 = xs[11];
      doc.moveTo(g1, gy).lineTo(g1, gy + 38).stroke();
      doc.moveTo(g2, gy).lineTo(g2, gy + 38).stroke();
      doc.moveTo(g3, gy).lineTo(g3, gy + 38).stroke();
      doc.moveTo(MARGIN, gy + 17).lineTo(right, gy + 17).stroke();
      text('Send Details', g1, gy + 4, g2 - g1, 'center', 'Helvetica-Bold', 9);
      text('Ack at Union', g2, gy + 4, g3 - g2, 'center', 'Helvetica-Bold', 9);
      text('Ack to BMC', g3, gy + 4, right - g3, 'center', 'Helvetica-Bold', 9);
      const labels = ['Cell Type', '', 'DC Num', 'Ltrs', 'FAT', 'SNF', 'Ltrs', 'FAT', 'SNF', 'Temp', 'MBRT', 'Locations', 'Ltrs', 'FAT', 'SNF'];
      labels.forEach((l, i) => text(l, xs[i], gy + 23, COLS[i].w, 'center', 'Helvetica-Bold', 8));
      y = TOP_AFTER_HEADER;
    };

    const rowBox = (h: number) => {
      doc.lineWidth(0.4).strokeColor('#555');
      COLS.forEach((c, i) => {
        if (['cell', 'name', 'dc', 'sl', 'sf', 'ss', 'ul', 'uf', 'us', 'ut', 'um', 'loc', 'bl', 'bf', 'bs'].includes(c.key)) doc.rect(xs[i] + 1.5, y + 1, c.w - 3, h - 2).stroke();
      });
      doc.lineWidth(0.6).strokeColor('#000');
      doc.moveTo(MARGIN, y).lineTo(MARGIN, y + h).stroke();
      doc.moveTo(right, y).lineTo(right, y + h).stroke();
    };

    header();
    if (input.tankers.length === 0) {
      doc.font('Helvetica').fontSize(11).text('No tanker records in this date range.', 0, y + 20, { width: PAGE_W, align: 'center' });
    }

    for (const t of input.tankers) {
      // keep the tanker heading with at least its first row
      if (y + ROW_H * 3 > PAGE_H - 16) header();
      doc.lineWidth(0.6).strokeColor('#000');
      doc.moveTo(MARGIN, y).lineTo(MARGIN, y + ROW_H).stroke();
      doc.moveTo(right, y).lineTo(right, y + ROW_H).stroke();
      text(`Vehicle No: ${t.vehicle_number}`, xs[0] + 40, y + 5, 300, 'left', 'Helvetica-Bold', 9);
      text(`DC Num : ${t.dc_number}`, xs[3] - 40, y + 6, 200, 'left', 'Helvetica', 7.5);
      y += ROW_H;

      for (const l of t.lines) {
        if (y + ROW_H > PAGE_H - 16) {
          doc.moveTo(MARGIN, y).lineTo(right, y).stroke();
          header();
        }
        rowBox(ROW_H);
        const ty = y + 5;
        const c = (i: number, s: string) => text(s, xs[i], ty, COLS[i].w, COLS[i].align, 'Helvetica', 8);
        c(0, l.cell);
        c(1, l.bmc_name);
        c(2, l.dc_number);
        c(3, String(l.litres));
        c(4, f1(l.fat));
        c(5, f1(l.snf));
        if (l.union) {
          const u = l.union;
          const b = (i: number, s: string) => text(s, xs[i], ty, COLS[i].w, COLS[i].align, 'Helvetica-Bold', 8);
          b(6, String(u.litres));
          b(7, f2(u.fat));
          b(8, f2(u.snf));
          c(9, u.temp != null ? String(u.temp) : '');
          c(10, u.mbrt ? `${u.mbrt}Hrs` : '');
        }
        c(11, l.bmc_name);
        if (l.to_bmc) {
          c(12, String(l.to_bmc.litres));
          c(13, f2(l.to_bmc.fat));
          c(14, f2(l.to_bmc.snf));
        }
        y += ROW_H;
      }
      doc.lineWidth(0.6).strokeColor('#000').moveTo(MARGIN, y).lineTo(right, y).stroke();
    }
    doc.end();
  });
}
