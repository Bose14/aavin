import PDFDocument from 'pdfkit';
import type { ReconTanker } from './reconReport';

export interface ReconPdfInput {
  title: string;
  address: string | null;
  from: string; // dd/mm/yyyy
  to: string;
  tankers: ReconTanker[];
}

/**
 * Plain Courier grid report, laid out to match the union's own "Quantity And Quality
 * Reconciliation Report": 1080 x 595 pt landscape, 21 pt rows, black 1 pt grid lines.
 */
const PAGE_W = 1080;
const PAGE_H = 595;
const ROW = 21;
const BOTTOM = 572;

// Column edges taken from the union's report
const X = [7.2, 60.5, 284.3, 342.9, 406.8, 444.1, 481.4, 545.3, 582.6, 619.9, 657.2, 721.2, 934.3, 998.2, 1035.5, 1072.8];
type Align = 'center' | 'right';
// index into X for [left, right], alignment
const C = {
  cell: [0, 1, 'center'],
  name: [1, 2, 'center'],
  dc: [2, 3, 'center'],
  sl: [3, 4, 'right'],
  sf: [4, 5, 'right'],
  ss: [5, 6, 'right'],
  ul: [6, 7, 'right'],
  uf: [7, 8, 'right'],
  us: [8, 9, 'right'],
  ut: [9, 10, 'right'],
  um: [10, 11, 'right'],
  loc: [11, 12, 'center'],
  bl: [12, 13, 'right'],
  bf: [13, 14, 'right'],
  bs: [14, 15, 'right'],
} as const;
type Key = keyof typeof C;
const UNION_FROM = 6; // X index where the merged Ack at Union block starts
const UNION_TO = 11;

const f2 = (v: number) => v.toFixed(2);
const f1 = (v: number) => v.toFixed(1);

