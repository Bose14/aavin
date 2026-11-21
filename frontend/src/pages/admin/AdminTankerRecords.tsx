import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../lib/api';
import {
  formatDateDDMMYYYY,
  formatFatSnf,
  formatLitres,
  triggerBlobDownload,
} from '../../lib/format';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { ErrorBanner, TableSkeleton } from '../../components/UiPrimitives';
import { TankerTimeline } from '../../components/TankerTimeline';
import { TankerDetailDrawer } from '../../components/TankerDetailDrawer';
import { StagePipeline } from '../../components/StagePipeline';
import { STAGE_COLORS } from '../../lib/tankerJourney';

interface Unit {
  id: string;
  name: string;
  bmc_code: string;
}

interface StatsResponse {
  chips: Record<string, { count: number; delayedCount: number; label: string; color: string }>;
  tabs: { waiting: number; processed: number; rejected: number; all: number };
  kpis: {
    total_dispatched_count: number;
    total_dispatched_litres: number;
    received_at_dairy_count: number;
    received_at_dairy_label: string;
    in_plant_count: number;
    waiting_too_long_count: number;
    qc_rejected_count: number;
    qc_rejected_litres: number;
    transit_loss_litres: number;
    transit_loss_pct: number;
    transit_loss_tone: 'green' | 'amber' | 'red';
    avg_turnaround_min: number | null;
  };
  time_limits?: Record<string, number>;
}

const LOCAL_STORAGE_KEY_FILTERS = 'aavin_admin_tanker_filters_v2';
const LOCAL_STORAGE_KEY_COLUMNS = 'aavin_admin_tanker_columns_v2';

const ALL_COLUMNS = [
  { id: 'date', label: 'Date / Entry' },
  { id: 'bmc', label: 'BMC' },
  { id: 'tanker', label: 'Tanker / Seal' },
  { id: 'driver', label: 'Driver' },
  { id: 'dispatched', label: 'Dispatched (L)' },
  { id: 'stage', label: 'Stage Badge' },
  { id: 'progress', label: '7-Dot Progress' },
  { id: 'waiting_on', label: 'Waiting On (Team)' },
  { id: 'waiting_since', label: 'Waiting Since' },
  { id: 'weights', label: 'Gross / Tare / Net' },
  { id: 'qc', label: 'QC (Fat/SNF)' },
  { id: 'received', label: 'Received (L)' },
  { id: 'transit_loss', label: 'Transit Loss' },
];

