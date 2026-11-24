import PDFDocument from 'pdfkit';

export interface GatePassPdfInput {
  gate_pass_no: string;
  union_name?: string;
  union_sub_name?: string;
  date: string;
  time: string;
  sl_no?: string;
  item?: string;
  quantity?: string;
  purpose?: string;
  whether_returnable?: string;
  to_whom_issued: string;
  issued_by?: string;
  vehicle_no: string;
  issuing_officer?: string;
  received_by?: string;
  security_officer?: string;
}

const PAGE_W = 595;
const PAGE_H = 420;

export function buildGatePassPdf(input: GatePassPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H],
      margin: 0,
      autoFirstPage: false,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.addPage();

    // 1. Canary yellow receipt background
    doc.rect(0, 0, PAGE_W, PAGE_H).fill('#fef9c3');

    // 2. Outer border
    const margin = 16;
    const borderW = PAGE_W - 2 * margin;
    const borderH = PAGE_H - 2 * margin;
    doc.lineWidth(1.2).strokeColor('#1e293b').rect(margin, margin, borderW, borderH).stroke();

    // 3. Aavin Logo Badge (top left)
    const logoX = margin + 12;
    const logoY = margin + 10;
    doc.roundedRect(logoX, logoY, 52, 24, 6).fillAndStroke('#0072bc', '#005a96');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(13).text('aavin', logoX + 6, logoY + 5);

    // 4. Header Titles (center)
    const unionName = input.union_name || "Namakkal District Co-operative Milk Producers' Union Limited,";
    const subName = input.union_sub_name || 'NAMAKKAL MILK UNION';

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11).text(unionName, margin + 65, margin + 8, {
      width: PAGE_W - 2 * margin - 195,
      align: 'center',
    });
    doc.fontSize(10.5).text(subName, margin + 65, margin + 22, {
      width: PAGE_W - 2 * margin - 195,
      align: 'center',
    });
    doc.fontSize(13).text('GATE PASS', margin + 65, margin + 36, {
      width: PAGE_W - 2 * margin - 195,
      align: 'center',
      underline: true,
    });

    // 5. Gate Pass Serial Number (top right)
    const passNo = (input.gate_pass_no || '005616').replace(/\D/g, '').padStart(6, '0').slice(-6);
    const boxX = PAGE_W - margin - 120;
    const boxY = margin + 12;

    doc.fillColor('#991b1b').font('Helvetica-Bold').fontSize(15).text('№', boxX - 18, boxY + 2);
    // Draw 6 individual digit boxes
    const digitW = 16;
    const digitH = 20;
    for (let i = 0; i < 6; i++) {
      const dx = boxX + i * digitW;
      doc.rect(dx, boxY, digitW, digitH).lineWidth(0.8).strokeColor('#991b1b').stroke();
      doc.fillColor('#991b1b').font('Courier-Bold').fontSize(14).text(passNo[i] || '0', dx + 4, boxY + 3);
    }

    // 6. Date & Time Row
    const infoY = margin + 56;
    doc.fillColor('#0f172a').font('Helvetica').fontSize(10);
    doc.text(`Time: `, margin + 14, infoY, { continued: true });
    doc.font('Helvetica-Bold').text(input.time || '12:00 PM');

    const dateText = input.date || new Date().toISOString().slice(0, 10);
    doc.font('Helvetica').text(`Date: `, PAGE_W - margin - 130, infoY, { continued: true });
    doc.font('Helvetica-Bold').text(dateText);

    // 7. Grid Table
    const tableTop = margin + 74;
    const tableH = 140;
    const colX = [
      margin + 10,       // Start
      margin + 10 + 45,  // Sl. No (45)
      margin + 10 + 205, // Item (160)
      margin + 10 + 250, // Qty (45)
      margin + 10 + 400, // Purpose (150)
      margin + borderW - 10, // Whether returnable (146)
    ];

    // Outer table box
    doc.rect(colX[0], tableTop, colX[5] - colX[0], tableH).lineWidth(1).strokeColor('#0f172a').stroke();

    // Header line
    const headerH = 20;
    doc.moveTo(colX[0], tableTop + headerH).lineTo(colX[5], tableTop + headerH).stroke();

    // Vertical column dividers
    for (let i = 1; i < colX.length - 1; i++) {
      doc.moveTo(colX[i], tableTop).lineTo(colX[i], tableTop + tableH).stroke();
    }

    // Table Header Text
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f172a');
    doc.text('Sl. No.', colX[0], tableTop + 5, { width: colX[1] - colX[0], align: 'center' });
    doc.text('Item', colX[1], tableTop + 5, { width: colX[2] - colX[1], align: 'center' });
    doc.text('Qty.', colX[2], tableTop + 5, { width: colX[3] - colX[2], align: 'center' });
    doc.text('Purpose', colX[3], tableTop + 5, { width: colX[4] - colX[3], align: 'center' });
    doc.text('Whether returnable', colX[4], tableTop + 5, { width: colX[5] - colX[4], align: 'center' });

    // Table Row 1 (Data)
    const rowY = tableTop + headerH + 10;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1e293b');
    doc.text(input.sl_no || '1)', colX[0], rowY, { width: colX[1] - colX[0], align: 'center' });
    doc.text((input.item || 'EMPTY TANKER').toUpperCase(), colX[1] + 6, rowY, { width: colX[2] - colX[1] - 12 });
    doc.text(input.quantity || '1', colX[2], rowY, { width: colX[3] - colX[2], align: 'center' });
    doc.text((input.purpose || 'TO BMC').toUpperCase(), colX[3] + 6, rowY, { width: colX[4] - colX[3] - 12 });
    doc.text(input.whether_returnable || 'Returnable', colX[4] + 6, rowY, { width: colX[5] - colX[4] - 12 });

    // 8. Bottom Details Section
    let curY = tableTop + tableH + 10;

    // Line 1: To whom issued
    doc.font('Helvetica').fontSize(10.5).fillColor('#0f172a');
    doc.text('To whom issued : ', margin + 14, curY, { continued: true });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1e3a8a').text((input.to_whom_issued || '—').toUpperCase());

    // Line 2: Issued by Stores / CC / TPT / ADM / Lab / P&I
    curY += 18;
    const issuedByVal = (input.issued_by || 'Lab').toUpperCase();
    doc.font('Helvetica').fontSize(10).fillColor('#0f172a');
    doc.text('Issued by : ', margin + 14, curY, { continued: true });
    doc.font('Helvetica-Bold').fillColor('#1e3a8a').text(`[ ${issuedByVal} ] `, { continued: true });
    doc.font('Helvetica').fillColor('#64748b').fontSize(9).text('(Stores / CC / TPT / ADM / Lab / P&I)');

    // Line 3: Vehicle No. if any
    curY += 18;
    doc.font('Helvetica').fontSize(10.5).fillColor('#0f172a');
    doc.text('Vehicle No. if any : ', margin + 14, curY, { continued: true });
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor('#b45309').text((input.vehicle_no || '—').toUpperCase());

    // 9. Signatures Row
    const sigY = margin + borderH - 32;
    doc.font('Helvetica').fontSize(10).fillColor('#0f172a');

    // Left: Issuing Officer
    doc.text('Issuing Officer:', margin + 14, sigY);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#1e3a8a').text(input.issuing_officer || 'Officer', margin + 14, sigY + 14);

    // Center: Received (Driver)
    doc.font('Helvetica').fontSize(10).fillColor('#0f172a');
    doc.text('Received:', margin + 220, sigY);
    doc.font('Helvetica-Oblique').fontSize(9.5).fillColor('#475569').text(input.received_by || input.to_whom_issued || 'Signature', margin + 220, sigY + 14);

    // Right: Security
    doc.font('Helvetica').fontSize(10).fillColor('#0f172a');
    doc.text('Security:', PAGE_W - margin - 120, sigY);
    doc.font('Helvetica-Oblique').fontSize(9.5).fillColor('#475569').text(input.security_officer || 'Security Incharge', PAGE_W - margin - 120, sigY + 14);

    doc.end();
  });
}
