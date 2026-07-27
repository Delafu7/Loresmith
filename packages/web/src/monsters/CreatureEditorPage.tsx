// Homebrew creature create/edit form (Phase 3.2). No single-monster GET
// endpoint exists server-side (by design — see routes/monsters.ts), so edit
// mode fetches the campaign's full bestiary list (GET /catalog/monsters?
// campaignId=) and filters client-side for the id in the route, same pattern
// CharacterSheetPage.tsx uses for `portraitAsset`.
//
// This app has no form library (react-hook-form/formik) anywhere — confirmed
// via `grep -rn "react-hook-form|formik" packages/web/package.json` coming up
// empty — so this sticks to plain useState + manual validation, matching
// CharacterSheetPage.tsx's core-stats edit form.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CampaignAsset, MonsterCatalogEntry, StatBlockEntry } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { Loading, ErrorBanner, errorMessage } from '../components/Feedback';
import { Portrait } from '../components/Portrait';
import { ImageUploadField } from '../components/ImageUploadField';
import { StatBlock } from '../components/StatBlock';

const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
const CR_OPTIONS = [
  0, 0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30,
];

interface KvRow {
  key: string;
  value: string;
}

interface EntryDraft {
  name: string;
  description: string;
  attackBonus: string;
  damageDice: string;
  damageType: string;
  saveDc: string;
  saveAbilityIndex: string;
}

function emptyEntry(): EntryDraft {
  return { name: '', description: '', attackBonus: '', damageDice: '', damageType: '', saveDc: '', saveAbilityIndex: '' };
}

function entryToDraft(e: StatBlockEntry): EntryDraft {
  return {
    name: e.name,
    description: e.description ?? e.desc ?? '',
    attackBonus: e.attackBonus !== undefined ? String(e.attackBonus) : '',
    damageDice: e.damageDice ?? '',
    damageType: e.damageType ?? '',
    saveDc: e.saveDc !== undefined ? String(e.saveDc) : '',
    saveAbilityIndex: e.saveAbilityIndex ?? '',
  };
}

function draftToEntry(d: EntryDraft): StatBlockEntry | null {
  if (!d.name.trim() || !d.description.trim()) return null;
  const entry: StatBlockEntry = { name: d.name.trim(), description: d.description.trim() };
  if (d.attackBonus.trim()) entry.attackBonus = Number(d.attackBonus);
  if (d.damageDice.trim()) entry.damageDice = d.damageDice.trim();
  if (d.damageType.trim()) entry.damageType = d.damageType.trim();
  if (d.saveDc.trim()) entry.saveDc = Number(d.saveDc);
  if (d.saveAbilityIndex.trim()) entry.saveAbilityIndex = d.saveAbilityIndex.trim();
  return entry;
}

interface FormState {
  name: string;
  size: string;
  creatureType: string;
  alignment: string;
  armorClass: string;
  armorClassNotes: string;
  hitPointAverage: string;
  hitDice: string;
  speedRows: KvRow[]; // first row is always 'walk'
  str: string;
  dex: string;
  con: string;
  int: string;
  wis: string;
  cha: string;
  savingThrowRows: KvRow[];
  skillRows: KvRow[];
  damageVulnerabilities: string[];
  damageResistances: string[];
  damageImmunities: string[];
  senses: string;
  languages: string;
  challengeRating: string;
  xpValue: string;
  traits: EntryDraft[];
  actions: EntryDraft[];
  legendaryActions: EntryDraft[];
  reactions: EntryDraft[];
  source: string;
  artAssetId: number | null;
  isUnique: boolean;
}

function emptyForm(): FormState {
  return {
    name: '',
    size: 'Medium',
    creatureType: '',
    alignment: '',
    armorClass: '',
    armorClassNotes: '',
    hitPointAverage: '',
    hitDice: '',
    speedRows: [{ key: 'walk', value: '30' }],
    str: '10',
    dex: '10',
    con: '10',
    int: '10',
    wis: '10',
    cha: '10',
    savingThrowRows: [],
    skillRows: [],
    damageVulnerabilities: [],
    damageResistances: [],
    damageImmunities: [],
    senses: '',
    languages: '',
    challengeRating: '0',
    xpValue: '0',
    traits: [],
    actions: [emptyEntry()],
    legendaryActions: [],
    reactions: [],
    source: '',
    artAssetId: null,
    isUnique: false,
  };
}

