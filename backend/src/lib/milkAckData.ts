import ExcelJS from 'exceljs';
import { supabase } from '../supabase';
import { chunk, fetchAllPages } from './paging';
import { ensureAcknowledgements } from './ack';
import { buildAckDays } from './milkAck';
import { loadNormsFor } from './normStore';
import type { AckDay, AckInput, AckRow } from './milkAck';

const one = <T>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);
const num = (v: unknown) => (v == null ? 0 : Number(v));

/** Loads the statement rows for a date range: live loadings + acknowledgements, imported history for the other dates. */
export async function loadAckDays(dairyUnitId: string, from: string, to: string): Promise<AckDay[]> {
  // Received tankers get their acknowledgement filled in on first use, the same as the older export did.
  await ensureAcknowledgements(dairyUnitId, from, to);
  const [history, loadings] = await Promise.all([
    fetchAllPages<any>((a, b) =>
      supabase
        .from('milk_ack_history')
        .select('ack_date, seq, shift, kind, route, milk_type, team, bmc_code, bmc_name, dest, tanker, inv_no, qty_litres, fat_pct, snf_pct, ack_litres, ack_fat_pct, ack_snf_pct')
        .eq('dairy_unit_id', dairyUnitId)
        .gte('ack_date', from)
        .lte('ack_date', to)
        .order('ack_date')
        .order('seq')
        .range(a, b) as never,
    ),
    fetchAllPages<any>((a, b) =>
      supabase
        .from('trip_loadings')
        .select('id, trip_id, bmc_id, dc_number, shift, milk_type, quantity_litres, fat_pct, snf_pct, bmcs(name, team_name, kind, cc_code, route_name), tanker_trips!inner(trip_date, dairy_unit_id, status, dairy_destinations(code), tankers(vehicle_number, route_name, dairy_destinations(code)))')
        .eq('tanker_trips.dairy_unit_id', dairyUnitId)
        .neq('tanker_trips.status', 'cancelled')
        .gte('tanker_trips.trip_date', from)
        .lte('tanker_trips.trip_date', to)
        .order('id')
        .range(a, b) as never,
    ),
  ]);
  for (const r of [history, loadings]) if (r.error) throw new Error(r.error.message);

  const live = loadings.data ?? [];
  const tripIds = [...new Set(live.map((l) => String(l.trip_id)))];
  const ackMap = new Map<string, { qty: number; fat: number; snf: number }>();
  for (const ids of chunk(tripIds)) {
    const { data, error } = await supabase
      .from('trip_acknowledgements')
      .select('trip_id, bmc_id, dc_number, ack_litres, ack_fat_pct, ack_snf_pct')
      .in('trip_id', ids);
    if (error) throw new Error(error.message);
    for (const a of data ?? []) {
      ackMap.set(`${a.trip_id}|${a.bmc_id}|${a.dc_number}`, { qty: num(a.ack_litres), fat: num(a.ack_fat_pct), snf: num(a.ack_snf_pct) });
    }
  }

  const liveRows: AckInput[] = live.map((l) => {
    const bmc = one<any>(l.bmcs);
    const trip = one<any>(l.tanker_trips);
    const tanker = one<any>(trip?.tankers);
    const isCc = bmc?.kind === 'CC';
    return {
      date: String(trip?.trip_date),
      shift: l.shift ?? 'EVE/MOR',
      kind: String(bmc?.kind ?? 'BMC'),
      route: isCc ? '' : String(tanker?.route_name ?? bmc?.route_name ?? ''),
      milk_type: String(l.milk_type ?? 'RCM'),
      team: String(bmc?.team_name ?? ''),
      code: bmc?.cc_code != null ? Number(bmc.cc_code) : null,
      name: String(bmc?.name ?? '').toUpperCase(),
      // the destination chosen for the trip; older trips fall back to the tanker's
      dest: String(one<any>(trip?.dairy_destinations)?.code ?? one<any>(tanker?.dairy_destinations)?.code ?? ''),
      tanker: String(tanker?.vehicle_number ?? ''),
      inv_no: String(l.dc_number ?? ''),
      qty: num(l.quantity_litres),
      fat: num(l.fat_pct),
      snf: num(l.snf_pct),
      ack: ackMap.get(`${l.trip_id}|${l.bmc_id}|${l.dc_number}`) ?? null,
    };
  });
  liveRows.sort((a, b) => a.date.localeCompare(b.date) || a.route.localeCompare(b.route) || (a.code ?? 0) - (b.code ?? 0));
  const liveDates = new Set(liveRows.map((r) => r.date));

  const historyRows: AckInput[] = (history.data ?? [])
    .filter((h) => !liveDates.has(String(h.ack_date)))
    .map((h) => ({
      date: String(h.ack_date),
      shift: String(h.shift),
      block: String(h.shift),
      kind: String(h.kind),
      route: String(h.route),
      milk_type: String(h.milk_type),
      team: String(h.team),
      code: h.bmc_code != null ? Number(h.bmc_code) : null,
      name: String(h.bmc_name),
      dest: String(h.dest),
      tanker: String(h.tanker),
      inv_no: String(h.inv_no),
      qty: num(h.qty_litres),
      fat: num(h.fat_pct),
      snf: num(h.snf_pct),
      ack: h.ack_litres != null ? { qty: num(h.ack_litres), fat: num(h.ack_fat_pct), snf: num(h.ack_snf_pct) } : null,
    }));

  return buildAckDays([...historyRows, ...liveRows], await loadNormsFor(dairyUnitId));
}

