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
  /** Net total (all rows). Shown in the totals row when showTotalsRow is on. */
  footerCell?: ReactNode;
  /** Total of the rows on the current page. When any column sets it, a Page Total row is shown above the Net Total row. */
  pageFooterCell?: (pageRows: ReadonlyArray<T>) => ReactNode;
}

export interface TableFilter {
  key: string;
  label: string;
  type: 'select' | 'date' | 'text';
  value: string;
  onChange: (value: string) => void;
  /** select: the choices (the first one is usually the "All" option). */
  options?: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  hidden?: boolean;
}

export interface DataTableProps<T> {
  /** Filter bar shown above the table, in the common style. Values live in the page (controlled). */
  filters?: ReadonlyArray<TableFilter>;
  /** Extra controls on the right of the filter bar (export buttons, etc.). */
  filterActions?: ReactNode;
  /** When given, a "Clear filters" button appears once any filter differs from its default. */
  onClearFilters?: () => void;
  filtersActive?: boolean;
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
  onRowClick?: (row: T) => void;
  /** Rows-per-page choices in the Show selector. */
  pageSizeOptions?: ReadonlyArray<number>;
}

export function DataTable<T>({
  filters,
  filterActions,
  onClearFilters,
  filtersActive = false,
  rows,
  columns,
  getRowKey,
  getRowClassName,
  searchPlaceholder,
  searchable = true,
  pageSize: initialPageSize = 15,
  emptyMessage,
  emptyActionLabel,
  onEmptyAction,
  showTotalsRow = false,
  onRowClick,
  pageSizeOptions = [15, 25, 50, 100],
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const sizeChoices = useMemo(
    () => Array.from(new Set([...pageSizeOptions, initialPageSize])).sort((a, b) => a - b),
    [pageSizeOptions, initialPageSize],
  );

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

  const hasPageTotals = columns.some(c => Boolean(c.pageFooterCell));

  return (
    <div className="data-table-wrapper">
      {((filters && filters.some(f => !f.hidden)) || filterActions) && (
        <div className="dt-filters">
          {(filters ?? []).filter(f => !f.hidden).map(f => (
            <label key={f.key} className="dt-filter">
              <span>{f.label}</span>
              {f.type === 'select' ? (
                <select value={f.value} disabled={f.disabled} onChange={e => { f.onChange(e.target.value); setPage(1); }}>
                  {(f.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === 'date' ? (
                <input type="date" value={f.value} min={f.min} max={f.max} disabled={f.disabled} onChange={e => { f.onChange(e.target.value); setPage(1); }} />
              ) : (
                <input type="search" value={f.value} placeholder={f.placeholder} disabled={f.disabled} onChange={e => { f.onChange(e.target.value); setPage(1); }} />
              )}
            </label>
          ))}
          {onClearFilters && filtersActive && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => { onClearFilters(); setPage(1); }}>✕ Clear filters</button>
          )}
          {filterActions && <div className="dt-filter-actions">{filterActions}</div>}
        </div>
      )}
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
                <tr
                  key={getRowKey(row)}
                  className={getRowClassName ? getRowClassName(row) : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={{ cursor: onRowClick ? 'pointer' : undefined }}
                >
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
              {hasPageTotals && (
                <tr className="totals-row">
                  {columns.map((col, idx) => (
                    <td key={col.key} style={{ textAlign: col.align ?? 'left' }}>
                      {col.pageFooterCell ? col.pageFooterCell(pageRows) : (idx === 0 ? <strong>Page Total</strong> : '')}
                    </td>
                  ))}
                </tr>
              )}
              <tr className="totals-row">
                {columns.map((col, idx) => (
                  <td key={col.key} style={{ textAlign: col.align ?? 'left' }}>
                    {col.footerCell ?? (idx === 0 ? <strong>{hasPageTotals ? 'Net Total' : 'Total'}</strong> : '')}
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
                <div
                  key={getRowKey(row)}
                  className={`mobile-record-card ${rowClass}`.trim()}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={{ cursor: onRowClick ? 'pointer' : undefined }}
                >
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

      {sorted.length > 0 && (
        <div className="table-pagination">
          <div className="pagination-controls">
            <button type="button" className="pager-btn" disabled={safePage <= 1} onClick={() => setPage(1)} aria-label="First page">«</button>
            <button type="button" className="pager-btn" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} aria-label="Previous page">‹</button>
            <span className="pagination-page-num">Go to:</span>
            <input
              type="number"
              className="pager-input"
              min={1}
              max={totalPages}
              value={safePage}
              onChange={e => setPage(Math.min(totalPages, Math.max(1, Number(e.target.value) || 1)))}
              aria-label="Page number"
            />
            <span className="pagination-page-num">/ {totalPages}</span>
            <button type="button" className="pager-btn" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} aria-label="Next page">›</button>
            <button type="button" className="pager-btn" disabled={safePage >= totalPages} onClick={() => setPage(totalPages)} aria-label="Last page">»</button>
          </div>
          <label className="pager-show">
            <span>Show</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
              {sizeChoices.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <span className="pagination-info">
            Showing {startIdx + 1}–{Math.min(startIdx + pageSize, sorted.length)} of {sorted.length} records
          </span>
        </div>
      )}
    </div>
  );
}

