import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../lib/api';
import NewTankerRegistrationModal from '../../components/NewTankerRegistrationModal';
import type { RegisteredTankerData } from '../../components/NewTankerRegistrationModal';
import { ErrorBanner, TableSkeleton } from '../../components/UiPrimitives';

interface TankerRow {
  id: string;
  vehicle_number: string;
  contractor_name: string;
  supplier_name: string;
  from_date: string | null;
  vehicle_type: 'Registered' | 'Unregistered' | null;
  number_of_cells: 1 | 2 | 3;
  front_cell_capacity: number;
  middle_cell_capacity: number;
  back_cell_capacity: number;
  total_capacity: number;
  driver_name: string | null;
  driver_phone: string | null;
  route_name: string | null;
  route_bmc_ids: string[];
  route: { id: string; name: string }[];
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: '0.74rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#475569',
  background: '#f1f5f9',
  borderBottom: '1px solid #cbd5e1',
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '8px 10px', fontSize: '0.86rem', borderBottom: '1px solid #e2e8f0', verticalAlign: 'top' };

export default function AdminTankers() {
  const [rows, setRows] = useState<TankerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<TankerRow | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<TankerRow[]>('/tanker/registered');
      setRows(res.data || []);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load tankers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.vehicle_number, r.contractor_name, r.driver_name ?? '', r.route_name ?? '', ...r.route.map((b) => b.name)].join(' ').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const openNew = () => {
    setEditing(null);
    setShowModal(true);
  };
  const openEdit = (r: TankerRow) => {
    setEditing(r);
    setShowModal(true);
  };

  const initial: Partial<RegisteredTankerData> | null = editing
    ? {
        vehicle_number: editing.vehicle_number,
        contractor_name: editing.contractor_name,
        supplier_name: editing.supplier_name,
        vehicle_type: editing.vehicle_type ?? 'Registered',
        number_of_cells: editing.number_of_cells,
        front_cell_capacity: editing.front_cell_capacity,
        middle_cell_capacity: editing.middle_cell_capacity,
        back_cell_capacity: editing.back_cell_capacity,
        driver_name: editing.driver_name ?? '',
        driver_phone: editing.driver_phone ?? '',
        route_name: editing.route_name ?? '',
        route_bmc_ids: editing.route_bmc_ids,
      }
    : null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>Tankers</h1>
        <button
          type="button"
          onClick={openNew}
          style={{ background: '#65a30d', color: '#fff', border: 'none', borderRadius: 3, padding: '7px 16px', fontWeight: 700, fontSize: '0.86rem', cursor: 'pointer' }}
        >
          + Register Tanker
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && (
        <div className="success-banner" style={{ marginBottom: '1rem' }}>
          <span>{notice}</span>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search vehicle, driver, BMC…"
          style={{ width: 280, height: 30, padding: '2px 10px', border: '1px solid #94a3b8', borderRadius: 3, marginBottom: 10 }}
        />
        {loading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Vehicle</th>
                  <th style={th}>Contractor</th>
                  <th style={th}>Capacity (L)</th>
                  <th style={th}>Driver</th>
                  <th style={th}>Route</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td style={{ ...td, color: '#64748b' }} colSpan={6}>
                      No tankers registered yet. Click “+ Register Tanker” to add one.
                    </td>
                  </tr>
                )}
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, fontWeight: 700 }}>{r.vehicle_number}</td>
                    <td style={td}>{r.contractor_name}</td>
                    <td style={td}>
                      {r.total_capacity.toLocaleString('en-IN')}
                      <div style={{ fontSize: '0.74rem', color: '#64748b' }}>{r.number_of_cells} cell(s)</div>
                    </td>
                    <td style={td}>
                      {r.driver_name || <span style={{ color: '#b45309' }}>Not set</span>}
                      {r.driver_phone && <div style={{ fontSize: '0.76rem', color: '#64748b' }}>{r.driver_phone}</div>}
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 700 }}>{r.route_name || <span style={{ color: '#b45309', fontWeight: 400 }}>Name not set</span>}</div>
                      <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        {r.route.length === 0 ? 'No BMCs set (open to all BMCs)' : r.route.map((b) => b.name).join(' → ')}
                      </div>
                    </td>
                    <td style={td}>
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 3, padding: '3px 12px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <NewTankerRegistrationModal
          key={editing?.id ?? 'new'}
          isOpen
          initial={initial}
          onClose={() => setShowModal(false)}
          onSuccess={(t) => {
            setNotice(`✓ Tanker ${t.vehicle_number} saved.`);
            void load();
          }}
        />
      )}
    </div>
  );
}
