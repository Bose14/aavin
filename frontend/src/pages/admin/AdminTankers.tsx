import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../lib/api';
import NewTankerRegistrationModal from '../../components/NewTankerRegistrationModal';
import type { RegisteredTankerData } from '../../components/NewTankerRegistrationModal';
import { ErrorBanner } from '../../components/UiPrimitives';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Page, PageHeader } from '../../components/PageLayout';

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

  const columns: DataColumn<TankerRow>[] = [
    { key: 'vehicle', header: 'Vehicle', sortValue: (r) => r.vehicle_number, render: (r) => <strong>{r.vehicle_number}</strong> },
    { key: 'contractor', header: 'Contractor', sortValue: (r) => r.contractor_name, render: (r) => r.contractor_name },
    {
      key: 'capacity', header: 'Capacity (L)', align: 'right', sortValue: (r) => r.total_capacity,
      render: (r) => (
        <>
          {r.total_capacity.toLocaleString('en-IN')}
          <div style={{ fontSize: '0.74rem', color: '#64748b' }}>{r.number_of_cells} cell(s)</div>
        </>
      ),
    },
    {
      key: 'driver', header: 'Driver', sortValue: (r) => r.driver_name ?? '',
      render: (r) => (
        <>
          {r.driver_name || <span style={{ color: '#b45309' }}>Not set</span>}
          {r.driver_phone && <div style={{ fontSize: '0.76rem', color: '#64748b' }}>{r.driver_phone}</div>}
        </>
      ),
    },
    {
      key: 'route', header: 'Route', sortValue: (r) => r.route_name ?? '',
      render: (r) => (
        <>
          <div style={{ fontWeight: 700 }}>{r.route_name || <span style={{ color: '#b45309', fontWeight: 400 }}>Name not set</span>}</div>
          <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
            {r.route.length === 0 ? 'No BMCs set (open to all BMCs)' : r.route.map((b) => b.name).join(' → ')}
          </div>
        </>
      ),
    },
    {
      key: 'actions', header: '', align: 'right',
      render: (r) => <button type="button" className="btn-secondary btn-sm" onClick={() => openEdit(r)}>Edit</button>,
    },
  ];

  return (
    <Page>
      <PageHeader title="Tankers">
        <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={openNew}>+ Register Tanker</button>
      </PageHeader>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && (
        <div className="success-banner" style={{ marginBottom: '1rem' }}>
          <span>{notice}</span>
        </div>
      )}

      <DataTable
        filters={[{ key: 'search', label: 'Search', type: 'text', value: search, onChange: setSearch, placeholder: 'Vehicle, driver, BMC…' }]}
        rows={loading ? [] : shown}
        columns={columns}
        getRowKey={(r) => r.id}
        searchable={false}
        pageSize={25}
        pageSizeOptions={[25, 50, 100]}
        emptyMessage={loading ? 'Loading…' : 'No tankers registered yet. Click “+ Register Tanker” to add one.'}
      />

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
    </Page>
  );
}