function kvRowsFromRecord(record: Record<string, number> | null | undefined): KvRow[] {
  if (!record) return [];
  return Object.entries(record).map(([key, value]) => ({ key, value: String(value) }));
}

function monsterToForm(m: MonsterCatalogEntry): FormState {
  const speedEntries = Object.entries((m.speed as Record<string, number>) ?? {});
  const walkEntry = speedEntries.find(([k]) => k === 'walk');
  const otherSpeed = speedEntries.filter(([k]) => k !== 'walk');
  const speedRows: KvRow[] = [
    { key: 'walk', value: walkEntry ? String(walkEntry[1]) : '0' },
    ...otherSpeed.map(([k, v]) => ({ key: k, value: String(v) })),
  ];

  return {
    name: m.name,
    size: m.size,
    creatureType: m.creature_type,
    alignment: m.alignment ?? '',
    armorClass: String(m.armor_class),
    armorClassNotes: m.armor_class_notes ?? '',
    hitPointAverage: String(m.hit_point_average),
    hitDice: m.hit_dice,
    speedRows,
    str: String(m.str),
    dex: String(m.dex),
    con: String(m.con),
    int: String(m.int),
    wis: String(m.wis),
    cha: String(m.cha),
    savingThrowRows: kvRowsFromRecord(m.saving_throws),
    skillRows: kvRowsFromRecord(m.skills),
    damageVulnerabilities: m.damage_vulnerabilities ?? [],
    damageResistances: m.damage_resistances ?? [],
    damageImmunities: m.damage_immunities ?? [],
    senses: m.senses ?? '',
    languages: m.languages ?? '',
    challengeRating: String(m.challenge_rating),
    xpValue: String(m.xp_value),
    traits: Array.isArray(m.traits) ? (m.traits as StatBlockEntry[]).map(entryToDraft) : [],
    actions: Array.isArray(m.actions) && m.actions.length > 0 ? (m.actions as StatBlockEntry[]).map(entryToDraft) : [emptyEntry()],
    legendaryActions: Array.isArray(m.legendary_actions) ? (m.legendary_actions as StatBlockEntry[]).map(entryToDraft) : [],
    reactions: Array.isArray(m.reactions) ? (m.reactions as StatBlockEntry[]).map(entryToDraft) : [],
    source: m.source ?? '',
    artAssetId: m.art_asset_id,
    isUnique: m.is_unique,
  };
}

function buildPayload(form: FormState) {
  const speed: Record<string, number> = {};
  for (const row of form.speedRows) {
    if (row.key.trim()) speed[row.key.trim()] = Number(row.value) || 0;
  }
  if (speed.walk === undefined) speed.walk = 0;

  const savingThrows: Record<string, number> = {};
  for (const row of form.savingThrowRows) {
    if (row.key.trim()) savingThrows[row.key.trim()] = Number(row.value) || 0;
  }
  const skills: Record<string, number> = {};
  for (const row of form.skillRows) {
    if (row.key.trim()) skills[row.key.trim()] = Number(row.value) || 0;
  }

  return {
    name: form.name.trim(),
    size: form.size,
    creatureType: form.creatureType.trim(),
    alignment: form.alignment.trim() || null,
    armorClass: Number(form.armorClass) || 0,
    armorClassNotes: form.armorClassNotes.trim() || null,
    hitPointAverage: Number(form.hitPointAverage) || 0,
    hitDice: form.hitDice.trim(),
    speed,
    str: Number(form.str) || 1,
    dex: Number(form.dex) || 1,
    con: Number(form.con) || 1,
    int: Number(form.int) || 1,
    wis: Number(form.wis) || 1,
    cha: Number(form.cha) || 1,
    savingThrows: Object.keys(savingThrows).length > 0 ? savingThrows : null,
    skills: Object.keys(skills).length > 0 ? skills : null,
    damageVulnerabilities: form.damageVulnerabilities,
    damageResistances: form.damageResistances,
    damageImmunities: form.damageImmunities,
    senses: form.senses.trim() || null,
    languages: form.languages.trim() || null,
    challengeRating: Number(form.challengeRating),
    xpValue: Number(form.xpValue) || 0,
    traits: form.traits.map(draftToEntry).filter((e): e is StatBlockEntry => e !== null),
    actions: form.actions.map(draftToEntry).filter((e): e is StatBlockEntry => e !== null),
    legendaryActions: form.legendaryActions.map(draftToEntry).filter((e): e is StatBlockEntry => e !== null),
    reactions: form.reactions.map(draftToEntry).filter((e): e is StatBlockEntry => e !== null),
    source: form.source.trim() || null,
    artAssetId: form.artAssetId,
    isUnique: form.isUnique,
  };
}

