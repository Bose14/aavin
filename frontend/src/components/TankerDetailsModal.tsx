import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { formatDateDDMMYYYY, formatDateTimeDDMMYYYY } from '../lib/format';
import { ErrorBanner } from './UiPrimitives';
import { TankerDetailDrawer } from './TankerDetailDrawer';

interface Figures { litres: number; fat_pct: number; snf_pct: number; sp_gr: number; kg: number; fat_kg: number; snf_kg: number }
interface Diff { litres: number; fat_pct: number; snf_pct: number; kg: number; fat_kg: number; snf_kg: number }
interface Row {
  bmc_id: string; bmc_name: string; bmc_code: string | null; dc_number: string; cells: string[]; milk_type: string | null; mbrt: string | null;
  dispatched: Figures; acknowledged: Figures | null; difference: Diff | null;
}
interface DispatchAck { gross_weight_kg: number | null; tare_weight_kg: number | null; net_weight_kg: number | null; silo: string | null; route_name: string | null; driver_name: string | null; acknowledged: boolean; rows: Row[] }

const MILK_NAME: Record<string, string> = { RCM: 'Raw Cow Milk', SSM: 'Skim Separated Milk' };
const MILK_CODE: Record<string, string> = { 'Raw Cow Milk': 'RCM', 'Skim Separated Milk': 'SSM' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 12px', marginBottom: 12 };
const num = (v: number, d = 2) => v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v: number, d = 2) => (v > 0 ? '+' : '') + num(v, d);
const diffColour = (v: number) => (v < 0 ? '#b91c1c' : v > 0 ? '#15803d' : '#475569');

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginTop: 2, overflowWrap: 'anywhere' }}>{value || '—'}</div>
    </div>
  );
}

