import { useState } from 'react';
import api from '../../lib/api';
import { formatDateDDMMYYYY, triggerBlobDownload } from '../../lib/format';

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

type AckGroup = 'date' | 'team' | 'bmc' | 'tanker';
const ACK_GROUPS: { id: AckGroup; label: string; hint: string }[] = [
  { id: 'date', label: 'Date-wise', hint: 'Every entry by date, with a total after each tanker' },
  { id: 'team', label: 'Team-wise', hint: 'Grouped by team (RPM, T.CODE, NKL …) with team totals and a summary sheet' },
  { id: 'bmc', label: 'BMC-wise', hint: 'Grouped by BMC with BMC totals and a summary sheet' },
  { id: 'tanker', label: 'Tanker-wise', hint: 'Grouped by tanker with tanker totals and a summary sheet' },
];

export default function AdminReports() {
  const [preset, setPreset] = useState<Preset>('today');
  const [from, setFrom] = useState(rangeFor('today').from);
  const [to, setTo] = useState(rangeFor('today').to);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ackGroup, setAckGroup] = useState<AckGroup>('date');
  const [ackBusy, setAckBusy] = useState(false);

  const invalid = !from || !to || from > to;

  const pick = (p: Exclude<Preset, 'custom'>) => {
    const r = rangeFor(p);
    setPreset(p);
    setFrom(r.from);
    setTo(r.to);
  };

  const downloadAck = async () => {
    setAckBusy(true);
    setError('');
    try {
      const suffix = ackGroup === 'date' ? '' : `_${ackGroup}_wise`;
      await triggerBlobDownload('/export/milk-ack', { from, to, format: 'xlsx', ...(ackGroup === 'date' ? {} : { group: ackGroup }) }, `Milk_ACK${suffix}_${from}_to_${to}.xlsx`);
    } catch {
      setError('Could not download the report. Please try again.');
    } finally {
      setAckBusy(false);
    }
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
        <h1 style={{ margin: 0 }}>Milk Bill Union Reports</h1>
      </div>

      <div className="card rp-report">
        <span className="rp-label">Date range (applies to every report below)</span>
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
        <div className="rp-dates" style={{ marginBottom: 0 }}>
          <div>
            <label className="rp-label" htmlFor="rp-from">From date</label>
            <input id="rp-from" type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPreset('custom'); }} />
          </div>
          <div>
            <label className="rp-label" htmlFor="rp-to">To date</label>
            <input id="rp-to" type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPreset('custom'); }} />
          </div>
        </div>
        {from > to && to && <div className="rp-error">From date must be on or before To date.</div>}
        {error && <div className="rp-error">{error}</div>}
      </div>

      <div className="rp-grid">
        <div>
          <div className="card rp-report">
            <div className="rp-report-top">
              <div className="rp-icon">📊</div>
              <div>
                <h2>Milk ACK Report</h2>
                <p>Milk disposal and acknowledgement statement as an Excel file. Choose how it is grouped.</p>
              </div>
            </div>
            <span className="rp-label">Report by</span>
            <div className="rp-chips" style={{ marginBottom: '0.5rem' }}>
              {ACK_GROUPS.map((g) => (
                <button key={g.id} type="button" className={`rp-chip${ackGroup === g.id ? ' active' : ''}`} onClick={() => setAckGroup(g.id)}>
                  {g.label}
                </button>
              ))}
            </div>
            <p className="rp-range" style={{ marginTop: 0, marginBottom: '1.1rem' }}>{ACK_GROUPS.find((g) => g.id === ackGroup)?.hint}</p>
            <div className="rp-actions">
              <button type="button" className="rp-pdf" onClick={downloadAck} disabled={invalid || ackBusy}>
                {ackBusy ? 'Preparing…' : 'Download Excel'}
              </button>
              {!invalid && (
                <span className="rp-range">
                  {from === to ? formatDateDDMMYYYY(from) : `${formatDateDDMMYYYY(from)} to ${formatDateDDMMYYYY(to)}`}
                </span>
              )}
            </div>
          </div>

          <div className="card rp-report">
            <div className="rp-report-top">
              <div className="rp-icon">📄</div>
              <div>
                <h2>Quantity And Quality Reconciliation Report</h2>
                <p>What each BMC sent on every tanker, what the union received and what was acknowledged back to each BMC.</p>
              </div>
            </div>
            <div className="rp-actions">
              <button type="button" className="rp-pdf" onClick={openPdf} disabled={invalid || busy}>
                {busy ? 'Preparing…' : 'Open PDF'}
              </button>
              <span className="rp-range">Opens in a new tab</span>
            </div>
          </div>
        </div>

        <div className="card rp-info">
          <h3>Milk ACK Report options</h3>
          <ul>
            <li><b>Date-wise:</b> every entry by date, with a total after each tanker</li>
            <li><b>Team-wise:</b> grouped by team, with a total per team</li>
            <li><b>BMC-wise:</b> grouped by BMC, with a total per BMC</li>
            <li><b>Tanker-wise:</b> grouped by tanker, with a total per tanker</li>
          </ul>
          <h3 style={{ marginTop: '1rem' }}>Good to know</h3>
          <ul>
            <li>Team, BMC and tanker reports also have a Summary sheet with one line per group.</li>
            <li>Total rows are highlighted.</li>
            <li>Cancelled trips are left out.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
