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
import { useCharacterEditMode, useCharacterCanAct } from './useCharacterEditMode';
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
import { formatDistance } from '../lib/units';
import { SavingThrowsPanel } from './SavingThrowsPanel';
import { SkillsPanel } from './SkillsPanel';
import { ClassSummaryPanel } from './ClassSummaryPanel';
import { SpellcastingPanel } from './SpellcastingPanel';
import { InventoryPanel } from './InventoryPanel';
import { CharacterAttacksPanel } from './CharacterAttacksPanel';
import { ResourcePoolPanel } from './ResourcePoolPanel';
import { CurrencyPanel } from './CurrencyPanel';
import { CharacterEffectsPanel } from './CharacterEffectsPanel';
import { Loading, ErrorBanner, errorMessage } from '../components/Feedback';
import { proficiencyBonusForLevel } from '../lib/dnd-math';
import type { ProficiencyLevel } from '../components/ProficiencyToggle';
import { isUuid } from '../lib/ids';
import { formatTimestamp } from '../lib/dates';
import { useLocale } from '../i18n/LocaleContext';
import { useBreadcrumb } from '../components/layout/BreadcrumbContext';
import { BackButton } from '../components/layout/BackButton';

export function CharacterSheetPage() {
  const params = useParams<{ characterId: string }>();
  const characterId = params.characterId ?? '';
  const { campaignId, campaign, role } = useCampaignShell();
  const { user } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const characterQuery = useQuery({
    queryKey: ['character', characterId],
    queryFn: () => api.get<{ character: Character }>(`/characters/${characterId}`),
    enabled: isUuid(characterId),
  });

  const classesQuery = useQuery({
    queryKey: ['character', characterId, 'classes'],
    queryFn: () => api.get<{ classes: CharacterClass[] }>(`/characters/${characterId}/classes`),
    enabled: isUuid(characterId),
  });

  const skillProficienciesQuery = useQuery({
    queryKey: ['character', characterId, 'skill-proficiencies'],
    queryFn: () => api.get<{ skillProficiencies: SkillProficiency[] }>(`/characters/${characterId}/skill-proficiencies`),
    enabled: isUuid(characterId),
  });

  const savingThrowsQuery = useQuery({
    queryKey: ['character', characterId, 'saving-throw-proficiencies'],
    queryFn: () =>
      api.get<{ savingThrowProficiencies: SavingThrowProficiency[] }>(
        `/characters/${characterId}/saving-throw-proficiencies`,
      ),
    enabled: isUuid(characterId),
  });

  // GET /characters/:id only returns the raw portrait_asset_id FK (no joined
  // file_url — see services/characters.ts's getCharacter, a plain `SELECT *`
  // spread), so resolving it to a displayable URL means fetching the
  // campaign's asset list separately and looking the id up client-side,
  // rather than the server doing the join.
  const assetsQuery = useQuery({
    queryKey: ['campaign', campaignId, 'assets'],
    queryFn: () => api.get<{ assets: CampaignAsset[] }>(`/campaigns/${campaignId}/assets`),
    enabled: isUuid(campaignId),
  });

  const abilityScoresCatalog = useAbilityScoresCatalog();
  const skillsCatalog = useSkillsCatalog();
  const racesCatalog = useRacesCatalog(campaign.srd_edition);
  const backgroundsCatalog = useBackgroundsCatalog(campaign.srd_edition);
  const classesCatalog = useClassesCatalog(campaign.srd_edition);
  const subclassesCatalog = useSubclassesCatalog(campaign.srd_edition);

  const character = characterQuery.data?.character;
  useBreadcrumb(2, character ? [{ label: character.name }] : []);
  const editMode = useCharacterEditMode(character, role, user?.id);
  const editable = editMode !== 'read';
  // Separate CONTROL gate (delegated controller, not just the owner/DM) for
  // "act right now" controls — see useCharacterCanAct's own comment.
  const canAct = useCharacterCanAct(character, role, user?.id);

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

  // Iteration 2's one concrete GM-only field — its own mutation (not
  // updateCharacterMutation above) so saving it never incidentally closes an
  // in-progress ability-score edit via that mutation's setEditingCore(false).
  const [gmNotesDraft, setGmNotesDraft] = useState('');
  // M9 fix: this reset effect had no "I'm mid-edit" guard, unlike the
  // adjacent coreDraft effect above (which correctly checks !editingCore) —
  // any sibling mutation on this page that refreshed the character cache
  // (HP adjust, item toggle, ...) silently wiped an in-progress, unsaved GM
  // note. Same guard shape as coreDraft/editingCore.
  const [editingGmNotes, setEditingGmNotes] = useState(false);
  useEffect(() => {
    if (!editingGmNotes) setGmNotesDraft(character?.gm_notes ?? '');
  }, [character?.gm_notes, editingGmNotes]);
  const gmNotesMutation = useMutation({
    mutationFn: (gmNotes: string) => api.patch<{ character: Character }>(`/characters/${characterId}`, { gmNotes }),
    onSuccess: (data) => {
      queryClient.setQueryData(['character', characterId], data);
    },
  });

  // Phase 3 "NPC 'what they want' field" — same isolated-mutation/edit-guard
  // shape as gmNotes above, and the same reason: must not get silently
  // clobbered by an unrelated sibling mutation refreshing the character cache
  // mid-edit.
  const [npcMotivationDraft, setNpcMotivationDraft] = useState('');
  const [editingNpcMotivation, setEditingNpcMotivation] = useState(false);
  useEffect(() => {
    if (!editingNpcMotivation) setNpcMotivationDraft(character?.npc_motivation ?? '');
  }, [character?.npc_motivation, editingNpcMotivation]);
  const npcMotivationMutation = useMutation({
    mutationFn: (npcMotivation: string) => api.patch<{ character: Character }>(`/characters/${characterId}`, { npcMotivation }),
    onSuccess: (data) => {
      queryClient.setQueryData(['character', characterId], data);
    },
  });

  // DM hide/reveal for NPCs — own mutation for the same reason as
  // npcMotivationMutation above (never closes an in-progress core-stats
  // edit). services/characters.ts's requireCharacterVisible is the
  // server-side enforcement this drives.
  const npcVisibilityMutation = useMutation({
    mutationFn: (visibleToPlayers: boolean) => api.patch<{ character: Character }>(`/characters/${characterId}`, { visibleToPlayers }),
    onSuccess: (data) => {
      queryClient.setQueryData(['character', characterId], data);
    },
  });

  const skillsMutation = useMutation({
    mutationFn: (rows: Array<{ skillId: string; level: SkillProficiencyLevel }>) =>
      api.put<{ skillProficiencies: SkillProficiency[] }>(`/characters/${characterId}/skill-proficiencies`, rows),
    onSuccess: (data) => {
      queryClient.setQueryData(['character', characterId, 'skill-proficiencies'], data);
    },
  });

  const savingThrowsMutation = useMutation({
    mutationFn: (rows: Array<{ abilityScoreId: string }>) =>
      api.put<{ savingThrowProficiencies: SavingThrowProficiency[] }>(
        `/characters/${characterId}/saving-throw-proficiencies`,
        rows,
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['character', characterId, 'saving-throw-proficiencies'], data);
    },
  });

  const classesMutation = useMutation({
    mutationFn: (rows: Array<{ classId: string; subclassId: string | null; level: number }>) =>
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

  const duplicateMutation = useMutation({
    mutationFn: () => api.post<{ character: Character }>(`/characters/${characterId}/duplicate`, {}),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['characters', campaignId] });
      navigate(`/campaigns/${campaignId}/characters/${data.character.id}`);
    },
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

  if (characterQuery.isLoading) return <Loading label={t('characters.sheet.loadingCharacter')} />;
  if (characterQuery.isError) return <ErrorBanner message={errorMessage(characterQuery.error)} />;
  if (!character || !coreDraft) return null;

  const totalLevel = classesQuery.data?.classes.reduce((sum, r) => sum + r.level, 0) || 1;
  const proficiencyBonus = proficiencyBonusForLevel(totalLevel);

  const proficientAbilityScoreIds = new Set(
    (savingThrowsQuery.data?.savingThrowProficiencies ?? []).map((r) => r.ability_score_id),
  );
  const skillProficiencyMap = new Map<string, ProficiencyLevel>(
    (skillProficienciesQuery.data?.skillProficiencies ?? []).map((r) => [r.skill_id, r.level]),
  );

  const raceName = racesCatalog.data?.races.find((r) => r.id === character.race_id)?.name;
  const backgroundName = backgroundsCatalog.data?.backgrounds.find((b) => b.id === character.background_id)?.name;
  const portraitAsset = assetsQuery.data?.assets.find((a) => a.id === character.portrait_asset_id);

  function toggleSavingThrow(abilityScoreId: string) {
    const next = new Set(proficientAbilityScoreIds);
    if (next.has(abilityScoreId)) next.delete(abilityScoreId);
    else next.add(abilityScoreId);
    savingThrowsMutation.mutate([...next].map((id) => ({ abilityScoreId: id })));
  }

  function changeSkill(skillId: string, next: ProficiencyLevel) {
    const map = new Map(skillProficiencyMap);
    if (next === 'none') map.delete(skillId);
    else map.set(skillId, next);
    skillsMutation.mutate(
      [...map.entries()].map(([id, level]) => ({ skillId: id, level: level as SkillProficiencyLevel })),
    );
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-4xl mx-auto space-y-6">
      <BackButton to={`/campaigns/${campaignId}/characters`} label={t('nav.characters')} />
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
                  label={portraitAsset ? t('characters.sheet.changePortrait') : t('characters.sheet.uploadPortrait')}
                />
              )}
            </div>
            <div>
              <h2 className="text-xl font-semibold text-stone-100">{character.name}</h2>
              <p className="text-sm text-stone-400">
                {character.is_pc ? t('characters.common.playerCharacter') : t('characters.common.npc')}
                {raceName ? ` · ${raceName}` : ''}
                {backgroundName ? ` · ${backgroundName}` : ''}
                {character.alignment ? ` · ${character.alignment}` : ''}
              </p>
              {!character.is_alive && <p className="text-red-400 text-sm font-semibold mt-1">{t('characters.common.deceased')}</p>}
              <p className="text-xs text-stone-500 mt-1">
                {t('characters.sheet.createdUpdated', {
                  created: formatTimestamp(character.created_at),
                  updated: formatTimestamp(character.updated_at),
                })}
              </p>
            </div>
          </div>
          {/* Resolved decision (Iteration 3 plan): relax to match the server's
              own owner-or-DM authorization (authorizeCharacterMutation) —
              editMode === 'edit-full' used to hide these from a player who
              owns this PC, even though the server has always allowed the
              owner to duplicate/delete their own character. */}
          {editable && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => duplicateMutation.mutate()}
                disabled={duplicateMutation.isPending}
                className="text-xs text-stone-300 hover:text-stone-100 border border-stone-700 rounded-md px-2 py-1 disabled:opacity-50"
              >
                {duplicateMutation.isPending ? t('characters.sheet.duplicating') : t('characters.sheet.duplicate')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(t('characters.sheet.confirmDelete', { name: character.name }))) deleteMutation.mutate();
                }}
                className="text-xs text-red-400 hover:text-red-300 border border-red-900 rounded-md px-2 py-1"
              >
                {t('common.delete')}
              </button>
            </div>
          )}
        </div>
        {duplicateMutation.isError && <ErrorBanner message={errorMessage(duplicateMutation.error)} />}
      </header>

      {/* HP panel */}
      <section className="rounded-md bg-stone-900 shadow-sm p-4 sm:p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500 mb-3">{t('characters.sheet.hitPoints')}</h3>
        <HPBar current={character.hp_current} max={character.hp_max} temp={character.hp_temp} size="large" />
        {canAct && (
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
          <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{t('characters.sheet.abilityScores')}</h3>
          {editable && !editingCore && (
            <button
              type="button"
              onClick={() => setEditingCore(true)}
              className="text-xs text-amber-500 hover:text-amber-400"
            >
              {t('common.edit')}
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
            <label className="block text-xs text-stone-500 mb-1">{t('characters.common.armorClass')}</label>
            {character.armor_class_mode === 'auto' ? (
              <div className="flex items-center gap-1.5">
                <span className="font-mono font-bold text-xl text-stone-100 tabular-nums">{character.armor_class}</span>
                <span className="text-[10px] uppercase text-stone-500">{t('characters.sheet.autoLabel')}</span>
              </div>
            ) : editingCore ? (
              <input
                type="number"
                value={coreDraft.armor_class}
                onChange={(e) => setCoreDraft((d) => (d ? { ...d, armor_class: Number(e.target.value) } : d))}
                className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-stone-100 font-mono"
              />
            ) : (
              <div className="font-mono font-bold text-xl text-stone-100 tabular-nums">{character.armor_class}</div>
            )}
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">{t('characters.sheet.speed')}</label>
            {editingCore ? (
              <input
                type="number"
                value={coreDraft.speed}
                onChange={(e) => setCoreDraft((d) => (d ? { ...d, speed: Number(e.target.value) } : d))}
                className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-stone-100 font-mono"
              />
            ) : (
              <div className="font-mono font-bold text-xl text-stone-100 tabular-nums">
                {formatDistance(character.speed, user?.unitSystem ?? 'imperial', t)}
              </div>
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
              {t('common.save')}
            </button>
            <button
              type="button"
              onClick={() => setEditingCore(false)}
              className="rounded-md border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800"
            >
              {t('common.cancel')}
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
            // M8: disabled while the previous toggle's PUT is still in
            // flight — the toggle handlers below build their next-state
            // payload from the query cache, which is still stale mid-request,
            // so a second rapid toggle would silently overwrite the first
            // (lost update) rather than compound with it.
            editable={editable && !savingThrowsMutation.isPending}
            canAct={canAct}
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
          // M8: same lost-update guard as SavingThrowsPanel above.
          editable={editable && !skillsMutation.isPending}
          canAct={canAct}
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
          canAct={canAct}
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

      <CurrencyPanel characterId={characterId} editable={editable} />

      <ResourcePoolPanel characterId={characterId} campaignId={campaignId} editable={canAct} isDm={role === 'dm'} />

      <CharacterEffectsPanel characterId={characterId} campaignId={campaignId} isDm={role === 'dm'} />

      <section className="rounded-md bg-stone-900 shadow-sm p-4 sm:p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500 mb-2">{t('characters.sheet.notes')}</h3>
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

      {role === 'dm' && (
        <section className="rounded-md bg-stone-900 shadow-sm p-4 sm:p-5 border border-violet-900/40">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-violet-400 mb-2">{t('characters.sheet.gmNotesTitle')}</h3>
          <p className="text-xs text-stone-500 mb-2">{t('characters.sheet.gmNotesHint')}</p>
          <textarea
            rows={4}
            value={gmNotesDraft}
            onFocus={() => setEditingGmNotes(true)}
            onChange={(e) => setGmNotesDraft(e.target.value)}
            onBlur={() => {
              setEditingGmNotes(false);
              if (gmNotesDraft !== (character.gm_notes ?? '')) gmNotesMutation.mutate(gmNotesDraft);
            }}
            className="w-full rounded-md bg-stone-800 border border-violet-900/60 px-3 py-2 text-stone-100 text-sm"
          />
          {gmNotesMutation.isError && <ErrorBanner message={errorMessage(gmNotesMutation.error)} />}
        </section>
      )}

      {role === 'dm' && !character.is_pc && (
        <section className="rounded-md bg-stone-900 shadow-sm p-4 sm:p-5 border border-violet-900/40">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-violet-400">{t('characters.sheet.npcMotivationTitle')}</h3>
            <div className="flex items-center gap-2">
              {!character.visible_to_players && (
                <span className="rounded-full border border-red-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
                  {t('characters.list.hiddenBadge')}
                </span>
              )}
              <button
                type="button"
                onClick={() => npcVisibilityMutation.mutate(!character.visible_to_players)}
                disabled={npcVisibilityMutation.isPending}
                className="rounded border border-stone-700 text-stone-300 hover:bg-stone-800 disabled:opacity-45 px-2 py-1 text-[11px] font-semibold"
              >
                {character.visible_to_players ? t('characters.list.toggleToHidden') : t('characters.list.toggleToRevealed')}
              </button>
            </div>
          </div>
          {npcVisibilityMutation.isError && <ErrorBanner message={errorMessage(npcVisibilityMutation.error)} />}
          <p className="text-xs text-stone-500 mb-2">{t('characters.sheet.npcMotivationHint')}</p>
          <textarea
            rows={2}
            value={npcMotivationDraft}
            onFocus={() => setEditingNpcMotivation(true)}
            onChange={(e) => setNpcMotivationDraft(e.target.value)}
            onBlur={() => {
              setEditingNpcMotivation(false);
              if (npcMotivationDraft !== (character.npc_motivation ?? '')) npcMotivationMutation.mutate(npcMotivationDraft);
            }}
            className="w-full rounded-md bg-stone-800 border border-violet-900/60 px-3 py-2 text-stone-100 text-sm"
          />
          {npcMotivationMutation.isError && <ErrorBanner message={errorMessage(npcMotivationMutation.error)} />}
        </section>
      )}
    </div>
  );
}