type Col = { header: string; width: number; get: (r: AckRow) => string | number | null; fmt?: string };
const n1 = '#,##0.0';
const n2 = '0.00';
const n3 = '0.000';
const n0 = '#,##0';
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const COLS: Col[] = [
  { header: 'Date', width: 11, get: (r) => ddmmyyyy(r.date) },
  { header: 'MOR/EVE', width: 9, get: (r) => r.shift },
  { header: 'BMC/CC', width: 7, get: (r) => r.kind },
  { header: 'NAME OF THE ROUTE', width: 26, get: (r) => r.route },
  { header: 'TYPE OF MILK', width: 8, get: (r) => r.milk_type },
  { header: 'NAME OF THE TEAM', width: 9, get: (r) => r.team },
  { header: 'BMC/CC-CODE', width: 8, get: (r) => r.code },
  { header: 'NAME OF THE BMC/CC', width: 26, get: (r) => r.name },
  { header: 'DEST', width: 6, get: (r) => r.dest },
  { header: 'Tanker No.', width: 13, get: (r) => r.tanker },
  { header: 'Inv/Adv.No', width: 10, get: (r) => r.inv_no },
  { header: 'Dmr/Inv.Qty (In Lts.)', width: 11, get: (r) => r.qty, fmt: n0 },
  { header: 'Inv. Fat%', width: 7, get: (r) => r.fat, fmt: n2 },
  { header: 'Inv. Snf%', width: 7, get: (r) => r.snf, fmt: n2 },
  { header: 'Dmr/Inv. LIT- FAT', width: 10, get: (r) => r.lit_fat, fmt: n2 },
  { header: 'Dmr/Inv. LIT- SNF', width: 10, get: (r) => r.lit_snf, fmt: n3 },
  { header: 'Dmr/Inv.Qty (In Kg)', width: 11, get: (r) => r.kg, fmt: n0 },
  { header: 'Sp.Gr.', width: 8, get: (r) => r.sg, fmt: '0.0000' },
  { header: 'Dmr/Inv. Kg Fat', width: 10, get: (r) => r.kg_fat, fmt: n3 },
  { header: 'Dmr/Inv. Kg Snf', width: 10, get: (r) => r.kg_snf, fmt: n3 },
  { header: 'Ack. Qty (In Lts.)', width: 11, get: (r) => r.ack_qty, fmt: n0 },
  { header: 'Ack. Fat%', width: 7, get: (r) => r.ack_fat, fmt: n2 },
  { header: 'Ack. Snf%', width: 7, get: (r) => r.ack_snf, fmt: n2 },
  { header: 'Ack. LIT- FAT', width: 10, get: (r) => r.ack_lit_fat, fmt: n3 },
  { header: 'Ack. LIT- SNF', width: 10, get: (r) => r.ack_lit_snf, fmt: n3 },
  { header: 'Ack. Qty (In Kg.)', width: 11, get: (r) => r.ack_kg, fmt: n0 },
  { header: 'Sp.Gr.', width: 8, get: (r) => r.ack_sg, fmt: '0.0000' },
  { header: 'Ack. KG FAT', width: 10, get: (r) => r.ack_kg_fat, fmt: n3 },
  { header: 'Ack. KG SNF', width: 10, get: (r) => r.ack_kg_snf, fmt: n3 },
  { header: 'QTY -DIFF (LIT)', width: 9, get: (r) => r.qty_diff, fmt: n1 },
  { header: 'DIFF-FAT KG', width: 8, get: (r) => r.diff_fat_kg, fmt: n1 },
  { header: 'DIFF-SNF KG', width: 8, get: (r) => r.diff_snf_kg, fmt: n1 },
  { header: 'FAT LIT-DIFF', width: 8, get: (r) => r.fat_lit_diff, fmt: n1 },
  { header: 'SNF LIT-DIFF', width: 8, get: (r) => r.snf_lit_diff, fmt: n1 },
  { header: '30 KG-MILK', width: 8, get: (r) => r.kg30, fmt: n1 },
  { header: '30 KG- MILK (LIT)', width: 9, get: (r) => r.kg30_lit, fmt: n1 },
  { header: '30 KG- MILK LIT FAT', width: 9, get: (r) => r.kg30_lit_fat, fmt: n1 },
  { header: '30 KG- MILK LIT SNF', width: 9, get: (r) => r.kg30_lit_snf, fmt: n1 },
  { header: '0.032% FAT', width: 8, get: (r) => r.p032_fat, fmt: n1 },
  { header: '0.032% SNF', width: 8, get: (r) => r.p032_snf, fmt: n1 },
  { header: 'Allowed Norms. Total Lit Fat', width: 10, get: (r) => r.allowed_fat, fmt: n1 },
  { header: 'Allowed Norms. Total Lit Snf', width: 10, get: (r) => r.allowed_snf, fmt: n1 },
  { header: 'Above Norms Lit Fat', width: 9, get: (r) => r.above_fat, fmt: n1 },
  { header: 'Above Norms Lit Snf', width: 9, get: (r) => r.above_snf, fmt: n1 },
  { header: 'Net Loss Fat', width: 8, get: (r) => r.loss_fat, fmt: n1 },
  { header: 'Net Loss Snf', width: 8, get: (r) => r.loss_snf, fmt: n1 },
];

const thin = { style: 'thin' as const };
const box = { top: thin, bottom: thin, left: thin, right: thin };

/** One workbook, one sheet, in the layout of the MILK ACK sheet. Pass the sheet name (e.g. "1-10"). */
export async function buildAckWorkbook(days: AckDay[], title: string, sheetName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow([title]).font = { bold: true, size: 13 };
  const head = ws.addRow(COLS.map((c) => c.header));
  head.font = { bold: true };
  head.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  head.height = 48;
  head.eachCell((c) => { c.border = box; });
  COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  for (const day of days) {
    ws.addRow([ddmmyyyy(day.date)]).font = { bold: true };
    for (const r of day.rows) {
      const row = ws.addRow(COLS.map((c) => c.get(r)));
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.border = box;
        const fmt = COLS[col - 1]?.fmt;
        if (fmt) cell.numFmt = fmt;
      });
      if (r.is_total) {
        row.font = { bold: true };
        row.eachCell({ includeEmpty: true }, (cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F4FC' } }; });
      }
    }
  }
  ws.views = [{ state: 'frozen', ySplit: 2, xSplit: 8 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
