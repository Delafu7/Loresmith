import { Link } from 'react-router-dom';
import { useBreadcrumbTrail } from './BreadcrumbContext';

export function Breadcrumbs() {
  const segments = useBreadcrumbTrail();
  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-1.5 text-xs text-stone-500 sm:text-sm">
        {segments.map((segment, i) => {
          const isLast = i === segments.length - 1;
          return (
            <li key={`${segment.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <span aria-hidden="true">›</span>}
              {segment.to && !isLast ? (
                <Link to={segment.to} className="truncate hover:text-stone-300">
                  {segment.label}
                </Link>
              ) : (
                <span className={`truncate ${isLast ? 'text-stone-300' : ''}`} aria-current={isLast ? 'page' : undefined}>
                  {segment.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
