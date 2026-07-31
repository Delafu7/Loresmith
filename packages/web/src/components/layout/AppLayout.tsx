import { Outlet } from 'react-router-dom';
import { RequireAuth } from '../../auth/RequireAuth';
import { BreadcrumbProvider } from './BreadcrumbContext';
import { HeaderBadgeProvider } from './HeaderBadgeContext';
import { AppHeader } from './AppHeader';

/*
 * Wraps every authenticated route in App.tsx with the shared header/
 * breadcrumb chrome (nav point 7), replacing per-route <RequireAuth> wraps
 * with a single one at the layout level. Public routes (/, /login,
 * /register, /styleguide) stay outside this layout entirely — they render
 * with no persistent header, matching their existing deliberate design.
 */
export function AppLayout() {
  return (
    <RequireAuth>
      <BreadcrumbProvider>
        <HeaderBadgeProvider>
          <AppHeader />
          <Outlet />
        </HeaderBadgeProvider>
      </BreadcrumbProvider>
    </RequireAuth>
  );
}