export default function AdminTankerRecords() {
  // Records and stats data
  const [records, setRecords] = useState<any[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [teamUserCounts, setTeamUserCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [autoRefreshIntervalSec] = useState<number>(30);

  // Filters (initialized from localStorage if available - default to 'all')
  const [activeTab, setActiveTab] = useState<'all' | 'waiting' | 'processed' | 'rejected'>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY_FILTERS);
      return saved ? JSON.parse(saved).tab || 'all' : 'all';
    } catch {
      return 'all';
    }
  });

  const [selectedStageChip, setSelectedStageChip] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY_FILTERS);
      return saved ? JSON.parse(saved).stage || '' : '';
    } catch {
      return '';
    }
  });

  const [selectedUnitId, setSelectedUnitId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY_FILTERS);
      return saved ? JSON.parse(saved).unitId || '' : '';
    } catch {
      return '';
    }
  });

  const [waitingTeamFilter, setWaitingTeamFilter] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY_FILTERS);
      return saved ? JSON.parse(saved).waitingTeam || '' : '';
    } catch {
      return '';
    }
  });

  const [delayedOnly, setDelayedOnly] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY_FILTERS);
      return saved ? Boolean(JSON.parse(saved).delayedOnly) : false;
    } catch {
      return false;
    }
  });

  const [fromDate, setFromDate] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY_FILTERS);
      return saved ? JSON.parse(saved).from || '' : '';
    } catch {
      return '';
    }
  });

  const [toDate, setToDate] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY_FILTERS);
      return saved ? JSON.parse(saved).to || '' : '';
    } catch {
      return '';
    }
  });

  const [searchQuery, setSearchQuery] = useState('');

  // Column visibility
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY_COLUMNS);
      if (saved) return JSON.parse(saved);
    } catch {}
    const initial: Record<string, boolean> = {};
    for (const c of ALL_COLUMNS) initial[c.id] = true;
    return initial;
  });
  const [showColumnChooser, setShowColumnChooser] = useState(false);

  // Drawer state
  const [selectedTrip, setSelectedTrip] = useState<any | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Persist filters to localStorage
  useEffect(() => {
    const filters = {
      tab: activeTab,
      stage: selectedStageChip,
      unitId: selectedUnitId,
      waitingTeam: waitingTeamFilter,
      delayedOnly,
      from: fromDate,
      to: toDate,
    };
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY_FILTERS, JSON.stringify(filters));
    } catch {}
  }, [activeTab, selectedStageChip, selectedUnitId, waitingTeamFilter, delayedOnly, fromDate, toDate]);

  // Persist columns to localStorage
  const toggleColumn = (id: string) => {
    const updated = { ...visibleColumns, [id]: !visibleColumns[id] };
    setVisibleColumns(updated);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY_COLUMNS, JSON.stringify(updated));
    } catch {}
  };

  const unitsLoadedRef = useRef(false);

  // Fetch Tanker Records and Stats
  const fetchData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError('');
      try {
        const params: Record<string, any> = {
          status: activeTab,
        };
        if (selectedStageChip) params.stage = selectedStageChip;
        if (selectedUnitId) params.bmc_id = selectedUnitId;
        if (waitingTeamFilter) params.waiting_team = waitingTeamFilter;
        if (delayedOnly) params.delayed_only = 'true';
        if (fromDate) params.from = fromDate;
        if (toDate) params.to = toDate;
        if (searchQuery.trim()) params.search = searchQuery.trim();

        const [tResSettled, sResSettled, uResSettled, teamsResSettled] = await Promise.allSettled([
          api.get<any[]>('/tanker', { params }),
          api.get<StatsResponse>('/tanker/stats', {
            params: {
              from: fromDate || undefined,
              to: toDate || undefined,
              bmc_id: selectedUnitId || undefined,
            },
          }),
          // BMC and team lists rarely change: load them once, not on every auto-refresh
          silent && unitsLoadedRef.current ? Promise.resolve(null) : api.get<Unit[]>('/bmcs'),
          silent && unitsLoadedRef.current ? Promise.resolve(null) : api.get<any[]>('/teams'),
        ]);

        if (tResSettled.status === 'fulfilled') {
          const data = tResSettled.value.data || [];
          setRecords(data);
          if (selectedTrip) {
            const fresh = data.find((r: any) => r.id === selectedTrip.id);
            if (fresh) setSelectedTrip(fresh);
          }
        } else {
          const reason =
            (tResSettled.reason as any)?.response?.data?.error ||
            (tResSettled.reason as any)?.message ||
            'Failed to fetch tanker records';
          setError(reason);
        }

        if (uResSettled.status === 'fulfilled' && uResSettled.value) {
          setUnits(uResSettled.value.data || []);
          unitsLoadedRef.current = true;
        }

        if (teamsResSettled.status === 'fulfilled' && teamsResSettled.value) {
          const counts: Record<string, number> = {};
          for (const tm of (teamsResSettled.value.data || [])) {
            counts[tm.code.toUpperCase()] = tm.active_user_count || 0;
            counts[tm.code.toLowerCase()] = tm.active_user_count || 0;
          }
          setTeamUserCounts(counts);
        }

        if (sResSettled.status === 'fulfilled') {
          setStats(sResSettled.value.data);
        } else if (tResSettled.status === 'fulfilled') {
          // Derive fallback stats locally from records if stats endpoint fails
          const list = tResSettled.value.data || [];
          const waitingCount = list.filter(
            (r: any) => r.journey?.tripStatus !== 'exited' && r.journey?.tripStatus !== 'qc_rejected',
          ).length;
          const processedCount = list.filter((r: any) => r.journey?.tripStatus === 'exited').length;
          const rejectedCount = list.filter((r: any) => r.journey?.tripStatus === 'qc_rejected').length;
          setStats({
            chips: {},
            tabs: { waiting: waitingCount, processed: processedCount, rejected: rejectedCount, all: list.length },
            kpis: {
              total_dispatched_count: list.length,
              total_dispatched_litres: list.reduce(
                (sum: number, r: any) => sum + (Number(r.quantity_dispatched) || 0),
                0,
              ),
              received_at_dairy_count: processedCount,
              received_at_dairy_label: `${processedCount} of ${list.length} tankers`,
              in_plant_count: list.filter(
                (r: any) =>
                  r.journey?.tripStatus !== 'on_the_way' &&
                  r.journey?.tripStatus !== 'exited' &&
                  r.journey?.tripStatus !== 'qc_rejected',
              ).length,
              waiting_too_long_count: list.filter((r: any) => r.journey?.isOverLimit).length,
              qc_rejected_count: rejectedCount,
              qc_rejected_litres: list
                .filter((r: any) => r.journey?.tripStatus === 'qc_rejected')
                .reduce((sum: number, r: any) => sum + (Number(r.quantity_dispatched) || 0), 0),
              transit_loss_litres: 0,
              transit_loss_pct: 0,
              transit_loss_tone: 'green',
              avg_turnaround_min: null,
            },
          });
        }

        setLastUpdated(new Date());
      } catch (err: any) {
        setError(err.response?.data?.error || err.message || 'Failed to fetch tanker data');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [activeTab, selectedStageChip, selectedUnitId, waitingTeamFilter, delayedOnly, fromDate, toDate, searchQuery, selectedTrip],
  );

  // Initial fetch
  useEffect(() => {
    void fetchData();
  }, [activeTab, selectedStageChip, selectedUnitId, waitingTeamFilter, delayedOnly, fromDate, toDate]);

  // Configurable Auto-Refresh (30-60s)
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) void fetchData(true);
    }, Math.max(10, autoRefreshIntervalSec) * 1000);
    return () => clearInterval(interval);
  }, [fetchData, autoRefreshIntervalSec]);

  // Handle stage chip click (clicking again toggles it off)
  const handleChipClick = (stageKey: string) => {
    if (selectedStageChip === stageKey) {
      setSelectedStageChip('');
    } else {
      setSelectedStageChip(stageKey);
    }
  };

  const handleOpenDrawer = (trip: any) => {
    setSelectedTrip(trip);
    setDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
    setSelectedTrip(null);
  };

  // Export handlers respecting active filters
  const exportParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (activeTab) p.status = activeTab;
    if (selectedStageChip) p.stage = selectedStageChip;
    if (selectedUnitId) p.bmc_id = selectedUnitId;
    if (waitingTeamFilter) p.waiting_team = waitingTeamFilter;
    if (delayedOnly) p.delayed_only = 'true';
    if (fromDate) p.from = fromDate;
    if (toDate) p.to = toDate;
    if (searchQuery.trim()) p.search = searchQuery.trim();
    return p;
  }, [activeTab, selectedStageChip, selectedUnitId, waitingTeamFilter, delayedOnly, fromDate, toDate, searchQuery]);

  const handleExport = (format: 'xlsx' | 'csv') => {
    const todayDDMM = formatDateDDMMYYYY(new Date().toISOString().slice(0, 10));
    const tabTitle = activeTab.charAt(0).toUpperCase() + activeTab.slice(1);
    const filename = `Tanker_Records_${tabTitle}_${todayDDMM}.${format}`;
    void triggerBlobDownload('/export/tanker', { ...exportParams, format }, filename);
  };

  const handleExportStageWise = () => {
    void triggerBlobDownload('/tanker/export/stage-wise', exportParams, `Tanker_Stage_Progression_${Date.now()}.csv`);
  };

  const handleExportDailyReport = () => {
    const todayDDMM = formatDateDDMMYYYY(new Date().toISOString().slice(0, 10));
    void triggerBlobDownload('/export/tanker/daily-report', exportParams, `Aavin_Daily_Tanker_Report_${todayDDMM}.xlsx`);
  };

  // Table Columns Definition
  const columns: DataColumn<any>[] = useMemo(() => {
    const cols: DataColumn<any>[] = [];

    if (visibleColumns.date) {
      cols.push({
        key: 'date',
        header: 'Date / Entry',
        sortValue: (r) => r.date,
        render: (r) => {
          const entryTime = r.journey?.timelineSteps?.[0]?.done_at;
          const stageBorderColor = r.journey?.isOverLimit
            ? '#ef4444'
            : r.journey?.tripStatus === 'qc_rejected'
            ? '#ef4444'
            : r.journey?.stageColor?.border || '#cbd5e1';

          return (
            <div style={{ borderLeft: `4px solid ${stageBorderColor}`, paddingLeft: '8px' }}>
              <div style={{ fontWeight: 600, color: '#1e293b' }}>{formatDateDDMMYYYY(r.date)}</div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>
                {entryTime ? `Entered: ${entryTime.slice(11, 16)}` : r.dispatch_time ? `Disp: ${r.dispatch_time}` : 'On the way'}
              </div>
            </div>
          );
        },
      });
    }

    if (visibleColumns.unit) {
      cols.push({
        key: 'bmc',
        header: 'BMC',
        sortValue: (r) => r.bmcs?.name || '',
        searchValue: (r) => `${r.bmcs?.name} ${r.bmcs?.bmc_code}`,
        render: (r) => (
          <div>
            <div style={{ fontWeight: 600 }}>{r.bmcs?.name || 'BMC'}</div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>{r.bmcs?.bmc_code || '—'}</div>
          </div>
        ),
      });
    }

    if (visibleColumns.tanker) {
      cols.push({
        key: 'tanker',
        header: 'Tanker / Seal',
        sortValue: (r) => r.tanker_number,
        searchValue: (r) => `${r.tanker_number} ${r.driver_name || ''} ${r.seal_number || ''} ${r.dc_number || r.stage_data?.dc_number || ''}`,
        render: (r) => {
          const dcNo = r.dc_number || r.stage_data?.dc_number || r.stage_data?.vehicle_entered?.dc_number;
          const comps = r.compartments || r.journey?.compartments || r.stage_data?.compartments;
          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{r.tanker_number}</span>
                {comps && comps.length > 0 && (
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      backgroundColor: '#dcfce7',
                      color: '#15803d',
                      padding: '1px 5px',
                      borderRadius: '4px',
                      border: '1px solid #bbf7d0',
                    }}
                    title={comps.map((c: any) => `${c.compartment_name || 'Comp'}: ${c.quantity_litres}L`).join(', ')}
                  >
                    {comps.length} Comp
                  </span>
                )}
              </div>
              {dcNo && (
                <div style={{ fontSize: '11px', color: '#0284c7', fontWeight: 600 }}>
                  DC #{dcNo}
                </div>
              )}
              <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>Seal: {r.seal_number || '—'}</span>
                {r.seal_number && <span title="Seal verified OK" style={{ color: '#16a34a' }}>✓</span>}
              </div>
            </div>
          );
        },
      });
    }

    if (visibleColumns.driver) {
      cols.push({
        key: 'driver',
        header: 'Driver',
        sortValue: (r) => r.driver_name || '',
        searchValue: (r) => r.driver_name || '',
        render: (r) => <span>{r.driver_name || '—'}</span>,
      });
    }

    if (visibleColumns.dispatched) {
      cols.push({
        key: 'dispatched',
        header: 'Dispatched (L)',
        align: 'right',
        sortValue: (r) => Number(r.quantity_dispatched || 0),
        render: (r) => <strong>{formatLitres(r.quantity_dispatched)}</strong>,
      });
    }

    if (visibleColumns.stage) {
      cols.push({
        key: 'stage',
        header: 'Stage',
        sortValue: (r) => r.journey?.tripStatus || '',
        render: (r) => {
          const color = r.journey?.stageColor || STAGE_COLORS.on_the_way;
          return (
            <span
              style={{
                display: 'inline-block',
                padding: '3px 8px',
                borderRadius: '12px',
                fontSize: '11px',
                fontWeight: 700,
                backgroundColor: color.badgeBg,
                color: color.badgeText,
                border: `1px solid ${color.border}`,
              }}
            >
              {r.journey?.tripStatusLabel}
            </span>
          );
        },
      });
    }

    if (visibleColumns.progress) {
      cols.push({
        key: 'progress',
        header: '7-Dot Progress',
        render: (r) => (
          <TankerTimeline
            journey={r.journey}
            variant="mini"
            onStepClick={() => handleOpenDrawer(r)}
          />
        ),
      });
    }

    if (visibleColumns.waiting_on) {
      cols.push({
        key: 'waiting_on',
        header: 'Waiting On',
        sortValue: (r) => r.journey?.waitingTeam || '',
        render: (r) => {
          const team = r.journey?.waitingTeam;
          if (!team || team === 'transit') {
            return <span style={{ color: '#64748b' }}>Transit</span>;
          }
          return (
            <span
              style={{
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 700,
                backgroundColor: '#f1f5f9',
                color: '#334155',
                textTransform: 'uppercase',
              }}
            >
              {r.journey?.waitingTeamLabel}
            </span>
          );
        },
      });
    }

    if (visibleColumns.waiting_since) {
      cols.push({
        key: 'waiting_since',
        header: 'Waiting Since',
        sortValue: (r) => r.journey?.waitingSinceMinutes ?? 0,
        render: (r) => {
          const mins = r.journey?.waitingSinceMinutes ?? 0;
          const isOver = r.journey?.isOverLimit;
          const isDone = r.journey?.tripStatus === 'exited' || r.journey?.tripStatus === 'qc_rejected';

          if (isDone) return <span style={{ color: '#16a34a' }}>Completed</span>;

          return (
            <span
              style={{
                fontWeight: 600,
                color: isOver ? '#dc2626' : mins > 20 ? '#d97706' : '#475569',
              }}
            >
              {mins} min
              {isOver && <span style={{ marginLeft: '4px', fontSize: '10px', color: '#dc2626' }}>⚠️</span>}
            </span>
          );
        },
      });
    }

    if (visibleColumns.weights) {
      cols.push({
        key: 'weights',
        header: 'Gross / Tare / Net (kg)',
        align: 'right',
        render: (r) => {
          const c = r.journey?.calculated;
          if (!c?.gross_weight_kg && !c?.tare_weight_kg) return <span style={{ color: '#94a3b8' }}>—</span>;
          return (
            <div style={{ fontSize: '12px' }}>
              <div>G: {c?.gross_weight_kg ? `${c.gross_weight_kg.toLocaleString('en-IN')}` : '—'}</div>
              <div>T: {c?.tare_weight_kg ? `${c.tare_weight_kg.toLocaleString('en-IN')}` : '—'}</div>
              {c?.net_weight_kg != null && (
                <div style={{ fontWeight: 700, color: '#0369a1' }}>
                  Net: {c.net_weight_kg.toLocaleString('en-IN')} kg
                </div>
              )}
            </div>
          );
        },
      });
    }

    if (visibleColumns.qc) {
      cols.push({
        key: 'qc',
        header: 'QC (Fat / SNF)',
        render: (r) => {
          const isRej = r.journey?.isQcRejected;
          if (isRej) {
            return (
              <span style={{ color: '#dc2626', fontWeight: 700 }}>
                REJECTED
              </span>
            );
          }
          if (r.received_fat_pct != null || r.dispatch_fat_pct != null) {
            return (
              <div style={{ fontSize: '12px' }}>
                <div>Fat: {formatFatSnf(r.received_fat_pct ?? r.dispatch_fat_pct)}</div>
                <div>SNF: {formatFatSnf(r.received_snf_pct ?? r.dispatch_snf_pct)}</div>
              </div>
            );
          }
          return <span style={{ color: '#94a3b8' }}>Pending</span>;
        },
      });
    }

    if (visibleColumns.received) {
      cols.push({
        key: 'received',
        header: 'Received (L)',
        align: 'right',
        sortValue: (r) => Number(r.journey?.calculated?.received_litres ?? 0),
        render: (r) => {
          const rec = r.journey?.calculated?.received_litres;
          return rec != null ? <strong>{formatLitres(rec)}</strong> : <span style={{ color: '#94a3b8' }}>—</span>;
        },
      });
    }

    if (visibleColumns.transit_loss) {
      cols.push({
        key: 'transit_loss',
        header: 'Transit Loss',
        align: 'right',
        sortValue: (r) => Number(r.journey?.calculated?.transit_loss_litres ?? 0),
        render: (r) => {
          const loss = r.journey?.calculated?.transit_loss_litres;
          const lossPct = r.journey?.calculated?.transit_loss_pct;
          if (loss == null) return <span style={{ color: '#94a3b8' }}>—</span>;

          const isHigh = (lossPct ?? 0) > 1.0;
          return (
            <span style={{ color: isHigh ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
              {formatLitres(loss)} ({lossPct}%)
            </span>
          );
        },
      });
    }

    return cols;
  }, [visibleColumns]);

  return (
    <div className="page" style={{ maxWidth: '100%' }}>
      {/* Page Title & Auto-refresh header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ margin: 0 }}>Tanker Journey &amp; Plant Operations</h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            Last updated: <strong>{lastUpdated.toLocaleTimeString()}</strong>
          </span>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void fetchData()} />}

      {/* 1. STAGE PIPELINE STRIP (top of page overview filter - connected stepper design) */}
      <StagePipeline
        chips={stats?.chips || {}}
        selectedStage={selectedStageChip}
        onSelectStage={(key) => handleChipClick(key)}
        inPlantCount={stats?.kpis?.in_plant_count ?? 0}
        waitingTooLongCount={stats?.kpis?.waiting_too_long_count ?? 0}
        qcRejectedCount={stats?.kpis?.qc_rejected_count ?? 0}
        totalTankersCount={stats?.kpis?.total_dispatched_count ?? records.length}
        teamUserCounts={teamUserCounts}
      />

      {/* 3. TABS WITH COUNTS */}
      <div
        className="tabs-header"
        style={{
          display: 'flex',
          borderBottom: '2px solid #e2e8f0',
          marginBottom: '16px',
          gap: '8px',
        }}
      >
        <button
          onClick={() => setActiveTab('all')}
          style={{
            padding: '10px 18px',
            border: 'none',
            background: 'none',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            color: activeTab === 'all' ? '#2563eb' : '#64748b',
            borderBottom: activeTab === 'all' ? '3px solid #2563eb' : '3px solid transparent',
          }}
        >
          All ({stats?.tabs.all ?? 0})
        </button>

        <button
          onClick={() => setActiveTab('waiting')}
          style={{
            padding: '10px 18px',
            border: 'none',
            background: 'none',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            color: activeTab === 'waiting' ? '#2563eb' : '#64748b',
            borderBottom: activeTab === 'waiting' ? '3px solid #2563eb' : '3px solid transparent',
          }}
        >
          Waiting ({stats?.tabs.waiting ?? 0})
        </button>

        <button
          onClick={() => setActiveTab('processed')}
          style={{
            padding: '10px 18px',
            border: 'none',
            background: 'none',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            color: activeTab === 'processed' ? '#2563eb' : '#64748b',
            borderBottom: activeTab === 'processed' ? '3px solid #2563eb' : '3px solid transparent',
          }}
        >
          Processed ({stats?.tabs.processed ?? 0})
        </button>

        <button
          onClick={() => setActiveTab('rejected')}
          style={{
            padding: '10px 18px',
            border: 'none',
            background: 'none',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            color: activeTab === 'rejected' ? '#2563eb' : '#64748b',
            borderBottom: activeTab === 'rejected' ? '3px solid #2563eb' : '3px solid transparent',
          }}
        >
          QC Rejected ({stats?.tabs.rejected ?? 0})
        </button>
      </div>

      {/* 5. FILTERS & SEARCH TOOLBAR */}
      <div
        className="filter-bar card"
        style={{
          padding: '12px 16px',
          marginBottom: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
        }}
      >
        {/* Top Controls Row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          {/* Search */}
          <div style={{ flex: '1 1 240px', minWidth: '200px' }}>
            <input
              type="search"
              placeholder="🔍 Search tanker, seal, driver, gate pass..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', height: '36px', padding: '0 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
            />
          </div>

          {/* BMC Filter */}
          <select
            value={selectedUnitId}
            onChange={(e) => setSelectedUnitId(e.target.value)}
            style={{ height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', backgroundColor: '#ffffff' }}
          >
            <option value="">All BMCs</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.bmc_code})
              </option>
            ))}
          </select>

          {/* Waiting Team Filter */}
          <select
            value={waitingTeamFilter}
            onChange={(e) => setWaitingTeamFilter(e.target.value)}
            style={{ height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', backgroundColor: '#ffffff' }}
          >
            <option value="">All Teams</option>
            <option value="gate">Gate</option>
            <option value="qc">QC</option>
            <option value="unloading">Unloading</option>
            <option value="transit">Transit</option>
          </select>

          {/* Delayed Only Checkbox */}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
            <input
              type="checkbox"
              checked={delayedOnly}
              onChange={(e) => setDelayedOnly(e.target.checked)}
            />
            <span style={{ color: delayedOnly ? '#dc2626' : '#334155', fontWeight: delayedOnly ? 700 : 500 }}>
              Delayed Only
            </span>
          </label>

          {/* Date Range */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '36px' }}>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={{ height: '36px', padding: '0 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px' }}
            />
            <span style={{ color: '#64748b', fontSize: '12px' }}>to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              style={{ height: '36px', padding: '0 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px' }}
            />
          </div>
        </div>

        {/* Action Buttons Toolbar Row */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
          <button
            type="button"
            onClick={handleExportDailyReport}
            className="btn btn-primary btn-sm"
            style={{
              height: '34px',
              fontSize: '12px',
              padding: '0 12px',
              backgroundColor: '#0284c7',
              borderColor: '#0369a1',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              width: 'auto',
            }}
            title="Download official Aavin IDMS Daily Milk & Tanker Reception Excel Report"
          >
            📊 Daily Reception Report (.xlsx)
          </button>
          <button
            type="button"
            onClick={() => setShowColumnChooser(!showColumnChooser)}
            className="btn btn-secondary btn-sm"
            style={{ height: '34px', fontSize: '12px', padding: '0 10px', width: 'auto' }}
          >
            ⚙️ Columns
          </button>
          <button
            type="button"
            onClick={() => handleExport('xlsx')}
            className="btn btn-secondary btn-sm"
            style={{ height: '34px', fontSize: '12px', padding: '0 10px', width: 'auto' }}
          >
            Excel
          </button>
          <button
            type="button"
            onClick={() => handleExport('csv')}
            className="btn btn-secondary btn-sm"
            style={{ height: '34px', fontSize: '12px', padding: '0 10px', width: 'auto' }}
          >
            CSV
          </button>
          <button
            type="button"
            onClick={handleExportStageWise}
            className="btn btn-secondary btn-sm"
            style={{ height: '34px', fontSize: '12px', padding: '0 10px', width: 'auto' }}
            title="Export complete stage-by-stage timestamps and users"
          >
            Stage Report
          </button>
        </div>
      </div>

      {/* Column Chooser Popover */}
      {showColumnChooser && (
        <div
          className="card"
          style={{
            padding: '12px 16px',
            marginBottom: '16px',
            backgroundColor: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px', color: '#1e293b' }}>
            Show / Hide Table Columns:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {ALL_COLUMNS.map((col) => (
              <label key={col.id} style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  type="checkbox"
                  checked={visibleColumns[col.id] ?? true}
                  onChange={() => toggleColumn(col.id)}
                />
                {col.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* 4. MAIN TANKER TABLE */}
      {loading ? (
        <TableSkeleton rows={8} cols={9} />
      ) : records.length === 0 ? (
        <div className="card" style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: '28px', marginBottom: '8px' }}>🥛</div>
          <h3 style={{ margin: '0 0 6px 0', fontSize: '16px', color: '#1e293b' }}>
            {activeTab === 'waiting'
              ? 'No tankers waiting. All caught up!'
              : activeTab === 'processed'
              ? 'No processed tankers found for the selected period.'
              : activeTab === 'rejected'
              ? 'No rejected tankers. Quality checks clean!'
              : 'No tanker records found.'}
          </h3>
          <p style={{ margin: 0, fontSize: '13px' }}>
            Try clearing filters or check back when new tanker dispatches are initiated.
          </p>
        </div>
      ) : (
        <div className="table-responsive">
          <DataTable
            rows={records}
            columns={columns}
            getRowKey={(r) => r.id}
            searchable={false}
            pageSize={20}
            onRowClick={handleOpenDrawer}
          />
        </div>
      )}

      {/* PART B: ROW DETAIL DRAWER */}
      <TankerDetailDrawer
        isOpen={drawerOpen}
        onClose={handleCloseDrawer}
        trip={selectedTrip}
        onTripUpdated={() => void fetchData()}
        isAdmin={true}
      />
    </div>
  );
}
