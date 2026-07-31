import { Link } from 'react-router-dom';
import { useLocale } from '../../i18n/LocaleContext';

/*
 * Explicit back control (nav point 7: "an explicit back button in every
 * detail view, returning to the logical parent level, not just plain
 * browser history"). Takes the parent route explicitly rather than reading
 * browser history, so it's correct even when the detail view was opened via
 * a direct link/refresh with no history to go back to.
 */
export function BackButton({ to, label }: { to: string; label?: string }) {
  const { t } = useLocale();
  return (
    <Link
      to={to}
      className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm text-stone-400 hover:bg-stone-800 hover:text-stone-200"
    >
      <span aria-hidden="true">←</span>
      {label ?? t('common.back')}
    </Link>
  );
}
