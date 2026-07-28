import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  CampaignAsset,
  Character,
  CharacterClass,
  SavingThrowProficiency,
  SkillProficiency,
  SkillProficiencyLevel,
} from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useCharacterEditMode } from './useCharacterEditMode';
import {
  useAbilityScoresCatalog,
  useBackgroundsCatalog,
  useClassesCatalog,
  useRacesCatalog,
  useSkillsCatalog,
  useSubclassesCatalog,
} from '../lib/useCatalog';
import { AbilityScoreGrid } from '../components/AbilityScoreGrid';
import { HPBar } from '../components/HPBar';
import { HpAdjustForm } from '../components/HpAdjustForm';
import { Portrait } from '../components/Portrait';
import { ImageUploadField } from '../components/ImageUploadField';
import { SavingThrowsPanel } from './SavingThrowsPanel';
import { SkillsPanel } from './SkillsPanel';
import { ClassSummaryPanel } from './ClassSummaryPanel';
import { SpellcastingPanel } from './SpellcastingPanel';
import { InventoryPanel } from './InventoryPanel';
import { CharacterAttacksPanel } from './CharacterAttacksPanel';
import { ResourcePoolPanel } from './ResourcePoolPanel';
import { CharacterEffectsPanel } from './CharacterEffectsPanel';
import { Loading, ErrorBanner, errorMessage } from '../components/Feedback';
import { proficiencyBonusForLevel } from '../lib/dnd-math';
import type { ProficiencyLevel } from '../components/ProficiencyToggle';

