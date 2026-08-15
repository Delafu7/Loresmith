// Player-facing counterpart to ElementPropertyPanel.tsx's DM-only edit
// panel: BattleMap.tsx renders this instead, for a non-DM viewer, when the
// selected element is a door. Resolves the acting participant the same way
// BattleModePlayerPanel.tsx does (participants whose characterId is one of
// the viewer's own), then calls useDoorAction — the server rolls (for
// 'force'), decides the outcome, persists it, and broadcasts it; this panel
// only ever sends an intention, never a claimed result, and never writes to
// the element locally (MAP_ELEMENTS_CHANGED over the socket is what actually
// updates the door, here and in every other connected session).
import { useState } from 'react';
import type { MapElement, SnapshotParticipant } from '../../lib/types';
import { useLocale } from '../../i18n/LocaleContext';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Field';
import { Button } from '../../components/ui/Button';
import { ErrorBanner, errorMessage } from '../../components/Feedback';
import { useDoorAction } from './useMapElements';

export function DoorActionPanel({
  encounterId,
  element,
  participants,
  myCharacterIds,
  onClose,
}: {
  encounterId: string;
  element: MapElement & { type: 'door' };
  participants: SnapshotParticipant[];
  myCharacterIds: Set<string>;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const myParticipants = participants.filter((p) => p.characterId != null && myCharacterIds.has(p.characterId));
  const [selectedParticipantId, setSelectedParticipantId] = useState(myParticipants[0]?.participantId ?? '');
  const actingParticipant = myParticipants.find((p) => p.participantId === selectedParticipantId) ?? myParticipants[0];

  const doorAction = useDoorAction(encounterId);

  const state = element.props.state;
  const canOpen = state === 'closed';
  const canClose = state === 'open';
  const canForce = state === 'locked' || state === 'stuck';

  function act(action: 'open' | 'close' | 'force') {
    if (!actingParticipant) return;
    doorAction.mutate({ participantId: actingParticipant.participantId, elementId: element.id, action });
  }

  return (
    <Modal open onClose={onClose} title={t('encounters.mapElements.doorAction.title')}>
      <div className="space-y-3">
        {myParticipants.length === 0 && <p className="text-sm text-stone-400">{t('encounters.mapElements.doorAction.noParticipant')}</p>}

        {myParticipants.length > 1 && (
          <Select value={selectedParticipantId} onChange={(e) => setSelectedParticipantId(e.target.value)}>
            {myParticipants.map((p) => (
              <option key={p.participantId} value={p.participantId}>
                {p.name}
              </option>
            ))}
          </Select>
        )}

        {myParticipants.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={!canOpen || doorAction.isPending} onClick={() => act('open')}>
              {t('encounters.mapElements.doorAction.open')}
            </Button>
            <Button type="button" disabled={!canClose || doorAction.isPending} onClick={() => act('close')}>
              {t('encounters.mapElements.doorAction.close')}
            </Button>
            <Button type="button" disabled={!canForce || doorAction.isPending} onClick={() => act('force')}>
              {t('encounters.mapElements.doorAction.force')}
            </Button>
          </div>
        )}

        {doorAction.data && (
          <div className={`rounded-md border px-2 py-1 text-sm ${doorAction.data.success === false ? 'border-red-800 text-red-400' : 'border-green-800 text-green-400'}`}>
            {doorAction.data.message}
          </div>
        )}
        {doorAction.isError && <ErrorBanner message={errorMessage(doorAction.error)} />}
      </div>
    </Modal>
  );
}