function previewMonster(form: FormState): MonsterCatalogEntry {
  const payload = buildPayload(form);
  return {
    id: 0,
    slug: '',
    name: payload.name || '(unnamed)',
    edition_scope: 'both',
    size: payload.size,
    creature_type: payload.creatureType || '—',
    alignment: payload.alignment,
    armor_class: payload.armorClass,
    armor_class_notes: payload.armorClassNotes,
    hit_point_average: payload.hitPointAverage,
    hit_dice: payload.hitDice,
    speed: payload.speed,
    str: payload.str,
    dex: payload.dex,
    con: payload.con,
    int: payload.int,
    wis: payload.wis,
    cha: payload.cha,
    saving_throws: payload.savingThrows,
    skills: payload.skills,
    damage_vulnerabilities: payload.damageVulnerabilities,
    damage_resistances: payload.damageResistances,
    damage_immunities: payload.damageImmunities,
    senses: payload.senses,
    languages: payload.languages,
    challenge_rating: payload.challengeRating,
    xp_value: payload.xpValue,
    traits: payload.traits,
    actions: payload.actions,
    legendary_actions: payload.legendaryActions,
    reactions: payload.reactions,
    source: payload.source,
    is_homebrew: true,
    owning_campaign_id: null,
    art_asset_id: payload.artAssetId,
    is_unique: payload.isUnique,
    image_url: null,
  };
}