function Comparison({ row }: { row: Row }) {
  const a = row.acknowledged;
  const d = row.difference;
  const lines: { label: string; sent: number; got?: number; diff?: number; dp: number }[] = [
    { label: 'Quantity (L)', sent: row.dispatched.litres, got: a?.litres, diff: d?.litres, dp: 0 },
    { label: 'Fat %', sent: row.dispatched.fat_pct, got: a?.fat_pct, diff: d?.fat_pct, dp: 2 },
    { label: 'SNF %', sent: row.dispatched.snf_pct, got: a?.snf_pct, diff: d?.snf_pct, dp: 2 },
    { label: 'Quantity (kg)', sent: row.dispatched.kg, got: a?.kg, diff: d?.kg, dp: 1 },
    { label: 'Fat (kg)', sent: row.dispatched.fat_kg, got: a?.fat_kg, diff: d?.fat_kg, dp: 2 },
    { label: 'SNF (kg)', sent: row.dispatched.snf_kg, got: a?.snf_kg, diff: d?.snf_kg, dp: 2 },
  ];
  const th: React.CSSProperties = { textAlign: 'right', padding: '8px 6px', fontSize: 12, color: '#64748b', fontWeight: 600, borderBottom: '1px solid #e2e8f0' };
  const td: React.CSSProperties = { textAlign: 'right', padding: '8px 6px', fontSize: 13, borderBottom: '1px solid #f1f5f9' };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 300 }}>
        <thead>
          <tr><th style={{ ...th, textAlign: 'left' }}></th><th style={th}>Sent</th><th style={th}>Ack.</th><th style={th}>Diff.</th></tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.label}>
              <td style={{ ...td, textAlign: 'left', color: '#334155' }}>{l.label}</td>
              <td style={td}>{num(l.sent, l.dp)}</td>
              <td style={td}>{l.got != null ? num(l.got, l.dp) : <span style={{ color: '#94a3b8' }}>Awaiting</span>}</td>
              <td style={{ ...td, color: l.diff != null ? diffColour(l.diff) : '#94a3b8', fontWeight: 600 }}>{l.diff != null ? signed(l.diff, l.dp) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TankerDetailsModal({ tripId, onClose }: { tripId: string | null; onClose: () => void }) {
  const id = tripId;
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [trip, setTrip] = useState<any | null>(null);
  const [detail, setDetail] = useState<DispatchAck | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = async () => {
    if (!id) return;
    try {
      setError('');
      const [t, d] = await Promise.all([api.get(`/tanker/${id}`), api.get<DispatchAck>(`/tanker/${id}/dispatch-ack`)]);
      setTrip(t.data);
      setDetail(d.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Could not load this tanker. Try again.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setTrip(null);
    setDetail(null);
    void load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !drawerOpen) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, drawerOpen, onClose]);

  const steps: any[] = useMemo(() => trip?.journey?.timelineSteps ?? [], [trip]);
  const rows = detail?.rows ?? [];
  const milkCode = rows[0]?.milk_type ? MILK_CODE[rows[0].milk_type] ?? rows[0].milk_type : 'RCM';
  const totals = useMemo(() => {
    const sum = (f: (r: Row) => number | undefined) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);
    return { sent: sum((r) => r.dispatched.litres), got: sum((r) => r.acknowledged?.litres) };
  }, [rows]);

  // Header fat/SNF as on the old dashboard: plain average across the BMC rows (received once acknowledged, else dispatched)
  const avgOf = (pick: (r: Row) => number) => (rows.length ? rows.reduce((s, r) => s + pick(r), 0) / rows.length : null);
  const avgFat = avgOf((r) => (r.acknowledged ?? r.dispatched).fat_pct);
  const avgSnf = avgOf((r) => (r.acknowledged ?? r.dispatched).snf_pct);

  const badge = detail?.acknowledged
    ? { text: 'Acknowledged', bg: '#dcfce7', fg: '#166534' }
    : trip?.journey?.tripStatusLabel
      ? { text: trip.journey.tripStatusLabel as string, bg: '#fef3c7', fg: '#92400e' }
      : { text: 'On the way', bg: '#fef3c7', fg: '#92400e' };

  if (!id) return null;

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tanker details"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.65)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 900, padding: '1rem', overflowY: 'auto' }}
      >
        <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 1100, margin: 'auto', backgroundColor: '#f8fafc', borderRadius: 8, overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)' }}>
          <div style={{ backgroundColor: '#52525b', color: '#ffffff', padding: '0.5rem 1rem', fontSize: '0.88rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Tanker details{trip ? ` · ${trip.tanker_number}` : ''}</span>
            <button type="button" aria-label="Close" onClick={onClose} style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '1.1rem', cursor: 'pointer' }}>✕</button>
          </div>
          <div style={{ padding: "0.6rem" }}>
            {loading && <div style={{ padding: 16 }}>Loading tanker…</div>}
      {error && <ErrorBanner message={error} />}
      {trip && (
        <>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>Tanker {trip.tanker_number}</h2>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 999, background: badge.bg, color: badge.fg }}>{badge.text}</span>
                {isAdmin && (
                  <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={() => setDrawerOpen(true)}>
                    Full journey &amp; corrections
                  </button>
                )}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginTop: 14, padding: 14, background: '#f8fafc', borderRadius: 8 }}>
              <Fact label="Product name" value={`${MILK_NAME[milkCode] ?? milkCode} [${milkCode}]`} />
              <Fact label="CC/BMC" value={rows.map((r) => `${r.bmc_name}${r.bmc_code ? ` [${r.bmc_code}]` : ''}`).join(', ')} />
              <Fact label="DC no." value={[...new Set(rows.map((r) => r.dc_number))].join(', ') || trip.dc_number} />
              <Fact label="Dispatch quantity (kg)" value={rows.length ? num(rows.reduce((s, r) => s + r.dispatched.kg, 0), 1) : null} />
              <Fact label="Gross quantity (kg)" value={detail?.gross_weight_kg != null ? num(Number(detail.gross_weight_kg), 0) : null} />
              <Fact label="Tare quantity (kg)" value={detail?.tare_weight_kg != null ? num(Number(detail.tare_weight_kg), 0) : null} />
              <Fact label="Net quantity (kg)" value={detail?.net_weight_kg != null ? num(Number(detail.net_weight_kg), 0) : null} />
              <Fact label="Silo" value={detail?.silo} />
              <Fact label="Fat %" value={avgFat != null ? num(avgFat, 2) : null} />
              <Fact label="SNF %" value={avgSnf != null ? num(avgSnf, 3) : null} />
              <Fact label="Route" value={detail?.route_name} />
              <Fact label="Driver" value={detail?.driver_name || trip.driver_name} />
              <Fact label="Dispatched" value={`${formatDateDDMMYYYY(trip.date)}${trip.dispatch_time ? `, ${trip.dispatch_time}` : ''}`} />
              <Fact label="Union / destination" value={trip.destination} />
            </div>
          </div>

          <div style={card}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Where it went</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 4px' }}>
              {steps.map((s) => {
                const done = s.status === 'done';
                const current = s.status === 'current';
                const rejected = s.status === 'rejected';
                return (
                  <div key={s.key} style={{ flex: '1 0 76px', textAlign: 'center', minWidth: 76 }}>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', margin: '0 auto', boxSizing: 'border-box', border: `2px solid ${rejected ? '#b91c1c' : done ? '#16a34a' : current ? '#d97706' : '#cbd5e1'}`, background: done ? '#dcfce7' : rejected ? '#fee2e2' : '#fff' }} />
                    <div style={{ fontSize: 11, marginTop: 6, color: '#0f172a', lineHeight: 1.3 }}>{s.title}</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                      {done && s.done_at ? formatDateTimeDDMMYYYY(s.done_at) : current ? 'In progress' : rejected ? 'Rejected' : 'Pending'}
                    </div>
                  </div>
                );
              })}
            </div>
            {steps.find((s) => s.status === 'rejected')?.rejectionReason && (
              <div style={{ marginTop: 10, fontSize: 13, color: '#b91c1c' }}>Reason: {steps.find((s) => s.status === 'rejected').rejectionReason}</div>
            )}
          </div>

          <div style={card}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Send and received, by BMC</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900, fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', color: '#475569' }}>
                    {['Union name', 'CC-name', 'Cell', 'Send fat', 'Send SNF', 'Send qty (kg)', 'Send qty (L)', 'Recd fat', 'Recd SNF', 'Recd qty (kg)', 'Recd qty (L)', 'Recd MBRT', 'Recd Sp.Gr.'].map((h, i) => (
                      <th key={h} style={{ padding: '8px 8px', textAlign: i < 3 ? 'left' : 'right', fontWeight: 600, borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const a = r.acknowledged;
                    const cellStyle: React.CSSProperties = { padding: '8px 8px', textAlign: 'right', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' };
                    const left: React.CSSProperties = { ...cellStyle, textAlign: 'left', whiteSpace: 'normal' };
                    const dash = <span style={{ color: '#94a3b8' }}>—</span>;
                    return (
                      <tr key={`${r.bmc_id}|${r.dc_number}`}>
                        <td style={left}>{trip.destination || '—'}</td>
                        <td style={left}>{r.bmc_name}{r.bmc_code ? ` [${r.bmc_code}]` : ''}</td>
                        <td style={left}>{r.cells.join(', ')}</td>
                        <td style={cellStyle}>{num(r.dispatched.fat_pct, 2)}</td>
                        <td style={cellStyle}>{num(r.dispatched.snf_pct, 2)}</td>
                        <td style={cellStyle}>{num(r.dispatched.kg, 2)}</td>
                        <td style={cellStyle}>{num(r.dispatched.litres, 2)}</td>
                        <td style={cellStyle}>{a ? num(a.fat_pct, 2) : dash}</td>
                        <td style={cellStyle}>{a ? num(a.snf_pct, 2) : dash}</td>
                        <td style={cellStyle}>{a ? num(a.kg, 2) : dash}</td>
                        <td style={cellStyle}>{a ? num(a.litres, 2) : dash}</td>
                        <td style={cellStyle}>{r.mbrt || dash}</td>
                        <td style={cellStyle}>{a ? num(a.sp_gr, 4) : dash}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={card}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>{isAdmin ? 'Dispatched vs acknowledged, by BMC' : 'Your milk: dispatched vs acknowledged'}</h3>
            {rows.length === 0 && <div style={{ color: '#64748b', fontSize: 13 }}>No dispatch details found for this tanker.</div>}
            {rows.map((r) => (
              <div key={`${r.bmc_id}|${r.dc_number}`} style={{ marginBottom: rows.length > 1 ? 18 : 0 }}>
                {(isAdmin || rows.length > 1) && (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 6 }}>
                    <strong style={{ fontSize: 14 }}>{r.bmc_name}</strong>
                    {r.bmc_code && <span style={{ fontSize: 12, color: '#64748b' }}>{r.bmc_code}</span>}
                    <span style={{ fontSize: 12, color: '#64748b' }}>DC {r.dc_number} · cell {r.cells.join(', ')}</span>
                  </div>
                )}
                <Comparison row={r} />
              </div>
            ))}
            {isAdmin && rows.length > 1 && (
              <div style={{ marginTop: 6, fontSize: 13, color: '#334155' }}>
                Tanker total: dispatched <strong>{num(totals.sent, 0)} L</strong>
                {detail?.acknowledged && <> · acknowledged <strong>{num(totals.got, 0)} L</strong> · difference <strong style={{ color: diffColour(totals.got - totals.sent) }}>{signed(totals.got - totals.sent, 0)} L</strong></>}
              </div>
            )}
            {!detail?.acknowledged && rows.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>Acknowledged figures appear once the dairy has completed QC and weighed the tanker.</div>
            )}
          </div>
        </>
      )}
          </div>
        </div>
      </div>
      {isAdmin && <TankerDetailDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} trip={trip} onTripUpdated={() => void load()} isAdmin />}
    </>
  );
}
