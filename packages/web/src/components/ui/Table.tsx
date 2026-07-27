import type { ReactNode } from 'react';

export interface TableColumn<T> {
  key: string;
  /** Column header, shown in the desktop `<thead>`. */
  header: ReactNode;
  /** Plain-text label, shown as a `data-label` prefix on each stacked mobile card row. */
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
}

/*
 * Responsive table (docs/design-tokens.md "Tables" + Phase 3 "wide tables
 * become stacked cards on narrow screens"). One CSS-only markup renders both
 * layouts — no dual render, no JS breakpoint check:
 *  - `sm:` and up: a real <table>, with the source's signature row rule (a
 *    background-image gradient that fades at both ends, not a border, so
 *    hover can layer a second wash without fighting it).
 *  - below `sm:`: table/thead/tr/td all drop to `display: block`, the
 *    header hides, and each cell grows a `data-label:` prefix via
 *    `content: attr(data-label)` — every row becomes a labeled card, in the
 *    same source order, with zero horizontal scroll.
 */
const ROW_RULE =
  'linear-gradient(to right, transparent, var(--color-stone-800) 48px, var(--color-stone-800) calc(100% - 48px), transparent) no-repeat bottom / 100% 1px';

export function Table<T>({
  columns,
  rows,
  rowKey,
  className = '',
  emptyMessage = 'Nothing here yet.',
}: {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  className?: string;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm italic text-stone-500">{emptyMessage}</p>;
  }

  return (
    <table className={`w-full border-collapse text-sm max-sm:block ${className}`}>
      <thead className="max-sm:hidden">
        <tr style={{ backgroundImage: ROW_RULE }}>
          {columns.map((col) => (
            <th
              key={col.key}
              className={`px-2 py-2 text-left text-[11px] uppercase tracking-wider text-stone-500 ${col.className ?? ''}`}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="max-sm:block max-sm:space-y-3">
        {rows.map((row) => (
          <tr
            key={rowKey(row)}
            style={{ backgroundImage: ROW_RULE }}
            className="transition-colors hover:bg-stone-100/5 max-sm:block max-sm:rounded-md max-sm:bg-stone-900 max-sm:p-3 max-sm:shadow-sm"
          >
            {columns.map((col) => (
              <td
                key={col.key}
                data-label={col.label}
                className={`px-2 py-2 align-middle text-stone-200 max-sm:flex max-sm:justify-between max-sm:gap-3 max-sm:px-0 max-sm:py-1 max-sm:before:flex-none max-sm:before:text-xs max-sm:before:uppercase max-sm:before:tracking-wide max-sm:before:text-stone-500 max-sm:before:content-[attr(data-label)] ${col.className ?? ''}`}
              >
                {col.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
