// Multi-step character creation (identity -> ability scores -> derived
// stats -> skills -> feats -> equipment/notes -> portrait). Sits alongside
// CharactersListPage.tsx's existing inline quick-create form (kept as-is,
// the fast NPC path) rather than replacing it.
//
// Submission strategy: everything through Equipment is purely local draft
// state — nothing is server-authoritative pre-creation. The REAL character
// row is created at the Equipment->Portrait transition specifically (not at
// a final "Finish" click): the portrait step needs a real characterId to
// attach an upload to (services/assets.ts auto-links portrait_asset_id as a
// side effect of an upload whose body includes characterId — there is no
// separate "PATCH the character with an asset id" endpoint), so character
// creation has to happen before that step is usable. Once
// draft.createdCharacterId is set, every earlier step becomes read-only —
// further edits belong on the normal CharacterSheetPage, not this wizard.
//
// If the initial POST /campaigns/:id/characters itself fails, nothing was
// created — the error is shown and the button stays retry-able. If a LATER
// step in the sequence fails (classes/proficiencies/an item POST), the
// character row already exists, so rather than attempting any rollback this
// surfaces "created, but N step(s) failed" with a link to the real
// CharacterSheetPage to finish manually, and still advances to Portrait
// (blocking further progress on a row that already exists would trap the
// user for no benefit).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Character, CampaignAsset, CampaignMember } from '../../lib/types';
import { useAuth } from '../../auth/AuthContext';
import { useCampaignShell } from '../../campaigns/CampaignShell';
import { useLocale } from '../../i18n/LocaleContext';
import { useRacesCatalog, useSubracesCatalog, useBackgroundsCatalog, useClassesCatalog } from '../../lib/useCatalog';
import { applyAbilityBonuses } from '../deriveAbilityBonuses';
import { Loading, ErrorBanner, errorMessage } from '../../components/Feedback';
import { Button, ButtonLink } from '../../components/ui/Button';
import { emptyWizardDraft, WIZARD_STEP_IDS, type WizardDraft } from './types';
import { validateIdentity, validateAbilityScores, validateDerivedStats, validateSkills, validateFeats, validateEquipment, validatePortrait, type StepValidation } from './validation';
import { WizardStepNav } from './WizardStepNav';
import { LivePreviewPanel } from './LivePreviewPanel';
import { IdentityStep } from './IdentityStep';
import { AbilityScoresStep } from './AbilityScoresStep';
import { DerivedStatsStep } from './DerivedStatsStep';
import { SkillsStep } from './SkillsStep';
import { FeatsStep } from './FeatsStep';
import { EquipmentStep } from './EquipmentStep';
import { PortraitStep } from './PortraitStep';

const VALIDATORS = [validateIdentity, validateAbilityScores, validateDerivedStats, validateSkills, validateFeats, validateEquipment, validatePortrait];
const EQUIPMENT_STEP_INDEX = WIZARD_STEP_IDS.indexOf('equipment');
const PORTRAIT_STEP_INDEX = WIZARD_STEP_IDS.indexOf('portrait');

interface SubmitResult {
  characterId: string;
  warnings: string[];
}

