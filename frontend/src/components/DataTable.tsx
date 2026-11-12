import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from '../context/LanguageContext';

export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  sortValue?: (row: T) => string | number;
  searchValue?: (row: T) => string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  footerCell?: ReactNode;
}

export interface DataTableProps<T> {
  rows: ReadonlyArray<T>;
  columns: ReadonlyArray<DataColumn<T>>;
  getRowKey: (row: T) => string;
  getRowClassName?: (row: T) => string;
  searchPlaceholder?: string;
  searchable?: boolean;
  pageSize?: number;
  emptyMessage?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  showTotalsRow?: boolean;
}

export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  getRowClassName,
  searchPlaceholder,
  searchable = true,
  pageSize = 15,
  emptyMessage,
  emptyActionLabel,
  onEmptyAction,
  showTotalsRow = false,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [...rows];
    return rows.filter(row =>
      columns.some(col => {
        if (col.searchValue) return col.searchValue(row).toLowerCase().includes(q);
        if (col.sortValue) return String(col.sortValue(row)).toLowerCase().includes(q);
        return false;
      }),
    );
  }, [rows, columns, search]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find(c => c.key === sortKey);
    if (!col?.sortValue) return filtered;
    const getVal = col.sortValue;
    return [...filtered].sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, columns, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const pageRows = sorted.slice(startIdx, startIdx + pageSize);

  const toggleSort = (key: string) => {
    setPage(1);
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  return (
    <div className="data-table-wrapper">
      {searchable && (
        <div className="table-toolbar">
          <input
            type="search"
            className="table-search-input"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={searchPlaceholder ?? t('search')}
            aria-label={searchPlaceholder ?? t('search')}
          />
          <span className="table-count-label">
            {sorted.length} {sorted.length === 1 ? 'record' : 'records'}
          </span>
        </div>
      )}

      {/* Desktop / Tablet sticky table */}
      <div className="table-scroll-container desktop-table-wrap">
        <table className="data-table sticky-header">
          <thead>
            <tr>
              {columns.map(col => {
                const isSortable = Boolean(col.sortValue);
                const isActive = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    style={{ textAlign: col.align ?? 'left' }}
                    className={isSortable ? 'sortable-th' : undefined}
                    onClick={isSortable ? () => toggleSort(col.key) : undefined}
                  >
                    <span className="th-inner">
                      {col.header}
                      {isSortable && (
                        <span className="sort-indicator" aria-hidden="true">
                          {isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="empty">
                  <div className="empty-state-box">
                    <p>{emptyMessage ?? t('noDataAddFirst')}</p>
                    {emptyActionLabel && onEmptyAction && (
                      <button
                        type="button"
                        className="btn-primary"
                        style={{ width: 'auto' }}
                        onClick={onEmptyAction}
                      >
                        {emptyActionLabel}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              pageRows.map(row => (
                <tr key={getRowKey(row)} className={getRowClassName ? getRowClassName(row) : undefined}>
                  {columns.map(col => (
                    <td key={col.key} style={{ textAlign: col.align ?? 'left' }}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {showTotalsRow && sorted.length > 0 && (
            <tfoot>
              <tr className="totals-row">
                {columns.map((col, idx) => (
                  <td key={col.key} style={{ textAlign: col.align ?? 'left' }}>
                    {col.footerCell ?? (idx === 0 ? <strong>Total</strong> : '')}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Mobile card list (shown <= 720px for zero horizontal scroll) */}
      <div className="mobile-cards-list">
        {pageRows.length === 0 ? (
          <div className="empty-state-box">
            <p>{emptyMessage ?? t('noDataAddFirst')}</p>
            {emptyActionLabel && onEmptyAction && (
              <button
                type="button"
                className="btn-primary"
                style={{ width: 'auto' }}
                onClick={onEmptyAction}
              >
                {emptyActionLabel}
              </button>
            )}
          </div>
        ) : (
          <>
            {pageRows.map(row => {
              const rowClass = getRowClassName ? getRowClassName(row) : '';
              const detailCols = columns.filter(c => c.key !== 'actions');
              const actionCol = columns.find(c => c.key === 'actions');
              return (
                <div key={getRowKey(row)} className={`mobile-record-card ${rowClass}`.trim()}>
                  <div className="mobile-record-grid">
                    {detailCols.map(col => (
                      <div key={col.key} className="mobile-record-field">
                        <span className="mobile-field-label">{col.header}</span>
                        <div className="mobile-field-val">{col.render(row)}</div>
                      </div>
                    ))}
                  </div>
                  {actionCol && (
                    <div className="mobile-record-actions">
                      {actionCol.render(row)}
                    </div>
                  )}
                </div>
              );
            })}
            {showTotalsRow && sorted.length > 0 && (
              <div className="mobile-record-card mobile-totals-card">
                <div className="mobile-record-grid">
                  {columns
                    .filter(col => Boolean(col.footerCell))
                    .map(col => (
                      <div key={col.key} className="mobile-record-field">
                        <span className="mobile-field-label">{col.header}</span>
                        <div className="mobile-field-val">{col.footerCell}</div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {totalPages > 1 && (
        <div className="table-pagination">
          <span className="pagination-info">
            {t('showing')} {startIdx + 1}–{Math.min(startIdx + pageSize, sorted.length)} {t('of')} {sorted.length}
          </span>
          <div className="pagination-controls">
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={safePage <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              {t('prev')}
            </button>
            <span className="pagination-page-num">
              {safePage} / {totalPages}
            </span>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              {t('next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

