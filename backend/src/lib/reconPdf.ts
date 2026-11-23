import PDFDocument from 'pdfkit';
import type { ReconTanker, ReconLine } from './reconReport';

export interface ReconPdfInput {
  title: string;
  address: string | null;
  from: string; // dd/mm/yyyy
  to: string;
  tankers: ReconTanker[];
}

// A4 landscape
const PAGE_W = 842;
const PAGE_H = 595;
const M = 24;
const RH = 18;
const BOTTOM = PAGE_H - 28;

const COLS = [
  { label: 'Cell', w: 44, a: 'center' },
  { label: 'BMC', w: 280, a: 'left' },
  { label: 'DC No', w: 80, a: 'center' },
  { label: 'Litres', w: 62, a: 'right' },
  { label: 'Fat %', w: 50, a: 'right' },
  { label: 'SNF %', w: 50, a: 'right' },
  { label: 'Litres', w: 62, a: 'right' },
  { label: 'Fat %', w: 50, a: 'right' },
  { label: 'SNF %', w: 50, a: 'right' },
  { label: 'Diff (L)', w: 66, a: 'right' },
] as const;

const DARK = '#3f3f46';
const GREY = '#f4f4f5';
const GREEN = '#d9f99d';
const BLUE = '#e0f2fe';
const LINE = '#d4d4d8';