export function CharacterCreationWizard() {
  const { campaignId, campaign, role } = useCampaignShell();
  const { user } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<WizardDraft>(() =>
    emptyWizardDraft({ isPc: true, ownerUserId: role === 'player' ? (user?.id ?? '') : '' }),
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [furthestIndexReached, setFurthestIndexReached] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [portraitFileUrl, setPortraitFileUrl] = useState<string | null>(null);

  const edition = campaign.srd_edition;
  const membersQuery = useQuery({
    queryKey: ['campaignMembers', campaignId],
    queryFn: () => api.get<{ members: CampaignMember[] }>(`/campaigns/${campaignId}/members`),
  });
  const racesQuery = useRacesCatalog(edition);
  const subracesQuery = useSubracesCatalog(edition);
  const backgroundsQuery = useBackgroundsCatalog(edition);
  const classesQuery = useClassesCatalog(edition);

  function updateDraft(patch: Partial<WizardDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  const submitMutation = useMutation({
    mutationFn: async (): Promise<SubmitResult> => {
      // characters.str/dex/... stores one final value with no separate base
      // column — race/subrace ability bonuses are applied here, once, at
      // submission time, not just previewed in DerivedStatsStep.
      const selectedRace = racesQuery.data?.races.find((r) => r.id === draft.raceId) ?? null;
      const selectedSubrace = subracesQuery.data?.subraces.find((s) => s.id === draft.subraceId) ?? null;
      const finalScores = applyAbilityBonuses(draft.scores, selectedRace, selectedSubrace);

      const created = await api.post<{ character: Character }>(`/campaigns/${campaignId}/characters`, {
        name: draft.name,
        isPc: draft.isPc,
        ownerUserId: role === 'player' ? user!.id : draft.isPc ? draft.ownerUserId || undefined : undefined,
        raceId: draft.raceId || undefined,
        subraceId: draft.subraceId || undefined,
        backgroundId: draft.backgroundId || undefined,
        alignment: draft.alignment || undefined,
        str: finalScores.str,
        dex: finalScores.dex,
        con: finalScores.con,
        int: finalScores.int,
        wis: finalScores.wis,
        cha: finalScores.cha,
        armorClass: draft.armorClass,
        hpMax: draft.hpMax,
        notes: draft.notes || undefined,
      });
      const characterId = created.character.id;
      const stepWarnings: string[] = [];

      if (draft.classId) {
        try {
          await api.put(`/characters/${characterId}/classes`, [
            { classId: draft.classId, subclassId: draft.subclassId || undefined, level: draft.level },
          ]);
        } catch (err) {
          stepWarnings.push(t('characters.wizard.submit.classesFailed', { message: errorMessage(err) }));
        }
      }

      const skillEntries = Object.entries(draft.skillLevels);
      if (skillEntries.length > 0) {
        try {
          await api.put(
            `/characters/${characterId}/skill-proficiencies`,
            skillEntries.map(([skillId, level]) => ({ skillId, level })),
          );
        } catch (err) {
          stepWarnings.push(t('characters.wizard.submit.skillsFailed', { message: errorMessage(err) }));
        }
      }

      if (draft.savingThrowAbilityScoreIds.length > 0) {
        try {
          await api.put(
            `/characters/${characterId}/saving-throw-proficiencies`,
            draft.savingThrowAbilityScoreIds.map((abilityScoreId) => ({ abilityScoreId })),
          );
        } catch (err) {
          stepWarnings.push(t('characters.wizard.submit.savesFailed', { message: errorMessage(err) }));
        }
      }

      for (const featId of draft.featIds) {
        try {
          await api.post(`/characters/${characterId}/feats`, { featId });
        } catch (err) {
          stepWarnings.push(t('characters.wizard.submit.featFailed', { message: errorMessage(err) }));
        }
      }

      for (const pick of draft.equipment) {
        try {
          await api.post(`/characters/${characterId}/items`, {
            itemId: pick.itemId,
            quantity: pick.quantity,
            isEquipped: false,
            isAttuned: false,
            customName: null,
          });
        } catch (err) {
          stepWarnings.push(t('characters.wizard.submit.itemFailed', { name: pick.name, message: errorMessage(err) }));
        }
      }

      return { characterId, warnings: stepWarnings };
    },
    onSuccess: (result) => {
      updateDraft({ createdCharacterId: result.characterId });
      setWarnings(result.warnings);
      void queryClient.invalidateQueries({ queryKey: ['characters', campaignId] });
      goToStep(PORTRAIT_STEP_INDEX);
    },
  });

  function goToStep(index: number) {
    setStepIndex(index);
    setFurthestIndexReached((f) => Math.max(f, index));
  }

  function handleNext() {
    if (stepIndex === EQUIPMENT_STEP_INDEX && draft.createdCharacterId === null) {
      submitMutation.mutate();
      return;
    }
    goToStep(Math.min(stepIndex + 1, WIZARD_STEP_IDS.length - 1));
  }

  function handleBack() {
    goToStep(Math.max(stepIndex - 1, 0));
  }

  // Mirrors CharacterSheetPage.handlePortraitUploaded: POST /assets's
  // response doesn't echo the portrait_asset_id write-back that
  // services/assets.ts's createAsset performs server-side, and the shared
  // ['campaign', campaignId, 'assets'] cache key can still be "fresh" (10s
  // staleTime) from another page in the same campaign, so without this patch
  // the character sheet the user lands on after Finish can render the
  // placeholder instead of the just-uploaded portrait.
  function handlePortraitUploaded(asset: CampaignAsset) {
    updateDraft({ portraitAssetId: asset.id });
    setPortraitFileUrl(asset.file_url);
    queryClient.setQueryData<{ assets: CampaignAsset[] }>(['campaign', campaignId, 'assets'], (prev) =>
      prev ? { assets: [asset, ...prev.assets.filter((a) => a.id !== asset.id)] } : { assets: [asset] },
    );
    if (draft.createdCharacterId) {
      queryClient.setQueryData<{ character: Character }>(['character', draft.createdCharacterId], (prev) =>
        prev ? { character: { ...prev.character, portrait_asset_id: asset.id } } : prev,
      );
    }
  }

  if (membersQuery.isLoading || racesQuery.isLoading || subracesQuery.isLoading || backgroundsQuery.isLoading || classesQuery.isLoading) {
    return <Loading />;
  }

  const validations: StepValidation[] = VALIDATORS.map((fn) => fn(draft));
  const currentValidation = validations[stepIndex]!;
  const invalidIndices = new Set(validations.map((v, i) => (v.valid ? -1 : i)).filter((i) => i >= 0));
  const readOnly = draft.createdCharacterId !== null && stepIndex <= EQUIPMENT_STEP_INDEX;
  const isLastStep = stepIndex === WIZARD_STEP_IDS.length - 1;

  const players = (membersQuery.data?.members ?? []).filter((m) => m.role === 'player');
  const selectedRace = racesQuery.data?.races.find((r) => r.id === draft.raceId) ?? null;
  const selectedSubrace = subracesQuery.data?.subraces.find((s) => s.id === draft.subraceId) ?? null;
  const raceName = selectedRace?.name ?? null;
  const backgroundName = backgroundsQuery.data?.backgrounds.find((b) => b.id === draft.backgroundId)?.name ?? null;
  const selectedClass = classesQuery.data?.classes.find((c) => c.id === draft.classId) ?? null;

  const stepLabels = [
    t('characters.wizard.steps.identity'),
    t('characters.wizard.steps.abilityScores'),
    t('characters.wizard.steps.derivedStats'),
    t('characters.wizard.steps.skills'),
    t('characters.wizard.steps.feats'),
    t('characters.wizard.steps.equipment'),
    t('characters.wizard.steps.portrait'),
  ];

  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{t('characters.wizard.title')}</h2>
        <ButtonLink to={`/campaigns/${campaignId}/characters`} variant="ghost" size="sm">
          {t('common.cancel')}
        </ButtonLink>
      </div>

      <div className="grid gap-4 md:grid-cols-[200px_1fr_280px]">
        <WizardStepNav
          steps={WIZARD_STEP_IDS.map((id, i) => ({ id, label: stepLabels[i]! }))}
          currentIndex={stepIndex}
          furthestIndexReached={furthestIndexReached}
          invalidIndices={invalidIndices}
          onSelect={(i) => (i <= furthestIndexReached ? goToStep(i) : undefined)}
        />

        <div className="rounded-md bg-stone-900 shadow-sm p-4 min-w-0">
          {submitMutation.isError && <ErrorBanner message={errorMessage(submitMutation.error)} />}
          {warnings.length > 0 && (
            <div className="mb-4 rounded-md bg-amber-950/30 outline outline-1 outline-amber-700 px-3 py-2 text-xs text-amber-300 space-y-1">
              <p className="font-medium">{t('characters.wizard.submit.partialFailureTitle')}</p>
              {warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          )}

          {stepIndex === 0 && (
            <IdentityStep
              draft={draft}
              onChange={updateDraft}
              edition={edition}
              role={role === 'dm' ? 'dm' : 'player'}
              players={players}
              validation={currentValidation}
              readOnly={readOnly}
            />
          )}
          {stepIndex === 1 && (
            <AbilityScoresStep
              campaignId={campaignId}
              allowReroll={campaign.allow_ability_reroll}
              scores={draft.scores}
              onChangeScores={(scores) => updateDraft({ scores })}
              validation={currentValidation}
              readOnly={readOnly}
            />
          )}
          {stepIndex === 2 && (
            <DerivedStatsStep
              draft={draft}
              onChange={updateDraft}
              selectedClass={selectedClass}
              selectedRace={selectedRace}
              selectedSubrace={selectedSubrace}
              readOnly={readOnly}
            />
          )}
          {stepIndex === 3 && (
            <SkillsStep draft={draft} onChange={updateDraft} selectedClass={selectedClass} readOnly={readOnly} />
          )}
          {stepIndex === 4 && <FeatsStep draft={draft} onChange={updateDraft} edition={edition} readOnly={readOnly} />}
          {stepIndex === 5 && <EquipmentStep draft={draft} onChange={updateDraft} edition={edition} readOnly={readOnly} />}
          {stepIndex === 6 &&
            (draft.createdCharacterId ? (
              <PortraitStep
                campaignId={campaignId}
                characterId={draft.createdCharacterId}
                portraitFileUrl={portraitFileUrl}
                onUploaded={handlePortraitUploaded}
              />
            ) : (
              <Loading />
            ))}

          <div className="mt-6 flex items-center justify-between border-t border-stone-800 pt-4">
            <Button variant="ghost" onClick={handleBack} disabled={stepIndex === 0}>
              {t('common.back')}
            </Button>
            {isLastStep ? (
              <div className="flex items-center gap-2">
                {/* Purely compositional — reuses AddToEncounterOverlay's
                    existing add-existing-character path via SessionScreen's
                    router-state hand-off (see that file's pendingPlaceCharacterId
                    effect). Participant management is DM-only server-side
                    (requireEncounterDm), so this action is DM-only here too. */}
                {role === 'dm' && draft.createdCharacterId && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      navigate(`/campaigns/${campaignId}/session`, { state: { placeCharacterId: draft.createdCharacterId } })
                    }
                  >
                    {t('characters.wizard.placeOnMap')}
                  </Button>
                )}
                <ButtonLink to={`/campaigns/${campaignId}/characters/${draft.createdCharacterId ?? ''}`} variant="primary">
                  {t('characters.wizard.finish')}
                </ButtonLink>
              </div>
            ) : (
              <Button
                variant="primary"
                onClick={handleNext}
                disabled={!currentValidation.valid || submitMutation.isPending}
              >
                {stepIndex === EQUIPMENT_STEP_INDEX && submitMutation.isPending
                  ? t('characters.wizard.submit.creating')
                  : t('common.next')}
              </Button>
            )}
          </div>
        </div>

        <LivePreviewPanel draft={draft} raceName={raceName} backgroundName={backgroundName} className={selectedClass?.name ?? null} />
      </div>
    </div>
  );
}