export function CreatureEditorPage() {
  const params = useParams<{ monsterId?: string }>();
  const monsterId = params.monsterId ? Number(params.monsterId) : null;
  const isEdit = monsterId !== null;
  const { campaignId, campaign, role } = useCampaignShell();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const bestiaryQueryKey = ['catalog', 'monsters', campaign.srd_edition, campaignId];
  const bestiaryQuery = useQuery({
    queryKey: bestiaryQueryKey,
    queryFn: () =>
      api.get<{ monsters: MonsterCatalogEntry[] }>(
        `/catalog/monsters?edition=${campaign.srd_edition}&campaignId=${campaignId}`,
      ),
  });

  const assetsQuery = useQuery({
    queryKey: ['campaign', campaignId, 'assets'],
    queryFn: () => api.get<{ assets: CampaignAsset[] }>(`/campaigns/${campaignId}/assets`),
  });

  const [form, setForm] = useState<FormState>(emptyForm());
  const [hydrated, setHydrated] = useState(!isEdit);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const existingMonster = isEdit ? bestiaryQuery.data?.monsters.find((m) => m.id === monsterId) : undefined;

  useEffect(() => {
    if (isEdit && existingMonster && !hydrated) {
      setForm(monsterToForm(existingMonster));
      setHydrated(true);
    }
  }, [isEdit, existingMonster, hydrated]);

  const saveMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) =>
      isEdit
        ? api.patch<{ monster: MonsterCatalogEntry }>(`/campaigns/${campaignId}/monsters/${monsterId}`, payload)
        : api.post<{ monster: MonsterCatalogEntry }>(`/campaigns/${campaignId}/monsters`, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bestiaryQueryKey });
      navigate(`/campaigns/${campaignId}/monsters`);
    },
  });

  // Matches MonstersPage.tsx's DM-only gate — the server already enforces
  // requireRole('dm') on the write endpoints, but without this a player who
  // navigates straight to this URL would see the full form (and the
  // campaign's asset list) before ever hitting a 403 on submit. Placed after
  // every hook call above (not right after `existingMonster`) so it doesn't
  // violate the rules of hooks with a conditional early return.
  if (role !== 'dm') {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
        <ErrorBanner message="The bestiary is only available to the DM." />
      </div>
    );
  }

  if (isEdit && bestiaryQuery.isLoading) return <Loading label="Loading creature…" />;
  if (isEdit && bestiaryQuery.isError) return <ErrorBanner message={errorMessage(bestiaryQuery.error)} />;
  if (isEdit && bestiaryQuery.data && !existingMonster) {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
        <ErrorBanner message="This creature no longer exists or isn't homebrew for this campaign." />
      </div>
    );
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validate(): string | null {
    if (!form.name.trim()) return 'Name is required.';
    if (!form.creatureType.trim()) return 'Creature type is required.';
    if (!form.hitDice.trim()) return 'Hit dice is required.';
    if (!form.armorClass || Number(form.armorClass) <= 0) return 'Armor class must be a positive number.';
    if (!form.hitPointAverage || Number(form.hitPointAverage) <= 0) return 'Hit point average must be a positive number.';
    const validActions = form.actions.filter((a) => a.name.trim() && a.description.trim());
    if (validActions.length === 0) return 'At least one action (with name and description) is required.';
    return null;
  }

  function submit() {
    const err = validate();
    setValidationError(err);
    if (err) return;
    saveMutation.mutate(buildPayload(form));
  }

  function handleAssetUploaded(asset: CampaignAsset) {
    queryClient.setQueryData<{ assets: CampaignAsset[] }>(['campaign', campaignId, 'assets'], (prev) =>
      prev ? { assets: [asset, ...prev.assets.filter((a) => a.id !== asset.id)] } : { assets: [asset] },
    );
    update('artAssetId', asset.id);
  }

  const selectedAsset = assetsQuery.data?.assets.find((a) => a.id === form.artAssetId);

  return (
    <div className="px-4 sm:px-6 py-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-100">
          {isEdit ? `Edit ${existingMonster?.name ?? 'creature'}` : 'New homebrew creature'}
        </h2>
        <button
          type="button"
          onClick={() => navigate(`/campaigns/${campaignId}/monsters`)}
          className="text-xs text-stone-400 hover:text-stone-200"
        >
          ← Back to bestiary
        </button>
      </div>

      {/* Identity */}
      <section className="rounded-lg border border-stone-800 bg-stone-900 p-4 sm:p-5 space-y-3">
        <h3 className="text-xs uppercase text-stone-500">Identity</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Name" required>
            <input
              type="text"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            />
          </Field>
          <Field label="Size">
            <select
              value={form.size}
              onChange={(e) => update('size', e.target.value)}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            >
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Creature type" required>
            <input
              type="text"
              value={form.creatureType}
              onChange={(e) => update('creatureType', e.target.value)}
              placeholder="e.g. beast, fiend, humanoid"
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            />
          </Field>
          <Field label="Alignment">
            <input
              type="text"
              value={form.alignment}
              onChange={(e) => update('alignment', e.target.value)}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            />
          </Field>
          <Field label="Source">
            <input
              type="text"
              value={form.source}
              onChange={(e) => update('source', e.target.value)}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-300">
          <input
            type="checkbox"
            checked={form.isUnique}
            onChange={(e) => update('isUnique', e.target.checked)}
            className="rounded border-stone-700 bg-stone-800"
          />
          Unique (named/legendary — limit to one active instance per campaign)
        </label>
      </section>

      {/* Defense */}
      <section className="rounded-lg border border-stone-800 bg-stone-900 p-4 sm:p-5 space-y-3">
        <h3 className="text-xs uppercase text-stone-500">Defense</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Armor class" required>
            <input
              type="number"
              value={form.armorClass}
              onChange={(e) => update('armorClass', e.target.value)}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            />
          </Field>
          <Field label="Armor class notes">
            <input
              type="text"
              value={form.armorClassNotes}
              onChange={(e) => update('armorClassNotes', e.target.value)}
              placeholder="e.g. natural armor"
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            />
          </Field>
          <Field label="Hit point average" required>
            <input
              type="number"
              value={form.hitPointAverage}
              onChange={(e) => update('hitPointAverage', e.target.value)}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            />
          </Field>
          <Field label="Hit dice" required>
            <input
              type="text"
              value={form.hitDice}
              onChange={(e) => update('hitDice', e.target.value)}
              placeholder="e.g. 2d8+2"
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            />
          </Field>
        </div>
        <KvEditor
          label="Speed (ft.)"
          rows={form.speedRows}
          onChange={(rows) => update('speedRows', rows)}
          keyPlaceholder="walk"
          protectedKeys={['walk']}
        />
      </section>

      {/* Ability scores */}
      <section className="rounded-lg border border-stone-800 bg-stone-900 p-4 sm:p-5 space-y-3">
        <h3 className="text-xs uppercase text-stone-500">Ability scores</h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((key) => (
            <div key={key} className="rounded-lg border border-stone-800 bg-stone-950 p-3 text-center">
              <div className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{key}</div>
              <input
                type="number"
                min={1}
                max={30}
                value={form[key]}
                onChange={(e) => update(key, e.target.value)}
                className="w-full text-center bg-transparent text-xl font-bold text-stone-100 my-1 focus:outline-none focus:ring-1 focus:ring-amber-500 rounded"
              />
            </div>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <KvEditor label="Saving throws" rows={form.savingThrowRows} onChange={(rows) => update('savingThrowRows', rows)} keyPlaceholder="dex" />
          <KvEditor label="Skills" rows={form.skillRows} onChange={(rows) => update('skillRows', rows)} keyPlaceholder="stealth" />
        </div>
      </section>

      {/* Damage & senses */}
      <section className="rounded-lg border border-stone-800 bg-stone-900 p-4 sm:p-5 space-y-3">
        <h3 className="text-xs uppercase text-stone-500">Damage &amp; senses</h3>
        <div className="grid sm:grid-cols-3 gap-3">
          <StringListEditor
            label="Vulnerabilities"
            values={form.damageVulnerabilities}
            onChange={(v) => update('damageVulnerabilities', v)}
          />
          <StringListEditor
            label="Resistances"
            values={form.damageResistances}
            onChange={(v) => update('damageResistances', v)}
          />
          <StringListEditor
            label="Immunities"
            values={form.damageImmunities}
            onChange={(v) => update('damageImmunities', v)}
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Senses">
            <input
              type="text"
              value={form.senses}
              onChange={(e) => update('senses', e.target.value)}
              placeholder="e.g. darkvision 60 ft., passive Perception 12"
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            />
          </Field>
          <Field label="Languages">
            <input
              type="text"
              value={form.languages}
              onChange={(e) => update('languages', e.target.value)}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            />
          </Field>
        </div>
      </section>

      {/* Challenge */}
      <section className="rounded-lg border border-stone-800 bg-stone-900 p-4 sm:p-5 space-y-3">
        <h3 className="text-xs uppercase text-stone-500">Challenge</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Challenge rating">
            <select
              value={form.challengeRating}
              onChange={(e) => update('challengeRating', e.target.value)}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            >
              {CR_OPTIONS.map((cr) => (
                <option key={cr} value={cr}>
                  {cr}
                </option>
              ))}
            </select>
          </Field>
          <Field label="XP value">
            <input
              type="number"
              value={form.xpValue}
              onChange={(e) => update('xpValue', e.target.value)}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            />
          </Field>
        </div>
      </section>

      {/* Art */}
      <section className="rounded-lg border border-stone-800 bg-stone-900 p-4 sm:p-5 space-y-3">
        <h3 className="text-xs uppercase text-stone-500">Art</h3>
        <div className="flex items-center gap-3">
          <Portrait
            fileUrl={selectedAsset?.file_url}
            alt={`${form.name || 'Creature'} art`}
            size="lg"
            placeholderLabel={form.name}
          />
          <div className="flex flex-col gap-2">
            <ImageUploadField campaignId={campaignId} onUploaded={handleAssetUploaded} label="Upload new image" />
            {form.artAssetId !== null && (
              <button
                type="button"
                onClick={() => update('artAssetId', null)}
                className="text-xs text-stone-400 hover:text-stone-200 text-left"
              >
                Clear selection
              </button>
            )}
          </div>
        </div>
        {assetsQuery.data && assetsQuery.data.assets.length > 0 && (
          <div>
            <p className="text-[10px] text-stone-500 mb-1.5">Or pick an existing campaign asset:</p>
            <div className="flex flex-wrap gap-2">
              {assetsQuery.data.assets
                .filter((a) => a.asset_type === 'image')
                .map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => update('artAssetId', a.id)}
                    className={`rounded-md ${
                      form.artAssetId === a.id ? 'ring-2 ring-amber-500' : ''
                    }`}
                    aria-label={`Select ${a.title ?? 'asset'} as creature art`}
                  >
                    <Portrait fileUrl={a.file_url} alt={a.title ?? 'Campaign asset'} size="sm" />
                  </button>
                ))}
            </div>
          </div>
        )}
      </section>

      {/* Stat block entries */}
      <StatEntryListEditor
        label="Traits"
        entries={form.traits}
        onChange={(entries) => update('traits', entries)}
      />
      <StatEntryListEditor
        label="Actions"
        entries={form.actions}
        onChange={(entries) => update('actions', entries)}
        required
      />
      <StatEntryListEditor
        label="Legendary actions"
        entries={form.legendaryActions}
        onChange={(entries) => update('legendaryActions', entries)}
      />
      <StatEntryListEditor
        label="Reactions"
        entries={form.reactions}
        onChange={(entries) => update('reactions', entries)}
      />

      {validationError && <ErrorBanner message={validationError} />}
      {saveMutation.isError && <ErrorBanner message={errorMessage(saveMutation.error)} />}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saveMutation.isPending}
          onClick={submit}
          className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-4 py-2 text-sm"
        >
          {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create creature'}
        </button>
        <button
          type="button"
          onClick={() => navigate(`/campaigns/${campaignId}/monsters`)}
          className="rounded-md border border-stone-700 px-4 py-2 text-sm text-stone-300 hover:bg-stone-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="ml-auto text-xs text-amber-500 hover:text-amber-400"
        >
          {showPreview ? 'Hide preview' : 'Show live preview'}
        </button>
      </div>

      {showPreview && <StatBlock monster={previewMonster(form)} />}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] text-stone-500 mb-0.5">
        {label}
        {required && <span className="text-red-400"> *</span>}
      </span>
      {children}
    </label>
  );
}

