import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { AuthProvider } from './auth/AuthContext';
import { LocaleProvider } from './i18n/LocaleContext';
import { SocketProvider } from './lib/SocketContext';
import { RequireAuth } from './auth/RequireAuth';
import { LoginPage } from './auth/LoginPage';
import { RegisterPage } from './auth/RegisterPage';
import { LandingPage } from './landing/LandingPage';
import { DashboardPage } from './dashboard/DashboardPage';
import { CampaignListPage } from './campaigns/CampaignListPage';
import { CampaignShell } from './campaigns/CampaignShell';
import { CharactersListPage } from './characters/CharactersListPage';
import { CharacterSheetPage } from './characters/CharacterSheetPage';
import { MonstersPage } from './monsters/MonstersPage';
import { CreatureEditorPage } from './monsters/CreatureEditorPage';
import { EncountersPage } from './encounters/EncountersPage';
import { MapsPage } from './encounters/MapsPage';
import { NotesPage } from './notes/NotesPage';
import { SessionLogPage } from './sessions/SessionLogPage';
import { DiceRollHistoryPage } from './dice/DiceRollHistoryPage';
import { BestiaryLayout } from './bestiary/BestiaryLayout';
import { BestiaryBasicPage } from './bestiary/BestiaryBasicPage';
import { BestiaryCampaignPage, BestiaryCampaignPickerPage } from './bestiary/BestiaryCampaignPage';
import { CreatureSheetPage } from './bestiary/CreatureSheetPage';
import { MapsIndexPage } from './maps/MapsIndexPage';
import { FullscreenMapPage } from './maps/FullscreenMapPage';
import { NotesIndexPage } from './notes/NotesIndexPage';
import { StyleguidePage } from './styleguide/StyleguidePage';
import { CatalogEditorPage } from './catalog/CatalogEditorPage';
import { CampaignMembersPage } from './campaigns/CampaignMembersPage';
import { AssetsPage } from './assets/AssetsPage';

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

              <Route
                path="/home"
                element={
                  <RequireAuth>
                    <DashboardPage />
                  </RequireAuth>
                }
              />

              <Route
                path="/campaigns"
                element={
                  <RequireAuth>
                    <CampaignListPage />
                  </RequireAuth>
                }
              />

              {/* Global bestiary (REFACTOR-PLAN.md §1) — cross-campaign, distinct
                  from the per-campaign Bestiary tab inside CampaignShell below. */}
              <Route
                path="/bestiary"
                element={
                  <RequireAuth>
                    <BestiaryLayout />
                  </RequireAuth>
                }
              >
                <Route index element={<Navigate to="basic" replace />} />
                <Route path="basic" element={<BestiaryBasicPage />} />
                <Route path="campaign" element={<BestiaryCampaignPickerPage />} />
                <Route path="campaign/:id" element={<BestiaryCampaignPage />} />
              </Route>
              <Route
                path="/creature/:id"
                element={
                  <RequireAuth>
                    <CreatureSheetPage />
                  </RequireAuth>
                }
              />

              {/* Cross-campaign maps index + standalone full-screen map view
                  (REFACTOR-PLAN.md §1/§3). */}
              <Route
                path="/maps"
                element={
                  <RequireAuth>
                    <MapsIndexPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/maps/:mapId"
                element={
                  <RequireAuth>
                    <FullscreenMapPage />
                  </RequireAuth>
                }
              />

              <Route
                path="/notes"
                element={
                  <RequireAuth>
                    <NotesIndexPage />
                  </RequireAuth>
                }
              />

              <Route
                path="/campaigns/:campaignId"
                element={
                  <RequireAuth>
                    <CampaignShell />
                  </RequireAuth>
                }
              >
                <Route index element={<Navigate to="characters" replace />} />
                <Route path="characters" element={<CharactersListPage />} />
                <Route path="characters/:characterId" element={<CharacterSheetPage />} />
                <Route path="monsters" element={<MonstersPage />} />
                <Route path="monsters/new" element={<CreatureEditorPage />} />
                <Route path="monsters/:monsterId/edit" element={<CreatureEditorPage />} />
                {/* "session" per REFACTOR-PLAN.md §1 (renamed from "turns") — this
                    is the live-session view; it becomes battle mode automatically
                    once an encounter goes active (see EncountersPage/BattleMode). */}
                <Route path="session" element={<EncountersPage />} />
                {/* "session-log" — the DM's per-session recap (number, title, date
                    played, recap text). Distinct from "session" above (the live
                    combat view); see CampaignShell.tsx's nav item comment. */}
                <Route path="session-log" element={<SessionLogPage />} />
                <Route path="maps" element={<MapsPage />} />
                <Route path="notes" element={<NotesPage />} />
                <Route path="dice-rolls" element={<DiceRollHistoryPage />} />
                <Route path="assets" element={<AssetsPage />} />
                <Route path="catalog" element={<CatalogEditorPage />} />
                <Route path="members" element={<CampaignMembersPage />} />
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
