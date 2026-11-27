/**
 * BMC Receipts report: per BMC per day, what was collected (AM / PM), what the tanker took, and
 * the running balance left at the BMC. Pure calculation — no database access in this file.
 *
 *   TOTAL          = AM + PM
 *   TO BE SENT     = O/B + AM            (last evening's milk + this morning's milk)
 *   C/B (book)     = PM                  (what should be left after dispatch)
 *   ACT-CB         = O/B + TOTAL - LOADED
 *   DIFF           = C/B - ACT-CB        (flagged "CB" when not zero)
 *   CAPACITY %     = TOTAL / CAPACITY
 *   O/B (next day) = ACT-CB of the previous day
 */

export interface ReceiptBmc {
  id: string;
  name: string;
  team: string;
  cc_code: number;
  capacity: number;
  /** Optional opening balance recorded on the BMC and the date it applies from. */
  opening?: number | null;
  opening_date?: string | null;
}

export interface DayFigures {
  am: number;
  pm: number;
  loaded: number;
  /** Opening balance for the first day of an imported series. */
  opening?: number | null;
}

export interface ReceiptRow {
  sno: number | null;
  date: string;
  team: string;
  cc_code: number | null;
  name: string;
  capacity: number;
  ob: number;
  am: number;
  pm: number;
  total: number;
  to_send: number;
  cb: number;
  loaded: number;
  act_cb: number;
  diff: number;
  util: number;
  flag: '' | 'CB';
}

export interface ReceiptDay {
  date: string;
  rows: ReceiptRow[];
  total: ReceiptRow;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const figureKey = (bmcId: string, date: string) => `${bmcId}|${date}`;

function utilPct(total: number, capacity: number): number {
  return capacity > 0 ? Math.round((total / capacity) * 100) : 0;
}

/**
 * Walks every day from `chainFrom` to `to` so each day's opening balance is the previous day's
 * actual closing balance, and returns only the days from `from` to `to`.
 */
export function buildReceiptDays(
  bmcs: ReceiptBmc[],
  figures: Map<string, DayFigures>,
  chainFrom: string,
  from: string,
  to: string,
): ReceiptDay[] {
  const start = chainFrom < from ? chainFrom : from;
  const ordered = [...bmcs].sort((a, b) => a.cc_code - b.cc_code);
  const prevAct = new Map<string, number>(ordered.map((b) => [b.id, 0]));
  const days: ReceiptDay[] = [];

  for (let date = start; date <= to; date = addDays(date, 1)) {
    const rows: ReceiptRow[] = [];
    ordered.forEach((b, i) => {
      const f = figures.get(figureKey(b.id, date));
      const am = round2(f?.am ?? 0);
      const pm = round2(f?.pm ?? 0);
      const loaded = round2(f?.loaded ?? 0);

      let ob = prevAct.get(b.id) ?? 0;
      if (f?.opening != null) ob = Number(f.opening);
      else if (b.opening != null && b.opening_date === date) ob = Number(b.opening);
      ob = round2(ob);

      const total = round2(am + pm);
      const act = round2(ob + total - loaded);
      const diff = round2(pm - act);
      prevAct.set(b.id, act);

      rows.push({
        sno: i + 1,
        date,
        team: b.team,
        cc_code: b.cc_code,
        name: b.name,
        capacity: b.capacity,
        ob,
        am,
        pm,
        total,
        to_send: round2(ob + am),
        cb: pm,
        loaded,
        act_cb: act,
        diff,
        util: utilPct(total, b.capacity),
        flag: Math.abs(diff) >= 0.5 ? 'CB' : '',
      });
    });

    if (date >= from) {
      const sum = (pick: (r: ReceiptRow) => number) => round2(rows.reduce((s, r) => s + pick(r), 0));
      const capacity = sum((r) => r.capacity);
      const total = sum((r) => r.total);
      const diff = sum((r) => r.diff);
      days.push({
        date,
        rows,
        total: {
          sno: null,
          date,
          team: '',
          cc_code: null,
          name: 'TOTAL',
          capacity,
          ob: sum((r) => r.ob),
          am: sum((r) => r.am),
          pm: sum((r) => r.pm),
          total,
          to_send: sum((r) => r.to_send),
          cb: sum((r) => r.cb),
          loaded: sum((r) => r.loaded),
          act_cb: sum((r) => r.act_cb),
          diff,
          util: utilPct(total, capacity),
          flag: '',
        },
      });
    }
  }
  return days;
}
