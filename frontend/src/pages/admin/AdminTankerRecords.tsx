import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TankerDetailsModal from '../../components/TankerDetailsModal';
import api from '../../lib/api';
import { cachedGet, STALE } from '../../lib/cachedGet';
import {
  formatDateDDMMYYYY,
  formatFatSnf,
  formatLitres,
  triggerBlobDownload,
} from '../../lib/format';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { ErrorBanner } from '../../components/UiPrimitives';
import { TankerTimeline } from '../../components/TankerTimeline';
import { TankerDetailDrawer } from '../../components/TankerDetailDrawer';
import { StagePipeline } from '../../components/StagePipeline';
import { STAGE_COLORS } from '../../lib/tankerJourney';
import { Page, PageHeader } from '../../components/PageLayout';

interface Unit {
  id: string;
  name: string;
  bmc_code: string;
}

interface StatsResponse {
  team_user_counts?: Record<string, number>;
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

type DatePreset = 'all' | 'today' | 'yesterday' | 'this_week' | 'last_week' | 'last_month' | 'custom';
const ymd = (d: Date) => d.toLocaleDateString('en-CA'); // local yyyy-mm-dd

// Date ranges for the quick report filters (local time). This week = Monday to today; last week = previous Mon–Sun; last month = previous calendar month.
function ackRange(preset: Exclude<DatePreset, 'custom'>): { from: string; to: string } {
  if (preset === 'all') return { from: '', to: '' };
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const shift = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  if (preset === 'today') return { from: ymd(day), to: ymd(day) };
  if (preset === 'yesterday') return { from: ymd(shift(day, -1)), to: ymd(shift(day, -1)) };
  if (preset === 'this_week') {
    const sinceMonday = (day.getDay() + 6) % 7;
    return { from: ymd(shift(day, -sinceMonday)), to: ymd(day) };
  }
  if (preset === 'last_week') {
    const sinceMonday = (day.getDay() + 6) % 7;
    const thisMonday = shift(day, -sinceMonday);
    return { from: ymd(shift(thisMonday, -7)), to: ymd(shift(thisMonday, -1)) };
  }
  return {
    from: ymd(new Date(day.getFullYear(), day.getMonth() - 1, 1)),
    to: ymd(new Date(day.getFullYear(), day.getMonth(), 0)),
  };
}

export default function AdminTankerRecords() {
  const [detailTripId, setDetailTripId] = useState<string | null>(null);
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

  // One date filter drives both the table and the Milk ACK report. Default is today; only a custom range is remembered.
  const [datePreset, setDatePreset] = useState<DatePreset>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY_FILTERS) || '{}');
      if (saved.preset === 'custom' && saved.from && saved.to) return 'custom';
      if (['all', 'yesterday', 'this_week', 'last_week', 'last_month'].includes(saved.preset)) return saved.preset;
    } catch {}
    return 'today';
  });
  const [customFrom, setCustomFrom] = useState<string>(() => {
    try { return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY_FILTERS) || '{}').from || ymd(new Date()); } catch { return ymd(new Date()); }
  });
  const [customTo, setCustomTo] = useState<string>(() => {
    try { return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY_FILTERS) || '{}').to || ymd(new Date()); } catch { return ymd(new Date()); }
  });
  const { from: fromDate, to: toDate } = datePreset === 'custom' ? { from: customFrom, to: customTo } : ackRange(datePreset);

  const [searchQuery, setSearchQuery] = useState('');

  // Column visibility
  const [visibleColumns] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY_COLUMNS);
      if (saved) return JSON.parse(saved);
    } catch {}
    const initial: Record<string, boolean> = {};
    for (const c of ALL_COLUMNS) initial[c.id] = true;
    return initial;
  });
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
      preset: datePreset,
      from: customFrom,
      to: customTo,
    };
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY_FILTERS, JSON.stringify(filters));
    } catch {}
  }, [activeTab, selectedStageChip, selectedUnitId, waitingTeamFilter, fromDate, toDate]);

  const unitsLoadedRef = useRef(false);

  // BMC list is only needed by the BMC filter: fetch it when the filter is first used
  // (or at start if a saved BMC filter has to show its name).
  const loadUnits = useCallback(async () => {
    if (unitsLoadedRef.current) return;
    unitsLoadedRef.current = true;
    try {
      const res = await cachedGet<Unit[]>('/bmcs', undefined, STALE.reference);
      setUnits(res.data || []);
    } catch {
      unitsLoadedRef.current = false;
    }
  }, []);

  useEffect(() => {
    void loadUnits();
  }, [loadUnits]);

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
        if (fromDate) params.from = fromDate;
        if (toDate) params.to = toDate;
        if (searchQuery.trim()) params.search = searchQuery.trim();

        const [tResSettled, sResSettled] = await Promise.allSettled([
          api.get<any[]>('/tanker', { params }),
          api.get<StatsResponse>('/tanker/stats', {
            params: {
              from: fromDate || undefined,
              to: toDate || undefined,
              bmc_id: selectedUnitId || undefined,
            },
          }),
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

        if (sResSettled.status === 'fulfilled') {
          setStats(sResSettled.value.data);
          const counts: Record<string, number> = {};
          for (const [code, n] of Object.entries(sResSettled.value.data?.team_user_counts || {})) {
            counts[code.toUpperCase()] = Number(n) || 0;
            counts[code.toLowerCase()] = Number(n) || 0;
          }
          setTeamUserCounts(counts);
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
    [activeTab, selectedStageChip, selectedUnitId, waitingTeamFilter, fromDate, toDate, searchQuery, selectedTrip],
  );

  // Initial fetch
  useEffect(() => {
    void fetchData();
  }, [activeTab, selectedStageChip, selectedUnitId, waitingTeamFilter, fromDate, toDate]);

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
    setDetailTripId(String(trip.id));
  };

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
    setSelectedTrip(null);
  };

  // Export handlers respecting active filters

  // Milk ACK report for the chosen date range only
  const handleExportMilkAck = () => {
    if (!fromDate || !toDate || fromDate > toDate) return;
    void triggerBlobDownload('/export/milk-ack', { from: fromDate, to: toDate, format: 'xlsx' }, `Milk_ACK_${fromDate}_to_${toDate}.xlsx`);
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
                <div style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: 600 }}>
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
                <div style={{ fontWeight: 700, color: 'var(--primary-dark)' }}>
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
    <Page>
      {/* Page Title & Auto-refresh header */}
      <PageHeader title={<>Tanker Journey &amp; Plant Operations</>}>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            Last updated: <strong>{lastUpdated.toLocaleTimeString()}</strong>
          </span>
        </div></PageHeader>

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
            color: activeTab === 'all' ? 'var(--primary)' : '#64748b',
            borderBottom: activeTab === 'all' ? '3px solid var(--primary)' : '3px solid transparent',
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
            color: activeTab === 'waiting' ? 'var(--primary)' : '#64748b',
            borderBottom: activeTab === 'waiting' ? '3px solid var(--primary)' : '3px solid transparent',
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
            color: activeTab === 'processed' ? 'var(--primary)' : '#64748b',
            borderBottom: activeTab === 'processed' ? '3px solid var(--primary)' : '3px solid transparent',
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
            color: activeTab === 'rejected' ? 'var(--primary)' : '#64748b',
            borderBottom: activeTab === 'rejected' ? '3px solid var(--primary)' : '3px solid transparent',
          }}
        >
          QC Rejected ({stats?.tabs.rejected ?? 0})
        </button>
      </div>

      {/* Tanker table with its filters (common DataTable pattern) */}
      <DataTable
        singleLine
        filters={[
          { key: 'search', label: 'Search', type: 'text', value: searchQuery, onChange: setSearchQuery, placeholder: 'Tanker, seal, driver, gate pass…' },
          { key: 'bmc', label: 'BMC', type: 'select', value: selectedUnitId, onChange: setSelectedUnitId,
            options: [{ value: '', label: 'All BMCs' }, ...units.map((u) => ({ value: u.id, label: `${u.name} (${u.bmc_code})` }))] },
          { key: 'team', label: 'Team', type: 'select', value: waitingTeamFilter, onChange: setWaitingTeamFilter, options: [
            { value: '', label: 'All Teams' }, { value: 'gate', label: 'Gate' }, { value: 'qc', label: 'QC' },
            { value: 'unloading', label: 'Unloading' }, { value: 'transit', label: 'Transit' } ] },
          { key: 'period', label: 'Period', type: 'select', value: datePreset, onChange: (v) => setDatePreset(v as DatePreset), options: [
            { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'this_week', label: 'This Week' },
            { value: 'last_week', label: 'Last Week' }, { value: 'last_month', label: 'Last Month' }, { value: 'all', label: 'All Dates' },
            { value: 'custom', label: 'Custom…' } ] },
          { key: 'from', label: 'From', type: 'date', value: customFrom, onChange: setCustomFrom, max: customTo || undefined, hidden: datePreset !== 'custom' },
          { key: 'to', label: 'To', type: 'date', value: customTo, onChange: setCustomTo, min: customFrom || undefined, hidden: datePreset !== 'custom' },
        ]}
        filterActions={(
          <button
            type="button"
            onClick={handleExportMilkAck}
            disabled={!fromDate || !toDate || fromDate > toDate}
            className="btn btn-primary btn-sm"
            style={{ width: 'auto' }}
            title="Download the Milk ACK report for the selected dates"
          >
            🥛 Milk ACK Report (.xlsx)
          </button>
        )}
        rows={loading ? [] : records}
        columns={columns}
        getRowKey={(r) => r.id}
        searchable={false}
        pageSize={20}
        pageSizeOptions={[20, 50, 100]}
        onRowClick={handleOpenDrawer}
        emptyMessage={
          loading
            ? 'Loading…'
            : activeTab === 'waiting'
            ? 'No tankers waiting. All caught up!'
            : activeTab === 'processed'
            ? 'No processed tankers found for the selected period.'
            : activeTab === 'rejected'
            ? 'No rejected tankers. Quality checks clean!'
            : 'No tanker records found.'
        }
      />

      {/* PART B: ROW DETAIL DRAWER */}
      <TankerDetailDrawer
        isOpen={drawerOpen}
        onClose={handleCloseDrawer}
        trip={selectedTrip}
        onTripUpdated={() => void fetchData()}
        isAdmin={true}
      />
      <TankerDetailsModal tripId={detailTripId} onClose={() => setDetailTripId(null)} />
    </Page>
  );
}