function KvEditor({
  label,
  rows,
  onChange,
  keyPlaceholder,
  protectedKeys = [],
}: {
  label: string;
  rows: KvRow[];
  onChange: (rows: KvRow[]) => void;
  keyPlaceholder?: string;
  protectedKeys?: string[];
}) {
  function addRow() {
    onChange([...rows, { key: '', value: '0' }]);
  }
  function removeRow(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
  function updateRow(i: number, patch: Partial<KvRow>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-stone-500">{label}</span>
        <button type="button" onClick={addRow} className="text-xs text-amber-500 hover:text-amber-400">
          + Add
        </button>
      </div>
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="text"
              value={row.key}
              placeholder={keyPlaceholder}
              disabled={protectedKeys.includes(row.key) && i === 0}
              onChange={(e) => updateRow(i, { key: e.target.value })}
              className="flex-1 rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100 disabled:opacity-60"
            />
            <input
              type="number"
              value={row.value}
              onChange={(e) => updateRow(i, { value: e.target.value })}
              className="w-16 rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100 text-center"
            />
            {!(protectedKeys.includes(row.key) && i === 0) && (
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label="Remove row"
                className="text-red-400 hover:text-red-300 text-xs px-1"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-stone-600 italic">None</p>}
      </div>
    </div>
  );
}

function StringListEditor({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  function addRow() {
    onChange([...values, '']);
  }
  function removeRow(i: number) {
    onChange(values.filter((_, idx) => idx !== i));
  }
  function updateRow(i: number, value: string) {
    onChange(values.map((v, idx) => (idx === i ? value : v)));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-stone-500">{label}</span>
        <button type="button" onClick={addRow} className="text-xs text-amber-500 hover:text-amber-400">
          + Add
        </button>
      </div>
      <div className="space-y-1.5">
        {values.map((v, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="text"
              value={v}
              onChange={(e) => updateRow(i, e.target.value)}
              className="flex-1 rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              aria-label="Remove"
              className="text-red-400 hover:text-red-300 text-xs px-1"
            >
              ✕
            </button>
          </div>
        ))}
        {values.length === 0 && <p className="text-xs text-stone-600 italic">None</p>}
      </div>
    </div>
  );
}

function StatEntryListEditor({
  label,
  entries,
  onChange,
  required,
}: {
  label: string;
  entries: EntryDraft[];
  onChange: (entries: EntryDraft[]) => void;
  required?: boolean;
}) {
  function addEntry() {
    onChange([...entries, emptyEntry()]);
  }
  function removeEntry(i: number) {
    onChange(entries.filter((_, idx) => idx !== i));
  }
  function updateEntry(i: number, patch: Partial<EntryDraft>) {
    onChange(entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }

  return (
    <section className="rounded-lg border border-stone-800 bg-stone-900 p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase text-stone-500">
          {label}
          {required && <span className="text-red-400"> * (at least 1)</span>}
        </h3>
        <button type="button" onClick={addEntry} className="text-xs text-amber-500 hover:text-amber-400">
          + Add entry
        </button>
      </div>
      {entries.length === 0 && <p className="text-xs text-stone-600 italic">None</p>}
      <div className="space-y-3">
        {entries.map((entry, i) => (
          <div key={i} className="rounded-md border border-stone-700 bg-stone-950 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <div className="flex-1 grid sm:grid-cols-2 gap-2">
                <Field label="Name">
                  <input
                    type="text"
                    value={entry.name}
                    onChange={(e) => updateEntry(i, { name: e.target.value })}
                    className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
                  />
                </Field>
                <Field label="Attack bonus">
                  <input
                    type="number"
                    value={entry.attackBonus}
                    onChange={(e) => updateEntry(i, { attackBonus: e.target.value })}
                    className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
                  />
                </Field>
              </div>
              <button
                type="button"
                onClick={() => removeEntry(i)}
                aria-label={`Remove ${label} entry`}
                className="text-red-400 hover:text-red-300 text-xs px-1 mt-4"
              >
                ✕
              </button>
            </div>
            <Field label="Description">
              <textarea
                rows={2}
                value={entry.description}
                onChange={(e) => updateEntry(i, { description: e.target.value })}
                className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
              />
            </Field>
            <div className="grid sm:grid-cols-3 gap-2">
              <Field label="Damage dice">
                <input
                  type="text"
                  value={entry.damageDice}
                  placeholder="e.g. 1d6+2"
                  onChange={(e) => updateEntry(i, { damageDice: e.target.value })}
                  className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
                />
              </Field>
              <Field label="Damage type">
                <input
                  type="text"
                  value={entry.damageType}
                  onChange={(e) => updateEntry(i, { damageType: e.target.value })}
                  className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
                />
              </Field>
              <Field label="Save DC / ability">
                <div className="flex gap-1">
                  <input
                    type="number"
                    value={entry.saveDc}
                    onChange={(e) => updateEntry(i, { saveDc: e.target.value })}
                    className="w-16 rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
                  />
                  <input
                    type="text"
                    value={entry.saveAbilityIndex}
                    placeholder="dex"
                    onChange={(e) => updateEntry(i, { saveAbilityIndex: e.target.value })}
                    className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
                  />
                </div>
              </Field>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
