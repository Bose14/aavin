/**
 * Data for the "Quantity And Quality Reconciliation Report": for each tanker, what every BMC sent,
 * what the union acknowledged per cell, and what was acknowledged back to each BMC.
 */

export interface ReconLoading {
  bmc_id: string | number;
  dc_number: string;
  cell_key: string;
  quantity_litres: number | string;
  fat_pct: number | string | null;
  snf_pct: number | string | null;
  dispatch_at?: string | null;
  id?: number | string;
}

export interface ReconAck {
  bmc_id: string | number;
  dc_number: string;
  ack_litres: number | string;
  ack_fat_pct: number | string;
  ack_snf_pct: number | string;
}

export interface ReconQuality {
  cell?: string;
  fat?: number | string;
  snf?: number | string;
  temp?: number | string;
  mbrt?: string;
}

export interface ReconTripInput {
  trip_id: string;
  trip_date: string;
  vehicle_number: string;
  loadings: ReconLoading[];
  acks: ReconAck[];
  received_quality: unknown;
}

export interface ReconLine {
  cell: string;
  bmc_name: string;
  dc_number: string;
  litres: number;
  fat: number;
  snf: number;
  /** Ack at union: only on the last line of each cell */
  union: { litres: number; fat: number; snf: number; temp: number | null; mbrt: string } | null;
  /** Ack to BMC numbers: only on the first line of each BMC (the Locations name repeats on every line) */
  to_bmc: { litres: number; fat: number; snf: number } | null;
}

export interface ReconTanker {
  trip_id: string;
  trip_date: string;
  vehicle_number: string;
  dc_number: string;
  lines: ReconLine[];
}

const CELL_ORDER: Record<string, number> = { FC: 0, MC: 1, BC: 2 };
const n = (v: unknown) => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));

export function buildReconciliation(trips: ReconTripInput[], bmcNames: Map<string, string>): ReconTanker[] {
  const out: ReconTanker[] = [];
  for (const t of trips) {
    if (t.loadings.length === 0) continue;
    const nameOf = (id: string | number) => bmcNames.get(String(id)) ?? `BMC ${id}`;

    // One row per (cell, BMC, DC)
    const rowsMap = new Map<string, { cell: string; bmc_id: string; dc: string; litres: number; fatL: number; snfL: number; order: string }>();
    for (const l of t.loadings) {
      const cell = String(l.cell_key).toUpperCase();
      const key = `${cell}|${l.bmc_id}|${l.dc_number}`;
      const r = rowsMap.get(key) ?? { cell, bmc_id: String(l.bmc_id), dc: String(l.dc_number), litres: 0, fatL: 0, snfL: 0, order: `${l.dispatch_at ?? ''}|${String(l.id ?? '').padStart(12, '0')}` };
      const q = n(l.quantity_litres);
      r.litres += q;
      r.fatL += q * n(l.fat_pct);
      r.snfL += q * n(l.snf_pct);
      rowsMap.set(key, r);
    }
    const rows = [...rowsMap.values()].sort(
      (a, b) => (CELL_ORDER[a.cell] ?? 9) - (CELL_ORDER[b.cell] ?? 9) || a.order.localeCompare(b.order),
    );

    // Each BMC's total sent across cells, to split its acknowledgement between cells
    const bmcTotal = new Map<string, number>();
    for (const r of rows) bmcTotal.set(`${r.bmc_id}|${r.dc}`, (bmcTotal.get(`${r.bmc_id}|${r.dc}`) ?? 0) + r.litres);
    const ackBy = new Map(t.acks.map((a) => [`${a.bmc_id}|${a.dc_number}`, a]));

    const qualityBy = new Map<string, ReconQuality>();
    if (Array.isArray(t.received_quality)) {
      for (const q of t.received_quality as ReconQuality[]) qualityBy.set(String(q.cell ?? '').toUpperCase(), q);
    }

    // Ack at union per cell
    const cellAck = new Map<string, { litres: number; fatL: number; snfL: number }>();
    for (const r of rows) {
      const a = ackBy.get(`${r.bmc_id}|${r.dc}`);
      if (!a) continue;
      const share = (n(a.ack_litres) * r.litres) / (bmcTotal.get(`${r.bmc_id}|${r.dc}`) || 1);
      const c = cellAck.get(r.cell) ?? { litres: 0, fatL: 0, snfL: 0 };
      c.litres += share;
      c.fatL += share * n(a.ack_fat_pct);
      c.snfL += share * n(a.ack_snf_pct);
      cellAck.set(r.cell, c);
    }

    const lastRowOfCell = new Map<string, number>();
    rows.forEach((r, i) => lastRowOfCell.set(r.cell, i));
    const seenBmc = new Set<string>();

    const lines: ReconLine[] = rows.map((r, i) => {
      let union: ReconLine['union'] = null;
      if (lastRowOfCell.get(r.cell) === i && cellAck.has(r.cell)) {
        const c = cellAck.get(r.cell)!;
        const q = qualityBy.get(r.cell);
        union = {
          litres: Math.round(c.litres),
          fat: q && n(q.fat) > 0 ? n(q.fat) : c.litres ? c.fatL / c.litres : 0,
          snf: q && n(q.snf) > 0 ? n(q.snf) : c.litres ? c.snfL / c.litres : 0,
          temp: q && q.temp != null && q.temp !== '' ? n(q.temp) : null,
          mbrt: q?.mbrt ? String(q.mbrt).trim() : '',
        };
      }
      const key = `${r.bmc_id}|${r.dc}`;
      let to_bmc: ReconLine['to_bmc'] = null;
      if (!seenBmc.has(key)) {
        seenBmc.add(key);
        const a = ackBy.get(key);
        if (a) to_bmc = { litres: Math.round(n(a.ack_litres)), fat: n(a.ack_fat_pct), snf: n(a.ack_snf_pct) };
      }
      return {
        cell: r.cell,
        bmc_name: nameOf(r.bmc_id),
        dc_number: r.dc,
        litres: Math.round(r.litres),
        fat: r.litres ? r.fatL / r.litres : 0,
        snf: r.litres ? r.snfL / r.litres : 0,
        union,
        to_bmc,
      };
    });

    out.push({ trip_id: t.trip_id, trip_date: t.trip_date, vehicle_number: t.vehicle_number, dc_number: rows[0].dc, lines });
  }
  return out;
}
