import ExcelJS from 'exceljs';
import { supabase } from '../supabase';
import { fetchAllPages } from './paging';
import { addDays, buildReceiptDays, figureKey } from './bmcReceipts';
import type { DayFigures, ReceiptBmc, ReceiptDay } from './bmcReceipts';

export const MAX_RANGE_DAYS = 62;
const MAX_CHAIN_DAYS = 800;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

async function earliestDate(table: string, column: string, dairyUnitId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from(table)
    .select(column)
    .eq('dairy_unit_id', dairyUnitId)
    .order(column, { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  const v = (data?.[0] as unknown as Record<string, unknown> | undefined)?.[column];
  return v ? String(v) : null;
}

/** Loads BMCs and figures for the dairy unit and builds the report days. */
export async function loadReceiptDays(dairyUnitId: string, from: string, to: string): Promise<ReceiptDay[]> {
  const { data: bmcRows, error: bErr } = await supabase
    .from('bmcs')
    .select('id, name, team_name, cc_code, capacity_litres, bmc_opening_balances(balance_date, quantity_litres)')
    .eq('dairy_unit_id', dairyUnitId)
    .eq('kind', 'BMC')
    .not('cc_code', 'is', null)
    .order('cc_code', { ascending: true });
  if (bErr) throw new Error(bErr.message);

  const bmcs: ReceiptBmc[] = (bmcRows ?? []).map((b: any) => {
    const ob = Array.isArray(b.bmc_opening_balances) ? b.bmc_opening_balances[0] : b.bmc_opening_balances;
    return {
      id: String(b.id),
      name: String(b.name).toUpperCase(),
      team: String(b.team_name ?? ''),
      cc_code: Number(b.cc_code),
      capacity: Number(b.capacity_litres ?? 0),
      opening: ob ? Number(ob.quantity_litres) : null,
      opening_date: ob?.balance_date ?? null,
    };
  });
  if (bmcs.length === 0) return [];

  const [firstHistory, firstMilk] = await Promise.all([
    earliestDate('bmc_receipt_history', 'receipt_date', dairyUnitId),
    earliestDate('milk_entries', 'date', dairyUnitId),
  ]);
  let chainFrom = [firstHistory, firstMilk].filter((d): d is string => !!d).sort()[0] ?? from;
  const earliestAllowed = addDays(from, -MAX_CHAIN_DAYS);
  if (chainFrom < earliestAllowed) chainFrom = earliestAllowed;
  if (chainFrom > from) chainFrom = from;

  const [history, milk, loadings] = await Promise.all([
    fetchAllPages<any>((a, b) =>
      supabase
        .from('bmc_receipt_history')
        .select('bmc_id, receipt_date, am_litres, pm_litres, loaded_litres, opening_litres')
        .eq('dairy_unit_id', dairyUnitId)
        .gte('receipt_date', chainFrom)
        .lte('receipt_date', to)
        .order('id')
        .range(a, b) as never,
    ),
    fetchAllPages<any>((a, b) =>
      supabase
        .from('milk_entries')
        .select('bmc_id, date, shift, quantity_litres')
        .eq('dairy_unit_id', dairyUnitId)
        .gte('date', chainFrom)
        .lte('date', to)
        .order('id')
        .range(a, b) as never,
    ),
    fetchAllPages<any>((a, b) =>
      supabase
        .from('trip_loadings')
        .select('id, bmc_id, quantity_litres, tanker_trips!inner(trip_date, dairy_unit_id, status)')
        .eq('tanker_trips.dairy_unit_id', dairyUnitId)
        .neq('tanker_trips.status', 'cancelled')
        .gte('tanker_trips.trip_date', chainFrom)
        .lte('tanker_trips.trip_date', to)
        .order('id')
        .range(a, b) as never,
    ),
  ]);
  for (const r of [history, milk, loadings]) if (r.error) throw new Error(r.error.message);

  const figures = new Map<string, DayFigures>();
  const get = (id: string, date: string) => {
    const k = figureKey(id, date);
    let f = figures.get(k);
    if (!f) figures.set(k, (f = { am: 0, pm: 0, loaded: 0 }));
    return f;
  };

  // History first, then live data replaces a BMC-day wherever the app has real records.
  for (const h of history.data ?? []) {
    figures.set(figureKey(String(h.bmc_id), String(h.receipt_date)), {
      am: Number(h.am_litres),
      pm: Number(h.pm_litres),
      loaded: Number(h.loaded_litres),
      opening: h.opening_litres != null ? Number(h.opening_litres) : null,
    });
  }
  const liveKeys = new Set<string>();
  for (const m of milk.data ?? []) liveKeys.add(figureKey(String(m.bmc_id), String(m.date)));
  for (const l of loadings.data ?? []) {
    const trip = Array.isArray(l.tanker_trips) ? l.tanker_trips[0] : l.tanker_trips;
    liveKeys.add(figureKey(String(l.bmc_id), String(trip?.trip_date)));
  }
  for (const k of liveKeys) {
    const prev = figures.get(k);
    figures.set(k, { am: 0, pm: 0, loaded: 0, opening: prev?.opening ?? null });
  }
  for (const m of milk.data ?? []) {
    const f = get(String(m.bmc_id), String(m.date));
    if (m.shift === 'AM') f.am += Number(m.quantity_litres);
    else if (m.shift === 'PM') f.pm += Number(m.quantity_litres);
  }
  for (const l of loadings.data ?? []) {
    const trip = Array.isArray(l.tanker_trips) ? l.tanker_trips[0] : l.tanker_trips;
    get(String(l.bmc_id), String(trip?.trip_date)).loaded += Number(l.quantity_litres);
  }

  return buildReceiptDays(bmcs, figures, chainFrom, from, to);
}

export function validateRange(from?: string, to?: string): string | null {
  const ok = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!ok(from) || !ok(to)) return 'Select a From and To date';
  if (from! > to!) return 'From date must be on or before To date';
  if (daysBetween(from!, to!) + 1 > MAX_RANGE_DAYS) return `Choose at most ${MAX_RANGE_DAYS} days at a time`;
  return null;
}

const HEADERS = [
  'S.NO', 'Date', 'NAME OF THE TEAM', 'CC-CODE', 'BMCs', 'CAPACITY (LTS)', 'O/B', 'RECEIPTS AM', 'RECEIPTS PM',
  'TOTAL', 'DISPOSAL (To be send)', 'C/B (BOOK STOCK)', 'DISPOSAL (Loaded Qty)', 'ACT-CB', 'DIFF QTY',
  'Capacity Utilization -%', '',
];

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Excel file in the same layout as the October sheet. */
export async function buildReceiptsWorkbook(days: ReceiptDay[], title: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BMC Receipts');
  ws.addRow([title]).font = { bold: true, size: 13 };
  const head = ws.addRow(HEADERS);
  head.font = { bold: true };
  head.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  head.eachCell((c) => { c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; });

  const widths = [6, 12, 10, 9, 34, 11, 9, 9, 9, 9, 12, 12, 12, 9, 9, 12, 5];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  for (const day of days) {
    for (const r of [...day.rows, day.total]) {
      const row = ws.addRow([
        r.sno ?? '', ddmmyyyy(r.date), r.team, r.cc_code ?? '', r.name, r.capacity, r.ob, r.am, r.pm, r.total,
        r.to_send, r.cb, r.loaded, r.act_cb, r.diff, r.util, r.flag,
      ]);
      row.eachCell((c) => { c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; });
      if (r.name === 'TOTAL') row.font = { bold: true };
      if (r.flag === 'CB') row.getCell(17).font = { bold: true, color: { argb: 'FFC00000' } };
    }
  }
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