export function CharacterSheetPage() {
  const params = useParams<{ characterId: string }>();
  const characterId = Number(params.characterId);
  const { campaignId, campaign, role } = useCampaignShell();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const characterQuery = useQuery({
    queryKey: ['character', characterId],
    queryFn: () => api.get<{ character: Character }>(`/characters/${characterId}`),
    enabled: Number.isInteger(characterId),
  });

  const classesQuery = useQuery({
    queryKey: ['character', characterId, 'classes'],
    queryFn: () => api.get<{ classes: CharacterClass[] }>(`/characters/${characterId}/classes`),
    enabled: Number.isInteger(characterId),
  });

  const skillProficienciesQuery = useQuery({
    queryKey: ['character', characterId, 'skill-proficiencies'],
    queryFn: () => api.get<{ skillProficiencies: SkillProficiency[] }>(`/characters/${characterId}/skill-proficiencies`),
    enabled: Number.isInteger(characterId),
  });

  const savingThrowsQuery = useQuery({
    queryKey: ['character', characterId, 'saving-throw-proficiencies'],
    queryFn: () =>
      api.get<{ savingThrowProficiencies: SavingThrowProficiency[] }>(
        `/characters/${characterId}/saving-throw-proficiencies`,
      ),
    enabled: Number.isInteger(characterId),
  });

  // GET /characters/:id only returns the raw portrait_asset_id FK (no joined
  // file_url — see services/characters.ts's getCharacter, a plain `SELECT *`
  // spread), so resolving it to a displayable URL means fetching the
  // campaign's asset list separately and looking the id up client-side,
  // rather than the server doing the join.
  const assetsQuery = useQuery({
    queryKey: ['campaign', campaignId, 'assets'],
    queryFn: () => api.get<{ assets: CampaignAsset[] }>(`/campaigns/${campaignId}/assets`),
    enabled: Number.isInteger(campaignId),
  });

  const abilityScoresCatalog = useAbilityScoresCatalog();
  const skillsCatalog = useSkillsCatalog();
  const racesCatalog = useRacesCatalog(campaign.srd_edition);
  const backgroundsCatalog = useBackgroundsCatalog(campaign.srd_edition);
  const classesCatalog = useClassesCatalog(campaign.srd_edition);
  const subclassesCatalog = useSubclassesCatalog(campaign.srd_edition);

  const character = characterQuery.data?.character;
  const editMode = useCharacterEditMode(character, role, user?.id);
  const editable = editMode !== 'read';

  // ---- Core stats (abilities/AC/speed) edit form ----
  const [editingCore, setEditingCore] = useState(false);
  const [coreDraft, setCoreDraft] = useState<Pick<
    Character,
    'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha' | 'armor_class' | 'speed' | 'alignment' | 'notes'
  > | null>(null);

  useEffect(() => {
    if (character && !editingCore) {
      setCoreDraft({
        str: character.str,
        dex: character.dex,
        con: character.con,
        int: character.int,
        wis: character.wis,
        cha: character.cha,
        armor_class: character.armor_class,
        speed: character.speed,
        alignment: character.alignment,
        notes: character.notes,
      });
    }
  }, [character, editingCore]);

  const updateCharacterMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api.patch<{ character: Character }>(`/characters/${characterId}`, patch),
    onSuccess: (data) => {
      queryClient.setQueryData(['character', characterId], data);
      setEditingCore(false);
    },
  });

  const hpMutation = useMutation({
    mutationFn: (input: { delta: number; tempDelta: number }) =>
      api.patch<{ character: Character }>(`/characters/${characterId}/hp`, input),
    onSuccess: (data) => {
      queryClient.setQueryData(['character', characterId], data);
    },
  });

  const skillsMutation = useMutation({
    mutationFn: (rows: Array<{ skillId: number; level: SkillProficiencyLevel }>) =>
      api.put<{ skillProficiencies: SkillProficiency[] }>(`/characters/${characterId}/skill-proficiencies`, rows),
    onSuccess: (data) => {
      queryClient.setQueryData(['character', characterId, 'skill-proficiencies'], data);
    },
  });

  const savingThrowsMutation = useMutation({
    mutationFn: (rows: Array<{ abilityScoreId: number }>) =>
      api.put<{ savingThrowProficiencies: SavingThrowProficiency[] }>(
        `/characters/${characterId}/saving-throw-proficiencies`,
        rows,
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['character', characterId, 'saving-throw-proficiencies'], data);
    },
  });

  const classesMutation = useMutation({
    mutationFn: (rows: Array<{ classId: number; subclassId: number | null; level: number }>) =>
      api.put<{ classes: CharacterClass[] }>(`/characters/${characterId}/classes`, rows),
    onSuccess: (data) => {
      queryClient.setQueryData(['character', characterId, 'classes'], data);
      // Spell slots are a computed cache off character_classes (services/
      // spellSlots.ts) — refresh resources so SpellcastingPanel's slot
      // tracker picks up the recomputed spell_slot_N/warlock_pact_slot_N rows.
      void queryClient.invalidateQueries({ queryKey: ['character', characterId, 'resources'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete<void>(`/characters/${characterId}`),
    onSuccess: () => navigate(`/campaigns/${campaignId}/characters`),
  });

  // POST /campaigns/:id/assets's response is only the new asset row — the
  // portrait_asset_id FK write-back on `characters` happens server-side in
  // the same transaction (services/assets.ts's createAsset) but isn't echoed
  // back on this response. Rather than an extra invalidate+refetch round
  // trip, patch both caches directly: we know exactly which character this
  // upload targeted (this component only ever uploads for `characterId`), so
  // the new portrait_asset_id is deterministically `asset.id`, and the asset
  // itself is prepended into the assets list cache so Portrait resolves it
  // immediately without waiting on a refetch.
  function handlePortraitUploaded(asset: CampaignAsset) {
    queryClient.setQueryData<{ assets: CampaignAsset[] }>(['campaign', campaignId, 'assets'], (prev) =>
      prev ? { assets: [asset, ...prev.assets.filter((a) => a.id !== asset.id)] } : { assets: [asset] },
    );
    queryClient.setQueryData<{ character: Character }>(['character', characterId], (prev) =>
      prev ? { character: { ...prev.character, portrait_asset_id: asset.id } } : prev,
    );
  }

  if (characterQuery.isLoading) return <Loading label="Loading character…" />;
  if (characterQuery.isError) return <ErrorBanner message={errorMessage(characterQuery.error)} />;
  if (!character || !coreDraft) return null;

  const totalLevel = classesQuery.data?.classes.reduce((sum, r) => sum + r.level, 0) || 1;
  const proficiencyBonus = proficiencyBonusForLevel(totalLevel);

  const proficientAbilityScoreIds = new Set(
    (savingThrowsQuery.data?.savingThrowProficiencies ?? []).map((r) => r.ability_score_id),
  );
  const skillProficiencyMap = new Map<number, ProficiencyLevel>(
    (skillProficienciesQuery.data?.skillProficiencies ?? []).map((r) => [r.skill_id, r.level]),
  );

  const raceName = racesCatalog.data?.races.find((r) => r.id === character.race_id)?.name;
  const backgroundName = backgroundsCatalog.data?.backgrounds.find((b) => b.id === character.background_id)?.name;
  const portraitAsset = assetsQuery.data?.assets.find((a) => a.id === character.portrait_asset_id);

  function toggleSavingThrow(abilityScoreId: number) {
    const next = new Set(proficientAbilityScoreIds);
    if (next.has(abilityScoreId)) next.delete(abilityScoreId);
    else next.add(abilityScoreId);
    savingThrowsMutation.mutate([...next].map((id) => ({ abilityScoreId: id })));
  }

  function changeSkill(skillId: number, next: ProficiencyLevel) {
    const map = new Map(skillProficiencyMap);
    if (next === 'none') map.delete(skillId);
    else map.set(skillId, next);
    skillsMutation.mutate(
      [...map.entries()].map(([id, level]) => ({ skillId: id, level: level as SkillProficiencyLevel })),
    );
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-4xl mx-auto space-y-6">
      <header className="rounded-md bg-stone-900 shadow-sm p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-4">
            <div className="flex flex-col items-center gap-2">
              <Portrait
                fileUrl={portraitAsset?.file_url}
                alt={`${character.name} portrait`}
                size="lg"
                shape="circle"
                placeholderLabel={character.name}
              />
              {editable && (
                <ImageUploadField
                  campaignId={campaignId}
                  characterId={characterId}
                  title={`${character.name} portrait`}
                  onUploaded={handlePortraitUploaded}
                  label={portraitAsset ? 'Change' : 'Upload'}
                />
              )}
            </div>
            <div>
              <h2 className="text-xl font-semibold text-stone-100">{character.name}</h2>
              <p className="text-sm text-stone-400">
                {character.is_pc ? 'Player character' : 'NPC'}
                {raceName ? ` · ${raceName}` : ''}
                {backgroundName ? ` · ${backgroundName}` : ''}
                {character.alignment ? ` · ${character.alignment}` : ''}
              </p>
              {!character.is_alive && <p className="text-red-400 text-sm font-semibold mt-1">Deceased</p>}
            </div>
          </div>
          {editMode === 'edit-full' && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete ${character.name}? This cannot be undone.`)) deleteMutation.mutate();
              }}
              className="text-xs text-red-400 hover:text-red-300 border border-red-900 rounded-md px-2 py-1"
            >
              Delete
            </button>
          )}
        </div>
      </header>

      {/* HP panel */}
      <section className="rounded-md bg-stone-900 shadow-sm p-4 sm:p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500 mb-3">Hit points</h3>
        <HPBar current={character.hp_current} max={character.hp_max} temp={character.hp_temp} />
        {editable && (
          <HpAdjustForm
            disabled={hpMutation.isPending}
            onApply={(delta, tempDelta) => hpMutation.mutate({ delta, tempDelta })}
          />
        )}
        {hpMutation.isError && <ErrorBanner message={errorMessage(hpMutation.error)} />}
      </section>

      {/* Core stats */}
      <section className="rounded-md bg-stone-900 shadow-sm p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Ability scores</h3>
          {editable && !editingCore && (
            <button
              type="button"
              onClick={() => setEditingCore(true)}
              className="text-xs text-amber-500 hover:text-amber-400"
            >
              Edit
            </button>
          )}
        </div>
        <AbilityScoreGrid
          scores={coreDraft}
          editable={editingCore}
          onChange={(key, value) => setCoreDraft((d) => (d ? { ...d, [key]: value } : d))}
        />
        <div className="grid grid-cols-2 gap-4 mt-4 max-w-xs">
          <div>
            <label className="block text-xs text-stone-500 mb-1">Armor Class</label>
            {character.armor_class_mode === 'auto' ? (
              <div className="flex items-center gap-1.5">
                <span className="text-lg font-semibold text-stone-100">{character.armor_class}</span>
                <span className="text-[10px] uppercase text-stone-500">(auto)</span>
              </div>
            ) : editingCore ? (
              <input
                type="number"
                value={coreDraft.armor_class}
                onChange={(e) => setCoreDraft((d) => (d ? { ...d, armor_class: Number(e.target.value) } : d))}
                className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-stone-100"
              />
            ) : (
              <div className="text-lg font-semibold text-stone-100">{character.armor_class}</div>
            )}
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Speed</label>
            {editingCore ? (
              <input
                type="number"
                value={coreDraft.speed}
                onChange={(e) => setCoreDraft((d) => (d ? { ...d, speed: Number(e.target.value) } : d))}
                className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-stone-100"
              />
            ) : (
              <div className="text-lg font-semibold text-stone-100">{character.speed} ft.</div>
            )}
          </div>
        </div>
        {editingCore && (
          <div className="flex gap-2 mt-4">
            <button
              type="button"
              disabled={updateCharacterMutation.isPending}
              onClick={() =>
                updateCharacterMutation.mutate({
                  str: coreDraft.str,
                  dex: coreDraft.dex,
                  con: coreDraft.con,
                  int: coreDraft.int,
                  wis: coreDraft.wis,
                  cha: coreDraft.cha,
                  // Server already silently drops armorClass while
                  // armor_class_mode='auto' (auto is authoritative), but
                  // omit it client-side too so a stale draft number is never
                  // even sent.
                  ...(character.armor_class_mode === 'manual' ? { armorClass: coreDraft.armor_class } : {}),
                  speed: coreDraft.speed,
                  alignment: coreDraft.alignment,
                  notes: coreDraft.notes,
                })
              }
              className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-sm"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditingCore(false)}
              className="rounded-md border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800"
            >
              Cancel
            </button>
          </div>
        )}
        {updateCharacterMutation.isError && <ErrorBanner message={errorMessage(updateCharacterMutation.error)} />}
      </section>

      <div className="grid sm:grid-cols-2 gap-6">
        {abilityScoresCatalog.data && (
          <SavingThrowsPanel
            abilityScoresCatalog={abilityScoresCatalog.data.abilityScores}
            abilities={character}
            proficientAbilityScoreIds={proficientAbilityScoreIds}
            proficiencyBonus={proficiencyBonus}
            editable={editable}
            onToggle={toggleSavingThrow}
            characterId={characterId}
          />
        )}

        {classesCatalog.data && classesQuery.data && (
          <ClassSummaryPanel
            classesCatalog={classesCatalog.data.classes}
            subclassesCatalog={subclassesCatalog.data?.subclasses ?? []}
            classRows={classesQuery.data.classes}
            editable={editable}
            saving={classesMutation.isPending}
            onSave={(rows) =>
              classesMutation.mutateAsync(
                rows.map((r) => ({ classId: r.classId, subclassId: r.subclassId, level: r.level })),
              )
            }
          />
        )}
      </div>

      {skillsCatalog.data && abilityScoresCatalog.data && (
        <SkillsPanel
          skillsCatalog={skillsCatalog.data.skills}
          abilityScoresCatalog={abilityScoresCatalog.data.abilityScores}
          abilities={character}
          proficiencyBySkillId={skillProficiencyMap}
          proficiencyBonus={proficiencyBonus}
          editable={editable}
          onChange={changeSkill}
          characterId={characterId}
        />
      )}

      {classesCatalog.data && (
        <SpellcastingPanel
          characterId={characterId}
          edition={campaign.srd_edition}
          characterClasses={classesQuery.data?.classes ?? []}
          classesCatalog={classesCatalog.data.classes}
          editable={editable}
        />
      )}

      <CharacterAttacksPanel characterId={characterId} editable={editable} />

      <InventoryPanel
        characterId={characterId}
        edition={campaign.srd_edition}
        editable={editable}
        str={character.str}
        dex={character.dex}
        level={totalLevel}
        armorClass={character.armor_class}
        armorClassMode={character.armor_class_mode}
      />

      <ResourcePoolPanel characterId={characterId} campaignId={campaignId} editable={editable} isDm={role === 'dm'} />

      <CharacterEffectsPanel characterId={characterId} campaignId={campaignId} isDm={role === 'dm'} />

      <section className="rounded-md bg-stone-900 shadow-sm p-4 sm:p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500 mb-2">Notes</h3>
        {editingCore ? (
          <textarea
            rows={4}
            value={coreDraft.notes ?? ''}
            onChange={(e) => setCoreDraft((d) => (d ? { ...d, notes: e.target.value } : d))}
            className="w-full rounded-md bg-stone-800 border border-stone-700 px-3 py-2 text-stone-100 text-sm"
          />
        ) : (
          <p className="text-sm text-stone-300 whitespace-pre-wrap">{character.notes || '—'}</p>
        )}
      </section>
    </div>
  );
}
