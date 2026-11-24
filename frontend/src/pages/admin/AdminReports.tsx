import { useState, type ReactNode } from 'react';
import api from '../../lib/api';
import { formatDateDDMMYYYY, triggerBlobDownload } from '../../lib/format';
import { Page, PageHeader } from '../../components/PageLayout';

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

/** Each report owns one of these, so every report has its own date range. */
function useDateRange() {
  const [preset, setPreset] = useState<Preset>('today');
  const [from, setFrom] = useState(rangeFor('today').from);
  const [to, setTo] = useState(rangeFor('today').to);
  const pick = (p: Exclude<Preset, 'custom'>) => {
    const r = rangeFor(p);
    setPreset(p);
    setFrom(r.from);
    setTo(r.to);
  };
  const setFromDate = (v: string) => { setFrom(v); setPreset('custom'); };
  const setToDate = (v: string) => { setTo(v); setPreset('custom'); };
  return { preset, setPreset, from, to, pick, setFromDate, setToDate, invalid: !from || !to || from > to };
}
type DateRange = ReturnType<typeof useDateRange>;

function DateRangeFields({ r, idPrefix }: { r: DateRange; idPrefix: string }) {
  return (
    <>
      <span className="rp-label">Date range</span>
      <div className="rp-chips">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className={`rp-chip${r.preset === p.id ? ' active' : ''}`} onClick={() => r.pick(p.id)}>
            {p.label}
          </button>
        ))}
        <button type="button" className={`rp-chip${r.preset === 'custom' ? ' active' : ''}`} onClick={() => r.setPreset('custom')}>
          Custom
        </button>
      </div>
      <div className="rp-dates">
        <div>
          <label className="rp-label" htmlFor={`${idPrefix}-from`}>From date</label>
          <input id={`${idPrefix}-from`} type="date" value={r.from} max={r.to || undefined} onChange={(e) => r.setFromDate(e.target.value)} />
        </div>
        <div>
          <label className="rp-label" htmlFor={`${idPrefix}-to`}>To date</label>
          <input id={`${idPrefix}-to`} type="date" value={r.to} min={r.from || undefined} onChange={(e) => r.setToDate(e.target.value)} />
        </div>
      </div>
      {r.from > r.to && r.to && <div className="rp-error" style={{ marginBottom: '0.8rem' }}>From date must be on or before To date.</div>}
    </>
  );
}

function ReportLayout({ icon, title, description, info, children }: { icon: string; title: string; description: string; info: ReactNode; children: ReactNode }) {
  return (
    <div className="rp-grid">
      <div className="card rp-report">
        <div className="rp-report-top">
          <div className="rp-icon">{icon}</div>
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
        {children}
      </div>
      <div className="card rp-info">{info}</div>
    </div>
  );
}

function rangeText(r: DateRange) {
  return r.from === r.to ? formatDateDDMMYYYY(r.from) : `${formatDateDDMMYYYY(r.from)} to ${formatDateDDMMYYYY(r.to)}`;
}

function MilkAckReport() {
  const r = useDateRange();
  const [group, setGroup] = useState<AckGroup>('date');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const suffix = group === 'date' ? '' : `_${group}_wise`;
      await triggerBlobDownload('/export/milk-ack', { from: r.from, to: r.to, format: 'xlsx', ...(group === 'date' ? {} : { group }) }, `Milk_ACK${suffix}_${r.from}_to_${r.to}.xlsx`);
    } catch {
      setError('Could not download the report. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ReportLayout
      icon="📊"
      title="Milk ACK Report"
      description="Milk disposal and acknowledgement statement as an Excel file. Choose how it is grouped."
      info={
        <>
          <h3>Report by</h3>
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
        </>
      }
    >
      <DateRangeFields r={r} idPrefix="ack" />
      <span className="rp-label">Report by</span>
      <div className="rp-chips" style={{ marginBottom: '0.5rem' }}>
        {ACK_GROUPS.map((g) => (
          <button key={g.id} type="button" className={`rp-chip${group === g.id ? ' active' : ''}`} onClick={() => setGroup(g.id)}>
            {g.label}
          </button>
        ))}
      </div>
      <p className="rp-range" style={{ marginTop: 0, marginBottom: '1.1rem' }}>{ACK_GROUPS.find((g) => g.id === group)?.hint}</p>
      <div className="rp-actions">
        <button type="button" className="rp-pdf" onClick={download} disabled={r.invalid || busy}>
          {busy ? 'Preparing…' : 'Download Excel'}
        </button>
        {!r.invalid && <span className="rp-range">{rangeText(r)}</span>}
      </div>
      {error && <div className="rp-error">{error}</div>}
    </ReportLayout>
  );
}

function ReconciliationReport() {
  const r = useDateRange();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Opens the PDF in a new tab (the browser's PDF viewer has its own download button)
  const openPdf = async () => {
    setBusy(true);
    setError('');
    // Open the tab right away so the browser does not block it as a pop-up
    const tab = window.open('', '_blank');
    try {
      const res = await api.get('/export/recon-report', { params: { from: r.from, to: r.to }, responseType: 'blob' });
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
    <ReportLayout
      icon="📄"
      title="Quantity And Quality Reconciliation Report"
      description="What each BMC sent on every tanker, what the union received and what was acknowledged back to each BMC."
      info={
        <>
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
        </>
      }
    >
      <DateRangeFields r={r} idPrefix="recon" />
      <div className="rp-actions">
        <button type="button" className="rp-pdf" onClick={openPdf} disabled={r.invalid || busy}>
          {busy ? 'Preparing…' : 'Open PDF'}
        </button>
        {!r.invalid && <span className="rp-range">{rangeText(r)}</span>}
      </div>
      {error && <div className="rp-error">{error}</div>}
    </ReportLayout>
  );
}

const TABS = [
  { id: 'ack', label: 'Milk ACK Report' },
  { id: 'recon', label: 'Reconciliation Report' },
] as const;

export default function AdminReports() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('ack');
  return (
    <Page>
      <PageHeader title={<>Milk Bill Union Reports</>} />
      <div className="rp-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`rp-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {/* Both stay mounted so each report keeps its own date range while you switch tabs */}
      <div style={{ display: tab === 'ack' ? 'block' : 'none' }}><MilkAckReport /></div>
      <div style={{ display: tab === 'recon' ? 'block' : 'none' }}><ReconciliationReport /></div>
    </Page>
  );
}
