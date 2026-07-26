import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { AuthProvider } from './auth/AuthContext';
import { SocketProvider } from './lib/SocketContext';
import { RequireAuth } from './auth/RequireAuth';
import { LoginPage } from './auth/LoginPage';
import { RegisterPage } from './auth/RegisterPage';
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
import { DiceRollHistoryPage } from './dice/DiceRollHistoryPage';

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SocketProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              <Route
                path="/"
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
                <Route path="turns" element={<EncountersPage />} />
                <Route path="maps" element={<MapsPage />} />
                <Route path="notes" element={<NotesPage />} />
                <Route path="dice-rolls" element={<DiceRollHistoryPage />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </SocketProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
