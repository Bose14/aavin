import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useDairyUnitSettings } from '../../hooks/useDairyUnitSettings';
import {
  formatDateDDMMYYYY,
  formatDateTimeDDMMYYYY,
  formatFatSnf,
  formatLitres,
  triggerBlobDownload,
} from '../../lib/format';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import {
  ErrorBanner,
  TableSkeleton,
} from '../../components/UiPrimitives';

export default function UnitRecords() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { settings } = useDairyUnitSettings();

  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [from, setFrom] = useState(() => searchParams.get('from') || '');
  const [to, setTo] = useState(() => searchParams.get('to') || '');
  const [statusTab, setStatusTab] = useState<'all' | 'transit' | 'inside_plant' | 'completed' | 'rejected'>(
    () => (searchParams.get('status') as any) || 'all',
  );


  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = { status: 'all' };
      if (from) params.from = from;
      if (to) params.to = to;
      const res = await api.get<any[]>('/tanker', { params });
      setRecords(res.data || []);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load tanker records');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  // Tab counts
  const tabCounts = useMemo(() => {
    let transit = 0;
    let inside_plant = 0;
    let completed = 0;
    let rejected = 0;

    for (const r of records) {
      const j = r.journey;
      const tripStatus = j?.tripStatus || r.trip_status;
      const isRej = j?.isQcRejected || r.qc_status === 'rejected';

      if (isRej) {
        rejected++;
      } else if (tripStatus === 'exited') {
        completed++;
      } else if (tripStatus === 'on_the_way') {
        transit++;
      } else {
        inside_plant++;
      }
    }

    return {
      all: records.length,
      transit,
      inside_plant,
      completed,
      rejected,
    };
  }, [records]);

  // Filtered records
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      const j = r.journey;
      const tripStatus = j?.tripStatus || r.trip_status;
      const isRej = j?.isQcRejected || r.qc_status === 'rejected';

      // Status tab filter
      if (statusTab === 'transit' && (isRej || tripStatus !== 'on_the_way')) return false;
      if (statusTab === 'inside_plant' && (isRej || tripStatus === 'on_the_way' || tripStatus === 'exited')) return false;
      if (statusTab === 'completed' && (isRej || tripStatus !== 'exited')) return false;
      if (statusTab === 'rejected' && !isRej) return false;

      // Text search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const tankerNo = (r.tanker_number || '').toLowerCase();
        const dcNo = (r.dc_number || r.stage_data?.dc_number || r.stage_data?.vehicle_entered?.dc_number || '').toLowerCase();
        const driver = (r.driver_name || '').toLowerCase();
        const dest = (r.destination || '').toLowerCase();
        const seal = (r.seal_number || '').toLowerCase();

        const match =
          tankerNo.includes(q) ||
          dcNo.includes(q) ||
          driver.includes(q) ||
          dest.includes(q) ||
          seal.includes(q);

        if (!match) return false;
      }

      return true;
    });
  }, [records, statusTab, searchQuery]);

  // Totals summary across filtered records
  const totals = useMemo(() => {
    let dispatchedLitres = 0;
    let receivedLitres = 0;
    let lossLitres = 0;
    let completedCount = 0;
    let rejectedCount = 0;
    let totalTurnaroundMins = 0;
    let turnaroundCount = 0;

    for (const r of filteredRecords) {
      const j = r.journey;
      const calc = j?.calculated;
      const disp = Number(r.quantity_dispatched) || 0;
      dispatchedLitres += disp;

      const rec = Number(r.received_qty) || calc?.received_litres || 0;
      if (rec > 0) {
        receivedLitres += rec;
      }

      if (calc?.transit_loss_litres != null && calc.transit_loss_litres > 0) {
        lossLitres += calc.transit_loss_litres;
      }

      const isRej = j?.isQcRejected || r.qc_status === 'rejected';
      if (isRej) {
        rejectedCount++;
      } else if (j?.tripStatus === 'exited' || r.trip_status === 'exited') {
        completedCount++;
      }

      if (calc?.turnaround_minutes != null && calc.turnaround_minutes > 0) {
        totalTurnaroundMins += calc.turnaround_minutes;
        turnaroundCount++;
      }
    }

    const lossPct = dispatchedLitres > 0 ? (lossLitres / dispatchedLitres) * 100 : 0;
    const totalFinished = completedCount + rejectedCount;
    const qcAcceptanceRate = totalFinished > 0 ? ((completedCount / totalFinished) * 100).toFixed(1) : '100.0';
    const avgTurnaround = turnaroundCount > 0 ? Math.round(totalTurnaroundMins / turnaroundCount) : null;

    return {
      dispatchedLitres,
      receivedLitres,
      lossLitres,
      lossPct,
      qcAcceptanceRate,
      avgTurnaround,
    };
  }, [filteredRecords]);

  const formatDuration = (mins: number | null | undefined) => {
    if (mins == null) return 'N/A';
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  };

  const handleExport = async (format: 'xlsx' | 'csv') => {
    try {
      await triggerBlobDownload(
        '/export/tanker',
        {
          from,
          to,
          format,
        },
        `${profile?.bmcs?.bmc_code || 'BMC'}_tanker_records.${format}`,
      );
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Export failed');
    }
  };

  // DataTable columns
  const columns: DataColumn<any>[] = [
    {
      key: 'date',
      header: 'Date & Time',
      sortValue: (r) => r.created_at || r.date,
      render: (r) => (
        <span style={{ fontSize: '0.82rem', color: '#475569' }}>
          {r.created_at ? formatDateTimeDDMMYYYY(r.created_at) : formatDateDDMMYYYY(r.date)}
        </span>
      ),
      footerCell: <strong>Total ({filteredRecords.length})</strong>,
    },
    {
      key: 'tanker_number',
      header: 'Tanker / Lorry',
      sortValue: (r) => r.tanker_number,
      render: (r) => {
        const comps = r.compartments || r.journey?.compartments || r.stage_data?.compartments || [];
        const compCount = comps.length > 0 ? comps.length : 1;
        return (
          <div>
            <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.88rem' }}>
              {r.tanker_number}
            </div>
            <span
              style={{
                display: 'inline-block',
                marginTop: 2,
                fontSize: '0.7rem',
                fontWeight: 700,
                backgroundColor: '#f1f5f9',
                color: '#475569',
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              {compCount} {compCount === 1 ? 'Comp' : 'Comps'}
            </span>
          </div>
        );
      },
    },
    {
      key: 'dc_number',
      header: 'DC & Seal No',
      sortValue: (r) => r.dc_number || r.stage_data?.dc_number || '',
      render: (r) => {
        const dc = r.dc_number || r.stage_data?.dc_number || r.stage_data?.vehicle_entered?.dc_number || '—';
        const seal = r.seal_number || r.stage_data?.vehicle_entered?.seal_number;
        return (
          <div>
            <div style={{ fontWeight: 700, color: '#0284c7', fontSize: '0.85rem' }}>
              #{dc}
            </div>
            {seal && (
              <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 1 }}>
                Seal: {seal}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'driver',
      header: 'Driver & Destination',
      sortValue: (r) => r.driver_name || '',
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.84rem' }}>
            {r.driver_name || 'Driver'}
          </div>
          <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
            {r.destination || 'Namakkal Dairy'}
          </div>
        </div>
      ),
    },
    {
      key: 'dispatched_qty',
      header: 'Dispatched (L)',
      sortValue: (r) => Number(r.quantity_dispatched) || 0,
      render: (r) => (
        <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.88rem' }}>
          {formatLitres(r.quantity_dispatched, 1)}
        </span>
      ),
      footerCell: <strong>{formatLitres(totals.dispatchedLitres, 1)}</strong>,
    },
    {
      key: 'quality',
      header: 'Fat / SNF',
      sortValue: (r) => Number(r.dispatch_fat_pct) || 0,
      render: (r) => {
        const fat = r.dispatch_fat_pct != null ? formatFatSnf(r.dispatch_fat_pct) : '—';
        const snf = r.dispatch_snf_pct != null ? formatFatSnf(r.dispatch_snf_pct) : '—';
        return (
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155' }}>
            {fat}% / {snf}%
          </span>
        );
      },
    },
    {
      key: 'plant_stage',
      header: 'Plant Journey Stage',
      sortValue: (r) => r.journey?.tripStatusLabel || '',
      render: (r) => {
        const j = r.journey;
        const isRej = j?.isQcRejected || r.qc_status === 'rejected';

        if (isRej) {
          return (
            <span
              style={{
                backgroundColor: '#fee2e2',
                color: '#991b1b',
                border: '1px solid #fecaca',
                padding: '3px 8px',
                borderRadius: 5,
                fontWeight: 800,
                fontSize: '0.74rem',
                letterSpacing: '0.02em',
              }}
            >
              QC REJECTED
            </span>
          );
        }

        return (
          <span
            style={{
              backgroundColor: j?.stageColor?.badgeBg || '#e0f2fe',
              color: j?.stageColor?.badgeText || '#0369a1',
              border: `1px solid ${j?.stageColor?.border || '#bae6fd'}`,
              padding: '3px 8px',
              borderRadius: 5,
              fontWeight: 700,
              fontSize: '0.74rem',
            }}
          >
            {j?.tripStatusLabel || 'Dispatched'}
          </span>
        );
      },
    },
    {
      key: 'gross_tare',
      header: 'Gross / Tare (kg)',
      sortValue: (r) => Number(r.gross_weight_kg) || 0,
      render: (r) => {
        const gross = r.gross_weight_kg != null ? `${Number(r.gross_weight_kg).toLocaleString('en-IN')} kg` : '—';
        const tare = r.tare_weight_kg != null ? `${Number(r.tare_weight_kg).toLocaleString('en-IN')} kg` : '—';
        return (
          <div style={{ fontSize: '0.78rem', color: '#475569' }}>
            <span>G: <strong>{gross}</strong></span>
            <br />
            <span>T: <strong>{tare}</strong></span>
          </div>
        );
      },
    },
    {
      key: 'received_qty',
      header: 'Silo Received',
      sortValue: (r) => Number(r.received_qty) || 0,
      render: (r) => {
        const j = r.journey;
        const calc = j?.calculated;
        const rec = r.received_qty != null ? r.received_qty : calc?.received_litres;
        return (
          <span style={{ fontWeight: 700, color: rec ? '#047857' : '#94a3b8', fontSize: '0.86rem' }}>
            {rec ? formatLitres(rec, 1) : '—'}
          </span>
        );
      },
      footerCell: <strong style={{ color: '#047857' }}>{formatLitres(totals.receivedLitres, 1)}</strong>,
    },
    {
      key: 'transit_loss',
      header: 'Transit Loss',
      sortValue: (r) => r.journey?.calculated?.transit_loss_litres ?? 0,
      render: (r) => {
        const calc = r.journey?.calculated;
        if (!calc || calc.transit_loss_litres == null) {
          return <span style={{ color: '#94a3b8' }}>—</span>;
        }

        const isHigh = calc.transit_loss_pct >= (settings.transit_loss_danger_pct || 0.8);
        const isWarn = calc.transit_loss_pct >= (settings.transit_loss_warn_pct || 0.5);

        return (
          <div>
            <span
              style={{
                fontWeight: 700,
                color: isHigh ? '#dc2626' : isWarn ? '#d97706' : '#166534',
                fontSize: '0.84rem',
              }}
            >
              {calc.transit_loss_litres > 0 ? `-${formatLitres(calc.transit_loss_litres, 1)}` : '0.0 L'}
            </span>
            <div style={{ fontSize: '0.72rem', color: isHigh ? '#dc2626' : '#64748b' }}>
              ({calc.transit_loss_pct?.toFixed(2)}%)
            </div>
          </div>
        );
      },
      footerCell: (
        <strong style={{ color: totals.lossPct >= 0.5 ? '#dc2626' : '#475569' }}>
          {totals.lossLitres > 0 ? `-${formatLitres(totals.lossLitres, 1)}` : '0.0 L'} ({totals.lossPct.toFixed(2)}%)
        </strong>
      ),
    },
    {
      key: 'qc_status',
      header: 'QC Result',
      sortValue: (r) => (r.journey?.isQcRejected || r.qc_status === 'rejected' ? 'rejected' : 'accepted'),
      render: (r) => {
        const j = r.journey;
        const isRej = j?.isQcRejected || r.qc_status === 'rejected';
        const reason = j?.qcRejectionReason || r.qc_rejection_reason || r.stage_data?.qc_test?.rejection_reason;

        if (isRej) {
          return (
            <div>
              <span style={{ color: '#dc2626', fontWeight: 800, fontSize: '0.78rem' }}>Rejected</span>
              {reason && (
                <div style={{ fontSize: '0.7rem', color: '#991b1b', maxWidth: 140, lineHeight: 1.2 }}>
                  {reason}
                </div>
              )}
            </div>
          );
        }

        // Check if QC is completed
        const qcDone = j?.timelineSteps?.some((s: any) => s.key === 'qc_passed' && s.status === 'done');
        if (qcDone) {
          return <span style={{ color: '#16a34a', fontWeight: 700, fontSize: '0.8rem' }}>Accepted</span>;
        }

        return <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Pending QC</span>;
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ fontSize: '0.75rem', height: '28px', padding: '0 10px', width: 'auto' }}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/bmc/records/${r.id}`);
          }}
        >
          View Dossier
        </button>
      ),
    },
  ];

  return (
    <div className="page">
      {/* Top Header */}
      <div className="page-header" style={{ marginBottom: '1.25rem', paddingBottom: '0.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: '#0f172a' }}>
            {profile?.bmcs ? `${profile.bmcs.name} · ${profile.bmcs.bmc_code} — ` : ''}
            My Tanker Process Records
          </h1>
        </div>

        {/* Action button */}
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => navigate('/bmc/tanker')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '34px', padding: '0 14px' }}
          >
            <span>+</span> Dispatch Tanker
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchRecords} />}

      {/* Status Filter Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '2px solid #e2e8f0',
          marginBottom: '1rem',
          gap: '8px',
          overflowX: 'auto',
        }}
      >
        <button
          type="button"
          onClick={() => setStatusTab('all')}
          style={{
            padding: '8px 14px',
            border: 'none',
            background: 'none',
            fontSize: '0.88rem',
            fontWeight: 700,
            cursor: 'pointer',
            color: statusTab === 'all' ? '#0284c7' : '#64748b',
            borderBottom: statusTab === 'all' ? '3px solid #0284c7' : '3px solid transparent',
          }}
        >
          All Journeys ({tabCounts.all})
        </button>

        <button
          type="button"
          onClick={() => setStatusTab('transit')}
          style={{
            padding: '8px 14px',
            border: 'none',
            background: 'none',
            fontSize: '0.88rem',
            fontWeight: 700,
            cursor: 'pointer',
            color: statusTab === 'transit' ? '#0284c7' : '#64748b',
            borderBottom: statusTab === 'transit' ? '3px solid #0284c7' : '3px solid transparent',
          }}
        >
          On the Way ({tabCounts.transit})
        </button>

        <button
          type="button"
          onClick={() => setStatusTab('inside_plant')}
          style={{
            padding: '8px 14px',
            border: 'none',
            background: 'none',
            fontSize: '0.88rem',
            fontWeight: 700,
            cursor: 'pointer',
            color: statusTab === 'inside_plant' ? '#0284c7' : '#64748b',
            borderBottom: statusTab === 'inside_plant' ? '3px solid #0284c7' : '3px solid transparent',
          }}
        >
          Inside Plant ({tabCounts.inside_plant})
        </button>

        <button
          type="button"
          onClick={() => setStatusTab('completed')}
          style={{
            padding: '8px 14px',
            border: 'none',
            background: 'none',
            fontSize: '0.88rem',
            fontWeight: 700,
            cursor: 'pointer',
            color: statusTab === 'completed' ? '#0284c7' : '#64748b',
            borderBottom: statusTab === 'completed' ? '3px solid #0284c7' : '3px solid transparent',
          }}
        >
          Completed ({tabCounts.completed})
        </button>

        <button
          type="button"
          onClick={() => setStatusTab('rejected')}
          style={{
            padding: '8px 14px',
            border: 'none',
            background: 'none',
            fontSize: '0.88rem',
            fontWeight: 700,
            cursor: 'pointer',
            color: statusTab === 'rejected' ? '#dc2626' : '#64748b',
            borderBottom: statusTab === 'rejected' ? '3px solid #dc2626' : '3px solid transparent',
          }}
        >
          QC Rejected ({tabCounts.rejected})
        </button>
      </div>

      {/* Filter Toolbar */}
      <div
        className="card"
        style={{
          padding: '12px 16px',
          marginBottom: '1rem',
          backgroundColor: '#ffffff',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', flex: 1 }}>
          <input
            type="search"
            placeholder="🔍 Search tanker, DC, driver, destination..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ minWidth: 240, height: 34, padding: '0 12px', fontSize: '0.82rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>From:</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              style={{ height: 34, fontSize: '0.8rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>To:</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              style={{ height: 34, fontSize: '0.8rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => void handleExport('xlsx')}
            className="btn btn-secondary btn-sm"
            style={{ height: 34, fontSize: '0.8rem', padding: '0 12px' }}
          >
            Excel
          </button>
          <button
            type="button"
            onClick={() => void handleExport('csv')}
            className="btn btn-secondary btn-sm"
            style={{ height: 34, fontSize: '0.8rem', padding: '0 12px' }}
          >
            CSV
          </button>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={6} cols={9} />
      ) : (
        <div className="card table-card" style={{ borderRadius: 10, border: '1px solid #e2e8f0' }}>
          {/* Summary Strip */}
          <div className="table-summary-strip" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '0.82rem' }}>
            <span>Journeys: <strong>{filteredRecords.length}</strong></span>
            <span>Dispatched: <strong>{formatLitres(totals.dispatchedLitres, 1)}</strong></span>
            <span>Received: <strong style={{ color: '#047857' }}>{formatLitres(totals.receivedLitres, 1)}</strong></span>
            <span>
              Net Loss:{' '}
              <strong style={{ color: totals.lossPct >= 0.5 ? '#dc2626' : '#475569' }}>
                {totals.lossLitres > 0 ? `-${formatLitres(totals.lossLitres, 1)}` : '0.0 L'} ({totals.lossPct.toFixed(2)}%)
              </strong>
            </span>
            <span>QC Acceptance: <strong>{totals.qcAcceptanceRate}%</strong></span>
            {totals.avgTurnaround != null && (
              <span>Avg Turnaround: <strong>{formatDuration(totals.avgTurnaround)}</strong></span>
            )}
          </div>

          <DataTable
            rows={filteredRecords}
            columns={columns}
            getRowKey={(r) => r.id}
            getRowClassName={(r) => {
              const isRej = r.journey?.isQcRejected || r.qc_status === 'rejected';
              return isRej ? 'row-danger' : '';
            }}
            emptyMessage="No tanker process records found for the selected filter."
            emptyActionLabel="Dispatch Tanker"
            onEmptyAction={() => navigate('/bmc/tanker')}
            showTotalsRow
          />
        </div>
      )}

    </div>
  );
}
