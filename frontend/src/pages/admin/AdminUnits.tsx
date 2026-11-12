import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import api from '../../lib/api';
import { useZoneSettings } from '../../hooks/useZoneSettings';
import { formatDateDDMMYYYY, getLocalTodayIso } from '../../lib/format';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { ConfirmDialog, ErrorBanner, StatusBadge, TableSkeleton } from '../../components/UiPrimitives';

interface Unit {
  id: string;
  name: string;
  unit_code: string;
  location: string | null;
  is_active: boolean;
  users_count: number;
  last_record_date: string | null;
  submitted_today: boolean;
  created_at: string;
}

export default function AdminUnits() {
  const { settings } = useZoneSettings();
  const [units, setUnits] = useState<Unit[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [name, setName] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [location, setLocation] = useState(() => settings.locations[0] ?? 'Rasipuram');
  const [customLocation, setCustomLocation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<Unit | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [toggleTarget, setToggleTarget] = useState<Unit | null>(null);
  const [toggling, setToggling] = useState(false);

  const fetchUnits = useCallback(async () => {
    setLoadingList(true);
    setError('');
    try {
      const res = await api.get<Unit[]>('/units');
      setUnits(res.data);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load units');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void fetchUnits();
  }, [fetchUnits]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    const chosenLocation = location === '__custom__' ? customLocation.trim() : location;
    try {
      await api.post('/units', {
        name: name.trim(),
        unit_code: unitCode.trim().toUpperCase(),
        location: chosenLocation || undefined,
      });
      setName('');
      setUnitCode('');
      setCustomLocation('');
      await fetchUnits();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create unit');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (u: Unit) => {
    setEditTarget(u);
    setEditName(u.name);
    setEditCode(u.unit_code);
    setEditLocation(u.location ?? settings.locations[0] ?? '');
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    setSavingEdit(true);
    setError('');
    try {
      await api.patch(`/units/${editTarget.id}`, {
        name: editName.trim(),
        unit_code: editCode.trim().toUpperCase(),
        location: editLocation.trim() || null,
      });
      setEditTarget(null);
      await fetchUnits();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update unit');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmToggle = async () => {
    if (!toggleTarget) return;
    setToggling(true);
    try {
      await api.patch(`/units/${toggleTarget.id}`, { is_active: !toggleTarget.is_active });
      setToggleTarget(null);
      await fetchUnits();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update unit status');
    } finally {
      setToggling(false);
    }
  };

  const todayISO = getLocalTodayIso();
  const missingTodayCount = units.filter(u => u.is_active && !u.submitted_today).length;

  const columns: DataColumn<Unit>[] = [
    {
      key: 'name',
      header: 'Unit Name',
      sortValue: u => u.name,
      render: u => (
        <div>
          <strong>{u.name}</strong>
          {u.is_active && !u.submitted_today && (
            <div style={{ marginTop: 3 }}>
              <StatusBadge tone="amber">Not submitted today ({formatDateDDMMYYYY(todayISO)})</StatusBadge>
            </div>
          )}
        </div>
      ),
    },
    { key: 'code', header: 'Code', sortValue: u => u.unit_code, render: u => <code>{u.unit_code}</code> },
    { key: 'location', header: 'Taluk / Village', sortValue: u => u.location ?? '', render: u => u.location || '—' },
    { key: 'users', header: 'Users', sortValue: u => u.users_count, render: u => u.users_count },
    {
      key: 'last_record',
      header: 'Last Record Date',
      sortValue: u => u.last_record_date ?? '',
      render: u => (u.last_record_date ? formatDateDDMMYYYY(u.last_record_date) : 'No entries yet'),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: u => (u.is_active ? 1 : 0),
      render: u => (
        <StatusBadge tone={u.is_active ? 'green' : 'grey'}>
          {u.is_active ? 'Active' : 'Inactive'}
        </StatusBadge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: u => (
        <div className="action-row">
          <button type="button" onClick={() => openEdit(u)} className="btn-secondary btn-sm">
            Edit
          </button>
          <button
            type="button"
            onClick={() => setToggleTarget(u)}
            className={u.is_active ? 'btn-danger btn-sm' : 'btn-secondary btn-sm'}
          >
            {u.is_active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Manage Units</h1>
          <p className="page-subtitle">
            Create, edit, and monitor collection units in your zone
            {missingTodayCount > 0 && ` · ${missingTodayCount} active unit(s) pending today`}
          </p>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchUnits} />}

      <div className="card form-card">
        <h2>Add New Unit</h2>
        <form onSubmit={handleCreate} className="entry-form">
          <div className="form-row">
            <div className="form-group">
              <label>Unit Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rasipuram" required />
            </div>
            <div className="form-group">
              <label>Unit Code</label>
              <input value={unitCode} onChange={e => setUnitCode(e.target.value)} placeholder="e.g. RNK-001" required />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Location (Taluk / Village)</label>
              <select value={location} onChange={e => setLocation(e.target.value)}>
                {settings.locations.map(loc => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
                <option value="__custom__">Other (specify below)…</option>
              </select>
            </div>
            {location === '__custom__' && (
              <div className="form-group">
                <label>Custom Village / Taluk</label>
                <input
                  value={customLocation}
                  onChange={e => setCustomLocation(e.target.value)}
                  placeholder="Enter village or taluk name"
                  required
                />
              </div>
            )}
          </div>

          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Creating…' : 'Create Unit'}
          </button>
        </form>
      </div>

      <div className="card table-card">
        <h2>All Units in Your Zone</h2>
        {loadingList ? (
          <TableSkeleton rows={4} cols={7} />
        ) : (
          <DataTable
            rows={units}
            columns={columns}
            getRowKey={u => u.id}
            getRowClassName={u => (u.is_active && !u.submitted_today ? 'row-warn' : '')}
            emptyMessage="No units created yet. Add your first village collection centre above."
          />
        )}
      </div>

      {/* Edit Unit Modal */}
      {editTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3 className="modal-title">Edit Unit — {editTarget.name}</h3>
            <div className="entry-form" style={{ marginTop: '0.75rem' }}>
              <div className="form-group">
                <label>Unit Name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Unit Code</label>
                <input value={editCode} onChange={e => setEditCode(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Location (Taluk / Village)</label>
                <select
                  value={settings.locations.includes(editLocation) ? editLocation : '__custom__'}
                  onChange={e => setEditLocation(e.target.value === '__custom__' ? '' : e.target.value)}
                >
                  {settings.locations.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                  <option value="__custom__">Other / Custom…</option>
                </select>
                {!settings.locations.includes(editLocation) && (
                  <input
                    style={{ marginTop: '0.45rem' }}
                    value={editLocation}
                    onChange={e => setEditLocation(e.target.value)}
                    placeholder="Enter village or taluk"
                  />
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                style={{ width: 'auto' }}
                disabled={savingEdit || !editName.trim() || !editCode.trim()}
                onClick={() => void handleSaveEdit()}
              >
                {savingEdit ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate / Activate Confirmation */}
      <ConfirmDialog
        open={Boolean(toggleTarget)}
        title={toggleTarget?.is_active ? `Deactivate ${toggleTarget.name}?` : `Activate ${toggleTarget?.name}?`}
        message={
          toggleTarget?.is_active
            ? `Deactivate ${toggleTarget.name}? Its ${toggleTarget.users_count} ${toggleTarget.users_count === 1 ? 'user' : 'users'} will not be able to log in. Existing records are kept.`
            : `Re-activate ${toggleTarget?.name}? Its assigned users will be allowed to log in again.`
        }
        confirmLabel={toggleTarget?.is_active ? 'Deactivate Unit' : 'Activate Unit'}
        danger={Boolean(toggleTarget?.is_active)}
        loading={toggling}
        onConfirm={() => void handleConfirmToggle()}
        onCancel={() => setToggleTarget(null)}
      />
    </div>
  );
}