export function buildReconPdf(input: ReconPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: false, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const xs: number[] = [];
    let x = M;
    for (const c of COLS) {
      xs.push(x);
      x += c.w;
    }
    const W = x - M;
    let y = 0;

    const txt = (s: string, cx: number, cy: number, w: number, align: string, font = 'Helvetica', size = 8.5, color = '#18181b') => {
      doc.font(font).fontSize(size).fillColor(color).text(s, cx + 4, cy, { width: w - 8, align: align as any, lineBreak: false, ellipsis: true });
    };
    const fill = (cy: number, h: number, color: string) => doc.rect(M, cy, W, h).fill(color);
    const hline = (cy: number, color = LINE) => doc.lineWidth(0.5).strokeColor(color).moveTo(M, cy).lineTo(M + W, cy).stroke();

    const pageHeader = () => {
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#18181b').text(input.title, 0, 18, { width: PAGE_W, align: 'center' });
      let ty = 36;
      if (input.address) {
        doc.font('Helvetica').fontSize(8.5).fillColor('#52525b').text(input.address, 0, ty, { width: PAGE_W, align: 'center' });
        ty += 12;
      }
      doc.font('Helvetica-Bold').fontSize(11.5).fillColor('#18181b').text('Quantity And Quality Reconciliation Report', 0, ty + 2, { width: PAGE_W, align: 'center' });
      doc.font('Helvetica').fontSize(9.5).fillColor('#52525b').text(`Period: ${input.from} to ${input.to}`, 0, ty + 18, { width: PAGE_W, align: 'center' });
      y = ty + 40;
      // column headings
      const g = (a: number, b: number) => xs[b] + COLS[b].w - xs[a];
      fill(y, 34, DARK);
      txt('', xs[0], y, 1, 'left');
      txt('Sent by BMC', xs[3], y + 4, g(3, 5), 'center', 'Helvetica-Bold', 9, '#fff');
      txt('Acknowledged to BMC', xs[6], y + 4, g(6, 8), 'center', 'Helvetica-Bold', 9, '#fff');
      COLS.forEach((c, i) => txt(c.label, xs[i], y + 20, c.w, c.a, 'Helvetica-Bold', 8.5, '#fff'));
      doc.lineWidth(0.5).strokeColor('#a1a1aa');
      doc.moveTo(xs[3], y + 17).lineTo(xs[9], y + 17).stroke();
      y += 34;
    };

    const need = (h: number) => {
      if (y + h > BOTTOM) pageHeader();
    };

    pageHeader();
    if (input.tankers.length === 0) {
      doc.font('Helvetica').fontSize(11).fillColor('#52525b').text('No tanker records in this date range.', 0, y + 24, { width: PAGE_W, align: 'center' });
    }

    const fmt = (v: number, d = 2) => v.toFixed(d);
    const dmy = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

    for (const t of input.tankers) {
      need(RH * 5);
      y += 8;
      // tanker band
      fill(y, RH + 2, '#52525b');
      txt(`Vehicle ${t.vehicle_number}`, xs[0], y + 5, 300, 'left', 'Helvetica-Bold', 10, '#fff');
      txt(`Date ${dmy(t.trip_date)}   |   DC ${t.dc_number}`, xs[3] - 60, y + 5, 400, 'right', 'Helvetica', 9, '#fff');
      y += RH + 2;

      // first-line index of each BMC+DC and its total sent
      const sent = new Map<string, number>();
      for (const l of t.lines) sent.set(`${l.bmc_name}|${l.dc_number}`, (sent.get(`${l.bmc_name}|${l.dc_number}`) ?? 0) + l.litres);

      let totSent = 0;
      let totAck = 0;
      let hasAck = false;
      t.lines.forEach((l: ReconLine, i: number) => {
        need(RH);
        if (i % 2 === 1) fill(y, RH, GREY);
        const ty = y + 5;
        txt(l.cell, xs[0], ty, COLS[0].w, 'center', 'Helvetica-Bold');
        txt(l.bmc_name, xs[1], ty, COLS[1].w, 'left');
        txt(l.dc_number, xs[2], ty, COLS[2].w, 'center');
        txt(String(l.litres), xs[3], ty, COLS[3].w, 'right');
        txt(fmt(l.fat), xs[4], ty, COLS[4].w, 'right');
        txt(fmt(l.snf), xs[5], ty, COLS[5].w, 'right');
        totSent += l.litres;
        if (l.to_bmc) {
          const tot = sent.get(`${l.bmc_name}|${l.dc_number}`) ?? 0;
          const diff = l.to_bmc.litres - tot;
          hasAck = true;
          totAck += l.to_bmc.litres;
          txt(String(l.to_bmc.litres), xs[6], ty, COLS[6].w, 'right');
          txt(fmt(l.to_bmc.fat), xs[7], ty, COLS[7].w, 'right');
          txt(fmt(l.to_bmc.snf), xs[8], ty, COLS[8].w, 'right');
          txt(String(diff), xs[9], ty, COLS[9].w, 'right', 'Helvetica', 8.5, diff < 0 ? '#b91c1c' : '#18181b');
        }
        hline(y + RH);
        y += RH;
      });

      // total row
      need(RH + 2);
      fill(y, RH + 2, GREEN);
      txt('TOTAL', xs[0], y + 6, COLS[0].w + COLS[1].w, 'left', 'Helvetica-Bold', 9);
      txt(String(totSent), xs[3], y + 6, COLS[3].w, 'right', 'Helvetica-Bold', 9);
      if (hasAck) {
        txt(String(totAck), xs[6], y + 6, COLS[6].w, 'right', 'Helvetica-Bold', 9);
        const d = totAck - totSent;
        txt(String(d), xs[9], y + 6, COLS[9].w, 'right', 'Helvetica-Bold', 9, d < 0 ? '#b91c1c' : '#18181b');
      }
      y += RH + 2;

      // received at union (QC) per cell
      const cells = t.lines.filter((l) => l.union);
      if (cells.length) {
        const parts = cells.map((l) => {
          const u = l.union!;
          return `${l.cell}: ${u.litres} L  Fat ${fmt(u.fat)}  SNF ${fmt(u.snf)}${u.temp != null ? `  Temp ${u.temp}°C` : ''}${u.mbrt ? `  MBRT ${u.mbrt} Hrs` : ''}`;
        });
        need(RH);
        fill(y, RH, BLUE);
        txt('Received at union (QC)', xs[0], y + 5, 150, 'left', 'Helvetica-Bold', 8);
        doc.font('Helvetica').fontSize(8).fillColor('#18181b').text(parts.join('     |     '), xs[0] + 150, y + 5, { width: W - 154, lineBreak: false, ellipsis: true });
        y += RH;
      }
    }

    // page numbers
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font('Helvetica').fontSize(8).fillColor('#71717a').text(`Page ${i + 1} of ${range.count}`, 0, PAGE_H - 18, { width: PAGE_W - M, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