export function buildReconPdf(input: ReconPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const line = (x1: number, y1: number, x2: number, y2: number) => doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
    const hseg = (i: number, j: number, y: number) => line(X[i], y, X[j], y);

    const put = (s: string, k: Key, y: number, bold = false, size = 11) => {
      const [a, b, align] = C[k] as readonly [number, number, Align];
      const w = X[b] - X[a];
      doc.font(bold ? 'Courier-Bold' : 'Courier').fontSize(size);
      doc.text(s, X[a], y, { width: align === 'right' ? w - 0.5 : w, align, lineBreak: false });
    };
    const center = (s: string, cx: number, y: number, size: number) => {
      doc.font('Courier-Bold').fontSize(size).text(s, cx - 400, y, { width: 800, align: 'center', lineBreak: false });
    };

    let y = 0;
    const pageHeader = () => {
      doc.addPage();
      doc.lineWidth(1).strokeColor('#000').fillColor('#000');
      center(input.title, PAGE_W / 2, 9.7, 14);
      const ty = 27.2;
      if (input.address) {
        center(input.address, PAGE_W / 2, ty, 10);
      }
      center('Quantity And Quality Reconciliation Report', PAGE_W / 2, 38.5, 14);
      center(`From Date : ${input.from} To Date : ${input.to}`, PAGE_W / 2, 54.9, 12);

      // group heading row
      const g0 = 81.2;
      const g1 = 100.4;
      const g2 = 130.2;
      hseg(0, 15, g0);
      line(X[0], g0, X[0], g2);
      line(X[15], g0, X[15], g2);
      line(X[6], g0, X[6], g1);
      line(X[11], g0, X[11], g1);
      center('Send Details', (X[2] + X[6]) / 2, g0 + 3, 12);
      center('Ack at Union', (X[6] + X[11]) / 2, g0 + 3, 12);
      center('Ack to BMC', (X[11] + X[15]) / 2, g0 + 3, 12);
      // column heading row
      hseg(0, 15, g1);
      hseg(0, 15, g2);
      X.forEach((x) => line(x, g1, x, g2));
      doc.font('Courier-Bold').fontSize(12);
      const head = (s: string, k: Key, yy = g1 + 3) => {
        const [l, r] = C[k] as readonly [number, number, Align];
        doc.font('Courier-Bold').fontSize(12).text(s, X[l], yy, { width: X[r] - X[l], align: 'center', lineBreak: false });
      };
      head('Cell', 'cell');
      head('Type', 'cell', g1 + 17.4);
      head('DC Num', 'dc');
      head('Ltrs', 'sl');
      head('FAT', 'sf');
      head('SNF', 'ss');
      head('Ltrs', 'ul');
      head('FAT', 'uf');
      head('SNF', 'us');
      head('Temp', 'ut');
      head('MBRT', 'um');
      head('Locations', 'loc');
      head('Ltrs', 'bl');
      head('FAT', 'bf');
      head('SNF', 'bs');
      // The sample centres "Ltrs/FAT/SNF/Temp/MBRT" headings in their cells
      y = g2;
    };

    pageHeader();
    if (input.tankers.length === 0) {
      doc.font('Courier-Bold').fontSize(12).text('No tanker records in this date range.', 0, y + 30, { width: PAGE_W, align: 'center' });
    }

    for (const t of input.tankers) {
      // keep a tanker heading together with at least its first two rows
      if (y + ROW * 3 > BOTTOM) pageHeader();

      // Tanker heading row: only outer left/right edges plus a line below
      line(X[0], y, X[0], y + ROW);
      line(X[15], y, X[15], y + ROW);
      hseg(0, 15, y + ROW);
      put(`vehicle No:${t.vehicle_number}`.replace('vehicle', 'Vehicle'), 'name', y + 3, true, 12);
      doc.font('Courier-Bold').fontSize(10).text(`DC Num :${t.dc_number}`, 462.7 - 100, y + 2.6, { width: 200, align: 'center', lineBreak: false });
      y += ROW;

      const n = t.lines.length;
      // last row index of each cell (the merged Ack at Union block closes there)
      const lastOfCell = new Map<string, number>();
      t.lines.forEach((l, i) => lastOfCell.set(l.cell, i));

      for (let i = 0; i < n; i++) {
        if (y + ROW > BOTTOM) {
          pageHeader();
        }
        const l = t.lines[i];
        const closesCell = lastOfCell.get(l.cell) === i;
        // Vertical lines and the row's bottom line
        X.forEach((x) => {
          if (x === X[0] || x === X[15] || x <= X[6] || x >= X[11] || [X[7], X[8], X[9], X[10]].includes(x) || x === X[6] || x === X[11]) line(x, y, x, y + ROW);
        });
        hseg(0, UNION_FROM, y + ROW);
        hseg(UNION_TO, 15, y + ROW);
        if (closesCell) hseg(UNION_FROM, UNION_TO, y + ROW);

        const ty = y + 2.7;
        put(l.cell, 'cell', ty);
        put(l.bmc_name, 'name', ty);
        put(l.dc_number, 'dc', ty);
        put(String(l.litres), 'sl', ty);
        put(f1(l.fat), 'sf', ty);
        put(f1(l.snf), 'ss', ty);
        if (l.union) {
          const u = l.union;
          const uy = y + 2.3;
          put(String(u.litres), 'ul', uy, true);
          put(f2(u.fat), 'uf', uy, true);
          put(f2(u.snf), 'us', uy, true);
          if (u.temp != null) put(String(u.temp), 'ut', uy, true);
          if (u.mbrt) put(`${u.mbrt}Hrs`, 'um', uy, true);
        }
        put(l.bmc_name, 'loc', ty);
        if (l.to_bmc) {
          put(String(l.to_bmc.litres), 'bl', ty);
          put(f2(l.to_bmc.fat), 'bf', ty);
          put(f2(l.to_bmc.snf), 'bs', ty);
        }
        y += ROW;
      }
    }
    doc.end();
  });
}
