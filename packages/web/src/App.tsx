import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { AuthProvider } from './auth/AuthContext';
import { LocaleProvider } from './i18n/LocaleContext';
import { SocketProvider } from './lib/SocketContext';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './auth/LoginPage';
import { RegisterPage } from './auth/RegisterPage';
import { LandingPage } from './landing/LandingPage';
import { DashboardPage } from './dashboard/DashboardPage';
import { CampaignListPage } from './campaigns/CampaignListPage';
import { CampaignShell } from './campaigns/CampaignShell';
import { CampaignDashboardPage } from './campaigns/CampaignDashboardPage';
import { MapSectionPage } from './campaigns/MapSectionPage';
import { CharactersListPage } from './characters/CharactersListPage';
import { CharacterSheetPage } from './characters/CharacterSheetPage';
import { MonstersPage } from './monsters/MonstersPage';
import { CreatureEditorPage } from './monsters/CreatureEditorPage';
import { ItemRepositoryPage } from './items/ItemRepositoryPage';
import { LiveMapPage } from './encounters/LiveMapPage';
import { EncountersPage } from './encounters/EncountersPage';
import { NotesPage } from './notes/NotesPage';
import { SessionLogPage } from './sessions/SessionLogPage';
import { DiceRollHistoryPage } from './dice/DiceRollHistoryPage';
import { BestiaryLayout } from './bestiary/BestiaryLayout';
import { BestiaryBasicPage } from './bestiary/BestiaryBasicPage';
import { BestiaryCampaignPage, BestiaryCampaignPickerPage } from './bestiary/BestiaryCampaignPage';
import { CreatureSheetPage } from './bestiary/CreatureSheetPage';
import { NotesIndexPage } from './notes/NotesIndexPage';
import { StyleguidePage } from './styleguide/StyleguidePage';
import { CatalogEditorPage } from './catalog/CatalogEditorPage';
import { CampaignMembersPage } from './campaigns/CampaignMembersPage';
import { AssetsPage } from './assets/AssetsPage';
import { ProfilePage } from './profile/ProfilePage';

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <LocaleProvider>
        <SocketProvider>
          <BrowserRouter>
            <Routes>
              {/* Public: opening transition, then /login or /home (REFACTOR-PLAN.md §8). */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              {/* Design-system reference (not app data) — deliberately not behind
                  RequireAuth. */}
              <Route path="/styleguide" element={<StyleguidePage />} />

              {/* Map-first encounter system: the fullscreen live map. Deliberately
                  OUTSIDE AppLayout (same "skip the persistent header" pattern as
                  /styleguide above) — a real viewport takeover, not a panel inside
                  the normal chrome. Owns its own RequireAuth (LiveMapPage.tsx). */}
              <Route path="/campaigns/:campaignId/live/:encounterId" element={<LiveMapPage />} />

              {/* Every authenticated route shares one persistent header/breadcrumb
                  shell (AppLayout) instead of each page wrapping itself in its
                  own <RequireAuth> and building its own ad hoc header. */}
              <Route element={<AppLayout />}>
                <Route path="/home" element={<DashboardPage />} />
                <Route path="/profile" element={<ProfilePage />} />

                <Route path="/campaigns" element={<CampaignListPage />} />

                {/* Global bestiary (REFACTOR-PLAN.md §1) — cross-campaign, distinct
                    from the per-campaign Bestiary tab inside CampaignShell below. */}
                <Route path="/bestiary" element={<BestiaryLayout />}>
                  <Route index element={<Navigate to="basic" replace />} />
                  <Route path="basic" element={<BestiaryBasicPage />} />
                  <Route path="campaign" element={<BestiaryCampaignPickerPage />} />
                  <Route path="campaign/:id" element={<BestiaryCampaignPage />} />
                </Route>
                <Route path="/creature/:id" element={<CreatureSheetPage />} />

                <Route path="/notes" element={<NotesIndexPage />} />

                <Route path="/campaigns/:campaignId" element={<CampaignShell />}>
                  <Route index element={<Navigate to="dashboard" replace />} />
                  {/* Campaign-scoped Dashboard (design/nocturne.html) — the
                      default landing view; useLiveMapAutoOpen (mounted at
                      CampaignShell) redirects straight past this into the
                      fullscreen live map whenever an encounter is active. */}
                  <Route path="dashboard" element={<CampaignDashboardPage />} />
                  {/* Dedicated Map section (design/map.html) — DM token
                      positioning + party stats, available anytime, separate
                      from the fullscreen live-combat takeover at /live/:id
                      (unchanged, still auto-pushed to on "Start combat"). */}
                  <Route path="map" element={<MapSectionPage />} />
                  <Route path="characters" element={<CharactersListPage />} />
                  <Route path="characters/:characterId" element={<CharacterSheetPage />} />
                  <Route path="monsters" element={<MonstersPage />} />
                  <Route path="monsters/new" element={<CreatureEditorPage />} />
                  <Route path="monsters/:monsterId/edit" element={<CreatureEditorPage />} />
                  <Route path="items" element={<ItemRepositoryPage />} />
                  {/* "session" per REFACTOR-PLAN.md §1 (renamed from "turns") — this
                      is the live-session view; it becomes battle mode automatically
                      once an encounter goes active (see EncountersPage/BattleMode). */}
                  <Route path="session" element={<EncountersPage />} />
                  {/* "session-log" — the DM's per-session recap (number, title, date
                      played, recap text). Distinct from "session" above (the live
                      combat view); see CampaignShell.tsx's nav item comment. */}
                  <Route path="session-log" element={<SessionLogPage />} />
                  <Route path="notes" element={<NotesPage />} />
                  <Route path="dice-rolls" element={<DiceRollHistoryPage />} />
                  <Route path="assets" element={<AssetsPage />} />
                  <Route path="catalog" element={<CatalogEditorPage />} />
                  <Route path="members" element={<CampaignMembersPage />} />
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </SocketProvider>
        </LocaleProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
