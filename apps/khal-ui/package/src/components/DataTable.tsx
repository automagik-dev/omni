'use client';

/**
 * Server-driven data table. It renders columns and rows and *emits* sort and
 * pagination intent — it never sorts or slices locally, so a page stays the
 * single source of truth for what the backend returns. Handles the three states
 * every list has: loading, error, and empty. Styled KhalOS-native: a SectionCard
 * surface, a quiet mono header, tabular-nums for ids/numbers, and a copper inset
 * bar on row hover.
 */
import { Button, EmptyState, Note, SectionCard, Spinner } from '@khal-os/ui';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { T } from './tokens';
import './runtime-styles';

export type SortDirection = 'asc' | 'desc';

export interface ColumnDef<T> {
  key: string;
  header: string;
  /** Cell renderer; falls back to `accessor`, then `row[key]`. */
  render?: (row: T) => ReactNode;
  accessor?: (row: T) => ReactNode;
  sortable?: boolean;
  width?: number | string;
  align?: 'left' | 'right' | 'center';
  /** Render cell in a monospace font (ids, timestamps). */
  mono?: boolean;
}

export interface SortState {
  column: string;
  direction: SortDirection;
}

export interface PaginationState {
  page: number;
  pageSize: number;
  total?: number;
  hasMore?: boolean;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  pagination?: PaginationState;
  onPageChange?: (page: number) => void;
  onRowClick?: (row: T) => void;
  /** Filter/search controls rendered above the table. */
  toolbar?: ReactNode;
}

function cellValue<T>(col: ColumnDef<T>, row: T): ReactNode {
  if (col.render) return col.render(row);
  if (col.accessor) return col.accessor(row);
  const raw = (row as Record<string, unknown>)[col.key];
  return raw === null || raw === undefined ? '—' : String(raw);
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  loading = false,
  error = null,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  sort,
  onSortChange,
  pagination,
  onPageChange,
  onRowClick,
  toolbar,
}: DataTableProps<T>) {
  const toggleSort = (col: ColumnDef<T>) => {
    if (!col.sortable || !onSortChange) return;
    const direction: SortDirection = sort?.column === col.key && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ column: col.key, direction });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {toolbar}

      {error && (
        <Note type="error" label="Error">
          {error}
        </Note>
      )}

      <SectionCard variant="default" padding="none" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {columns.map((col) => {
                  const active = sort?.column === col.key;
                  const interactive = Boolean(col.sortable && onSortChange);
                  return (
                    <th
                      key={col.key}
                      className="omni-th"
                      {...(interactive
                        ? {
                            role: 'button',
                            tabIndex: 0,
                            onClick: () => toggleSort(col),
                            onKeyDown: (e: ReactKeyboardEvent) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleSort(col);
                              }
                            },
                          }
                        : {})}
                      style={{
                        textAlign: col.align ?? 'left',
                        padding: '10px 14px',
                        color: T.tertiary,
                        fontFamily: T.mono,
                        fontWeight: 650,
                        fontSize: 10.5,
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        whiteSpace: 'nowrap',
                        borderBottom: `1px solid ${T.border}`,
                        cursor: interactive ? 'pointer' : 'default',
                        width: col.width,
                        userSelect: 'none',
                      }}
                    >
                      {col.header}
                      {col.sortable && (
                        <span style={{ marginLeft: 6, opacity: active ? 1 : 0.3 }}>
                          {active ? (sort?.direction === 'asc' ? '↑' : '↓') : '↕'}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={getRowKey(row)}
                  className={onRowClick ? 'omni-row omni-row-clickable' : 'omni-row'}
                  {...(onRowClick
                    ? {
                        tabIndex: 0,
                        onClick: () => onRowClick(row),
                        onKeyDown: (e: ReactKeyboardEvent) => {
                          if (e.key === 'Enter') onRowClick(row);
                        },
                      }
                    : {})}
                  style={{ borderBottom: `1px solid ${T.borderSubtle}` }}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      style={{
                        padding: '10px 14px',
                        textAlign: col.align ?? 'left',
                        color: T.fg,
                        verticalAlign: 'top',
                        fontFamily: col.mono ? T.mono : undefined,
                        fontSize: col.mono ? 12 : 13,
                        fontVariantNumeric: col.mono || col.align === 'right' ? 'tabular-nums' : undefined,
                        whiteSpace: col.mono ? 'nowrap' : undefined,
                      }}
                    >
                      {cellValue(col, row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 14, color: T.muted, fontSize: 13 }}>
            <Spinner size="sm" /> Loading…
          </div>
        )}

        {!loading && rows.length === 0 && !error && (
          <div style={{ padding: 8 }}>
            <EmptyState title={emptyTitle} description={emptyDescription} compact />
          </div>
        )}
      </SectionCard>

      {pagination && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 12, color: T.muted, fontFamily: T.mono, fontVariantNumeric: 'tabular-nums' }}>
            Page {pagination.page + 1}
            {pagination.total !== undefined && ` · ${pagination.total} total`}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button
              size="small"
              variant="secondary"
              disabled={pagination.page <= 0 || loading}
              onClick={() => onPageChange?.(pagination.page - 1)}
            >
              Prev
            </Button>
            <Button
              size="small"
              variant="secondary"
              disabled={
                loading ||
                pagination.hasMore === false ||
                (pagination.total !== undefined && (pagination.page + 1) * pagination.pageSize >= pagination.total)
              }
              onClick={() => onPageChange?.(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
