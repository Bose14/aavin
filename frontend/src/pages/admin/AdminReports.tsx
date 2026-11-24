import { useState } from 'react';
import api from '../../lib/api';
import { formatDateDDMMYYYY } from '../../lib/format';

type Preset = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom';
const ymd = (d: Date) => d.toLocaleDateString('en-CA'); // local yyyy-mm-dd

const PRESETS: { id: Exclude<Preset, 'custom'>; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
];

// Week runs Monday to Sunday; "this week" and "this month" end today.
function rangeFor(preset: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const shift = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const sinceMonday = (day.getDay() + 6) % 7;
  switch (preset) {
    case 'today':
      return { from: ymd(day), to: ymd(day) };
    case 'yesterday':
      return { from: ymd(shift(day, -1)), to: ymd(shift(day, -1)) };
    case 'this_week':
      return { from: ymd(shift(day, -sinceMonday)), to: ymd(day) };
    case 'last_week': {
      const monday = shift(day, -sinceMonday);
      return { from: ymd(shift(monday, -7)), to: ymd(shift(monday, -1)) };
    }
    case 'this_month':
      return { from: ymd(new Date(day.getFullYear(), day.getMonth(), 1)), to: ymd(day) };
    default:
      return { from: ymd(new Date(day.getFullYear(), day.getMonth() - 1, 1)), to: ymd(new Date(day.getFullYear(), day.getMonth(), 0)) };
  }
}

export default function AdminReports() {
  const [preset, setPreset] = useState<Preset>('today');
  const [from, setFrom] = useState(rangeFor('today').from);
  const [to, setTo] = useState(rangeFor('today').to);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const invalid = !from || !to || from > to;

  const pick = (p: Exclude<Preset, 'custom'>) => {
    const r = rangeFor(p);
    setPreset(p);
    setFrom(r.from);
    setTo(r.to);
  };

  // Opens the PDF in a new tab (the browser's PDF viewer has its own download button)
  const openPdf = async () => {
    setBusy(true);
    setError('');
    // Open the tab right away so the browser does not block it as a pop-up
    const tab = window.open('', '_blank');
    try {
      const res = await api.get('/export/recon-report', { params: { from, to }, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      if (tab) tab.location.replace(url);
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } catch {
      tab?.close();
      setError('Could not open the report. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="rp-head">
        <h1>Milk Bill Union Reports</h1>
        <p>Pick a date range and open the report as a PDF.</p>
      </div>

      <div className="rp-grid">
        <div className="card rp-report">
          <div className="rp-report-top">
            <div className="rp-icon">📄</div>
            <div>
              <h2>Quantity And Quality Reconciliation Report</h2>
              <p>What each BMC sent on every tanker, what the union received and what was acknowledged back to each BMC.</p>
            </div>
          </div>

          <span className="rp-label">Date range</span>
          <div className="rp-chips">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" className={`rp-chip${preset === p.id ? ' active' : ''}`} onClick={() => pick(p.id)}>
                {p.label}
              </button>
            ))}
            <button type="button" className={`rp-chip${preset === 'custom' ? ' active' : ''}`} onClick={() => setPreset('custom')}>
              Custom
            </button>
          </div>

          <div className="rp-dates">
            <div>
              <label className="rp-label" htmlFor="rp-from">From date</label>
              <input id="rp-from" type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPreset('custom'); }} />
            </div>
            <div>
              <label className="rp-label" htmlFor="rp-to">To date</label>
              <input id="rp-to" type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPreset('custom'); }} />
            </div>
          </div>

          <div className="rp-actions">
            <button type="button" className="rp-pdf" onClick={openPdf} disabled={invalid || busy}>
              {busy ? 'Preparing…' : 'Open PDF'}
            </button>
            {!invalid && (
              <span className="rp-range">
                {from === to ? formatDateDDMMYYYY(from) : `${formatDateDDMMYYYY(from)} to ${formatDateDDMMYYYY(to)}`}
              </span>
            )}
          </div>
          {from > to && to && <div className="rp-error">From date must be on or before To date.</div>}
          {error && <div className="rp-error">{error}</div>}
        </div>

        <div className="card rp-info">
          <h3>What is in the report</h3>
          <ul>
            <li>One block per tanker with its vehicle number and DC number</li>
            <li>Send details: litres, fat and SNF per BMC and cell (FC / MC / BC)</li>
            <li>Ack at union: litres, fat, SNF, temperature and MBRT per cell</li>
            <li>Ack to BMC: litres, fat and SNF acknowledged back to each BMC</li>
          </ul>
          <h3 style={{ marginTop: '1rem' }}>Good to know</h3>
          <ul>
            <li>The report opens in a new tab. Use the viewer to download or print it.</li>
            <li>Cancelled trips are left out.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
