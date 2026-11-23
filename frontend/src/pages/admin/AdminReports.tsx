import { useState } from 'react';
import api from '../../lib/api';

function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const inputStyle: React.CSSProperties = { height: 34, border: '1px solid #cbd5e1', borderRadius: 4, padding: '0 8px', fontSize: 13, width: '100%', maxWidth: 220 };

export default function AdminReports() {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const invalid = !from || !to || from > to;

  // Opens the PDF in a new tab (the viewer has its own download button)
  const download = async () => {
    setBusy(true);
    setError('');
    // Open the tab right away so the browser does not block it as a pop-up
    const tab = window.open('', '_blank');
    try {
      const res = await api.get('/export/recon-report', { params: { from, to }, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      // Open the PDF in the browser's own viewer (it has its own download and print buttons)
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
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ background: '#52525b', color: '#fff', textAlign: 'center', padding: '8px 12px', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', fontSize: 14 }}>
        Milk Bill Union Reports
      </div>
      <div className="card" style={{ padding: 16, borderRadius: 0 }}>
        <div className="fl-row">
          <label style={{ width: 280, fontWeight: 700, fontSize: 13 }}>Quantity And Quality Reconciliation Report</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>From Date</label>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
            <label style={{ fontSize: 12, fontWeight: 600 }}>To Date</label>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
            <button
              type="button"
              onClick={download}
              disabled={invalid || busy}
              style={{ background: '#65a30d', color: '#fff', border: 0, borderRadius: 4, height: 34, padding: '0 18px', fontWeight: 700, cursor: invalid || busy ? 'not-allowed' : 'pointer', opacity: invalid || busy ? 0.6 : 1 }}
            >
              {busy ? 'Preparing…' : 'PDF'}
            </button>
          </div>
        </div>
        {error && <div style={{ color: '#b91c1c', fontSize: 12 }}>{error}</div>}
        {from > to && to && <div style={{ color: '#b91c1c', fontSize: 12 }}>From date must be on or before To date.</div>}
      </div>
    </div>
  );
}
