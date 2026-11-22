import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../lib/api';
import { formatDateDDMMYYYY, getLocalTodayIso } from '../../lib/format';
import { gridToCsv, milkTypeLabel, parseRateCsv } from '../../lib/rateChart';
import type { RateChartGrid } from '../../lib/rateChart';
import { ConfirmDialog, ErrorBanner, TableSkeleton } from '../../components/UiPrimitives';

type MilkType = 'COW' | 'BUFFALO';

interface Version {
  id: string;
  milk_type: MilkType;
  effective_from: string;
  name: string | null;
  cells: number;
  is_current: boolean;
  is_future: boolean;
}

interface ChartDetail extends RateChartGrid {
  id: string;
  milk_type: MilkType;
  effective_from: string;
}

const th: React.CSSProperties = { padding: '6px 8px', fontSize: '0.74rem', background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', whiteSpace: 'nowrap', position: 'sticky', top: 0 };
const td: React.CSSProperties = { padding: '5px 8px', fontSize: '0.82rem', borderBottom: '1px solid #eef2f7', textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const lbl: React.CSSProperties = { width: 150, fontWeight: 600, color: '#1e293b', fontSize: '0.86rem' };
const input: React.CSSProperties = { height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 };

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminRateChart() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<MilkType>('COW');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChartDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [fatFilter, setFatFilter] = useState('');

  const [showUpload, setShowUpload] = useState(false);
  const [upType, setUpType] = useState<MilkType>('COW');
  const [upDate, setUpDate] = useState(() => getLocalTodayIso());
  const [upName, setUpName] = useState('');
  const [upGrid, setUpGrid] = useState<RateChartGrid | null>(null);
  const [upFile, setUpFile] = useState('');
  const [upErrors, setUpErrors] = useState<string[]>([]);
  const [upSaving, setUpSaving] = useState(false);
  const [upError, setUpError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<Version | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<Version[]>('/rates/charts');
      setVersions(res.data || []);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load rate charts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ofType = useMemo(() => versions.filter((v) => v.milk_type === tab), [versions, tab]);

  // Show the chart in force today by default, or whichever version was picked
  useEffect(() => {
    const pick = ofType.find((v) => v.id === selectedId) ?? ofType.find((v) => v.is_current) ?? ofType[0] ?? null;
    if (!pick) {
      setSelectedId(null);
      setDetail(null);
      return;
    }
    if (pick.id !== selectedId) setSelectedId(pick.id);
  }, [ofType, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setDetailLoading(true);
    api.get<ChartDetail>(`/rates/charts/${selectedId}`)
      .then((res) => { if (!cancelled) setDetail(res.data); })
      .catch(() => { if (!cancelled) setError('Could not load this chart'); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const visibleRows = useMemo(() => {
    if (!detail) return [];
    const q = fatFilter.trim();
    return detail.fat_values
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => !q || String(f).startsWith(q));
  }, [detail, fatFilter]);

  const openUpload = () => {
    setUpType(tab);
    setUpDate(getLocalTodayIso());
    setUpName('');
    setUpGrid(null);
    setUpFile('');
    setUpErrors([]);
    setUpError('');
    setShowUpload(true);
  };

  const onFile = async (file: File | undefined) => {
    setUpGrid(null);
    setUpErrors([]);
    setUpError('');
    if (!file) return;
    setUpFile(file.name);
    const { grid, errors } = parseRateCsv(await file.text());
    if (errors.length) setUpErrors(errors);
    else if (grid) setUpGrid(grid);
  };

  const publish = async () => {
    if (!upGrid) return;
    setUpSaving(true);
    setUpError('');
    try {
      await api.post('/rates/charts', {
        milk_type: upType,
        effective_from: upDate,
        name: upName.trim() || null,
        ...upGrid,
      });
      setShowUpload(false);
      setNotice(`✓ New ${milkTypeLabel(upType).toLowerCase()} rate chart saved. It applies to milk collected from ${formatDateDDMMYYYY(upDate)}.`);
      setTab(upType);
      setSelectedId(null);
      await load();
    } catch (err: unknown) {
      setUpError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not save the chart');
    } finally {
      setUpSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/rates/charts/${deleteTarget.id}`);
      setDeleteTarget(null);
      setSelectedId(null);
      setNotice('Rate chart deleted.');
      await load();
    } catch (err: unknown) {
      setDeleteTarget(null);
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not delete');
    } finally {
      setDeleting(false);
    }
  };

  const range = (v: number[]) => (v.length ? `${Math.min(...v).toFixed(1)}–${Math.max(...v).toFixed(1)}` : '');
  const selected = ofType.find((v) => v.id === selectedId) ?? null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>Rate Chart</h1>
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 2 }}>
            Price per litre by Fat % and SNF %. Milk entries use the chart that was in force on their collection date.
          </div>
        </div>
        <button
          type="button"
          onClick={openUpload}
          style={{ background: '#65a30d', color: '#fff', border: 'none', borderRadius: 3, padding: '7px 16px', fontWeight: 700, fontSize: '0.86rem', cursor: 'pointer' }}
        >
          + Upload New Chart
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && (
        <div className="success-banner" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['COW', 'BUFFALO'] as MilkType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); setSelectedId(null); setFatFilter(''); }}
            style={{
              padding: '6px 18px', borderRadius: 3, fontWeight: 700, fontSize: '0.86rem', cursor: 'pointer',
              border: '1px solid #cbd5e1', background: tab === t ? '#0284c7' : '#f1f5f9', color: tab === t ? '#fff' : '#334155',
            }}
          >
            {milkTypeLabel(t)} milk
          </button>
        ))}
      </div>

      {loading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : ofType.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1.25rem', color: '#64748b' }}>
          No {milkTypeLabel(tab).toLowerCase()} rate chart yet. BMCs set to {milkTypeLabel(tab).toLowerCase()} milk cannot save entries until one is added.
        </div>
      ) : (
        <div className="rc-layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: 14, alignItems: 'start' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 10 }}>
            <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', color: '#475569', fontWeight: 700, marginBottom: 6 }}>Versions</div>
            {ofType.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedId(v.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 6, borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${v.id === selectedId ? '#0284c7' : '#e2e8f0'}`, background: v.id === selectedId ? '#f0f9ff' : '#fff',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>
                  From {formatDateDDMMYYYY(v.effective_from)}
                  {v.is_current && <span style={{ marginLeft: 8, fontSize: '0.7rem', background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: 3 }}>In use</span>}
                  {v.is_future && <span style={{ marginLeft: 8, fontSize: '0.7rem', background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: 3 }}>Upcoming</span>}
                </div>
                <div style={{ fontSize: '0.74rem', color: '#64748b' }}>{v.name || 'Rate chart'} · {v.cells} rates</div>
              </button>
            ))}
          </div>

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 12, minWidth: 0 }}>
            {detailLoading || !detail ? (
              <TableSkeleton rows={6} cols={6} />
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: '0.84rem', color: '#334155' }}>
                    <strong>{milkTypeLabel(detail.milk_type)} milk</strong> · from {formatDateDDMMYYYY(detail.effective_from)} · Fat {range(detail.fat_values)} · SNF {range(detail.snf_values)}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      value={fatFilter}
                      onChange={(e) => setFatFilter(e.target.value)}
                      placeholder="Jump to fat, e.g. 4.5"
                      style={{ ...input, width: 150 }}
                    />
                    <button
                      type="button"
                      onClick={() => download(`${detail.milk_type.toLowerCase()}-rate-chart-${detail.effective_from}.csv`, gridToCsv(detail))}
                      style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 3, padding: '4px 12px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Download CSV
                    </button>
                    {selected?.is_future && (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(selected)}
                        style={{ background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 3, padding: '4px 12px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ overflow: 'auto', maxHeight: '60vh', border: '1px solid #e2e8f0', borderRadius: 4 }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ ...th, textAlign: 'left', left: 0, zIndex: 2 }}>FAT \ SNF</th>
                        {detail.snf_values.map((s) => <th key={s} style={{ ...th, textAlign: 'right' }}>{s.toFixed(1)}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map(({ f, i }) => (
                        <tr key={f}>
                          <td style={{ ...td, textAlign: 'left', fontWeight: 700, background: '#f8fafc', position: 'sticky', left: 0 }}>{f.toFixed(1)}</td>
                          {detail.rates[i].map((r, j) => <td key={j} style={td}>{r.toFixed(2)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showUpload && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem', overflowY: 'auto' }}>
          <div style={{ width: '100%', maxWidth: 600, margin: 'auto', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)' }}>
            <div style={{ background: '#52525b', color: '#fff', padding: '0.5rem 1rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '0.88rem', display: 'flex', justifyContent: 'space-between' }}>
              <span>Upload New Rate Chart</span>
              <button type="button" onClick={() => setShowUpload(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.1rem', cursor: 'pointer' }}>✕</button>
            </div>
            <div className="sheet-modal-body" style={{ padding: '1.1rem 1.4rem' }}>
              {upError && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 4, marginBottom: 12, fontSize: '0.85rem' }}>{upError}</div>}

              <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                <label style={lbl}>Milk Type</label>
                <select value={upType} onChange={(e) => setUpType(e.target.value as MilkType)} style={{ ...input, width: 160 }}>
                  <option value="COW">Cow</option>
                  <option value="BUFFALO">Buffalo</option>
                </select>
              </div>
              <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                <label style={lbl}>Applies From</label>
                <input type="date" value={upDate} onChange={(e) => setUpDate(e.target.value)} style={{ ...input, width: 160 }} />
              </div>
              <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                <label style={lbl}>Name (optional)</label>
                <input value={upName} onChange={(e) => setUpName(e.target.value)} placeholder="e.g. Dec 2026 rate card" style={{ ...input, width: 260 }} />
              </div>
              <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                <label style={lbl}>Rate Card (CSV)</label>
                <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
              </div>
              <div className="fl-hint" style={{ fontSize: '0.76rem', color: '#64748b', marginLeft: 150, marginBottom: 10 }}>
                First row: Fat/Snf then the SNF values. Each next row: a fat value then its rate for every SNF column. Download the current chart as a template.
              </div>

              {upErrors.length > 0 && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 4, padding: '8px 12px', fontSize: '0.82rem', marginBottom: 10 }}>
                  <strong>{upFile}</strong> has problems:
                  <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>{upErrors.map((m) => <li key={m}>{m}</li>)}</ul>
                </div>
              )}
              {upGrid && (
                <div style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#166534', borderRadius: 4, padding: '8px 12px', fontSize: '0.84rem', marginBottom: 10 }}>
                  <strong>{upFile}</strong> looks good: {upGrid.fat_values.length} fat rows ({range(upGrid.fat_values)}) × {upGrid.snf_values.length} SNF columns ({range(upGrid.snf_values)}),
                  rates {Math.min(...upGrid.rates.flat()).toFixed(2)}–{Math.max(...upGrid.rates.flat()).toFixed(2)}.
                </div>
              )}
              <div style={{ fontSize: '0.78rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '6px 10px', marginBottom: 12 }}>
                Entries already saved keep the rate they were priced with. The new chart is used for milk collected on or after the date above.
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => void publish()}
                  disabled={!upGrid || !upDate || upSaving}
                  style={{ background: '#65a30d', color: '#fff', border: 'none', borderRadius: 3, padding: '6px 18px', fontWeight: 700, fontSize: '0.86rem', cursor: !upGrid || upSaving ? 'not-allowed' : 'pointer', opacity: !upGrid || upSaving ? 0.6 : 1 }}
                >
                  {upSaving ? 'Saving…' : 'Save Chart'}
                </button>
                <button type="button" onClick={() => setShowUpload(false)} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', color: '#475569', borderRadius: 3, padding: '6px 14px', fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this rate chart?"
        message={deleteTarget ? `The upcoming ${milkTypeLabel(deleteTarget.milk_type).toLowerCase()} chart starting ${formatDateDDMMYYYY(deleteTarget.effective_from)} will be removed.` : ''}
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
