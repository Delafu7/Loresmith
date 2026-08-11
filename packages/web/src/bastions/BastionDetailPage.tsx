// Phase 4 "Bastion tracking" — the management view for one Bastion: BP/
// defenders readout, facilities (add/remove), turn resolution (Maintain or
// per-facility orders), turn history with Bastion Events, Request for Aid
// follow-up, skip-turn (fall tracking), BP spending, and abandonment. See
// docs/rules/bastions.md for the rules this renders, and services/
// bastions.ts / bastionTurns.ts / bastionEvents.ts for what's enforced
// server-side (this page trusts those checks, it doesn't duplicate them).

import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  Bastion, BastionFacility, BastionFacilityCatalogEntry, BastionOrder, BastionTurn, BastionWithFacilities, Character,
} from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Field, Input, Select } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { Card, CardKicker } from '../components/ui/Card';
import { useLocale } from '../i18n/LocaleContext';

export function BastionDetailPage() {
  const { campaignId, role } = useCampaignShell();
  const { bastionId } = useParams<{ bastionId: string }>();
  const queryClient = useQueryClient();

  const bastionQuery = useQuery({
    queryKey: ['bastion', campaignId, bastionId],
    queryFn: () => api.get<{ bastion: BastionWithFacilities }>(`/campaigns/${campaignId}/bastions/${bastionId}`),
  });
  const catalogQuery = useQuery({
    queryKey: ['bastionFacilityCatalog'],
    queryFn: () => api.get<{ bastionFacilities: BastionFacilityCatalogEntry[] }>(`/catalog/bastion-facilities`),
  });
  const turnsQuery = useQuery({
    queryKey: ['bastionTurns', campaignId, bastionId],
    queryFn: () => api.get<{ turns: BastionTurn[] }>(`/campaigns/${campaignId}/bastions/${bastionId}/turns`),
  });
  const charactersQuery = useQuery({
    queryKey: ['characters', campaignId],
    queryFn: () => api.get<{ characters: Character[] }>(`/campaigns/${campaignId}/characters`),
  });

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ['bastion', campaignId, bastionId] });
    void queryClient.invalidateQueries({ queryKey: ['bastions', campaignId] });
    void queryClient.invalidateQueries({ queryKey: ['bastionTurns', campaignId, bastionId] });
  }

  if (bastionQuery.isLoading || catalogQuery.isLoading) return <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto"><Loading /></div>;
  if (bastionQuery.isError) return <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto"><ErrorBanner message={errorMessage(bastionQuery.error)} /></div>;

  const bastion = bastionQuery.data!.bastion;
  const catalog = catalogQuery.data?.bastionFacilities ?? [];
  const turns = turnsQuery.data?.turns ?? [];
  const characterName = charactersQuery.data?.characters.find((c) => c.id === bastion.owner_character_id)?.name ?? bastion.owner_character_id;
  const isDm = role === 'dm';

  const pendingRequestForAidTurn = turns.find((turn) => {
    if (turn.event_key !== 'request_for_aid') return false;
    const event = (turn.event_outcome as { event?: { pending?: boolean } } | null)?.event;
    return event?.pending === true;
  });

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto space-y-6">
      <BastionHeader campaignId={campaignId} bastion={bastion} characterName={characterName} isDm={isDm} onChanged={invalidateAll} />

      {pendingRequestForAidTurn && (
        <RequestForAidPanel campaignId={campaignId} bastionId={bastion.id} turn={pendingRequestForAidTurn} onResolved={invalidateAll} />
      )}

      <FacilitiesSection campaignId={campaignId} bastion={bastion} catalog={catalog} onChanged={invalidateAll} />

      {bastion.status === 'active' && (
        <ResolveTurnSection campaignId={campaignId} bastion={bastion} onResolved={invalidateAll} />
      )}

      <SpendBpSection campaignId={campaignId} bastion={bastion} onChanged={invalidateAll} />

      <TurnHistorySection turns={turns} bastion={bastion} isLoading={turnsQuery.isLoading} />

      {bastion.status === 'active' && (
        <DangerSection campaignId={campaignId} bastion={bastion} onChanged={invalidateAll} />
      )}
    </div>
  );
}

function BastionHeader({
  campaignId, bastion, characterName, isDm, onChanged,
}: { campaignId: string; bastion: BastionWithFacilities; characterName: string; isDm: boolean; onChanged: () => void }) {
  const { t } = useLocale();
  const [editingDefenders, setEditingDefenders] = useState(false);
  const [defendersInput, setDefendersInput] = useState(String(bastion.bastion_defenders));

  const updateMutation = useMutation({
    mutationFn: (body: { bastionDefenders?: number; turnIntervalDays?: number }) =>
      api.patch<{ bastion: Bastion }>(`/campaigns/${campaignId}/bastions/${bastion.id}`, body),
    onSuccess: () => {
      setEditingDefenders(false);
      onChanged();
    },
  });

  return (
    <Card className="gap-2">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-medium">{bastion.name || t('bastions.unnamed')}</h2>
        <span className="text-xs uppercase font-semibold text-stone-400">{t(`bastions.status.${bastion.status}`)}</span>
      </div>
      <p className="text-sm text-stone-400">{characterName}</p>
      <div className="flex flex-wrap gap-4 text-sm text-stone-300 mt-1">
        <span>{t('bastions.bastionPointsLabel')}: <strong>{bastion.bastion_points}</strong></span>
        <span className="flex items-center gap-1">
          {t('bastions.defendersLabel')}:
          {editingDefenders ? (
            <>
              <input
                type="number"
                min={0}
                className="w-16 rounded border border-stone-700 bg-stone-900 px-1 py-0.5 text-sm"
                value={defendersInput}
                onChange={(e) => setDefendersInput(e.target.value)}
              />
              <button
                type="button"
                className="text-amber-500 hover:text-amber-400 text-xs"
                onClick={() => updateMutation.mutate({ bastionDefenders: Number(defendersInput) })}
              >
                {t('bastions.save')}
              </button>
            </>
          ) : (
            <>
              <strong>{bastion.bastion_defenders}</strong>
              {isDm && (
                <button type="button" className="text-stone-500 hover:text-stone-300 text-xs" onClick={() => setEditingDefenders(true)}>
                  {t('bastions.edit')}
                </button>
              )}
            </>
          )}
        </span>
        <span>{t('bastions.turnIntervalLabel')}: <strong>{bastion.turn_interval_days}</strong></span>
        <span>{t('bastions.consecutiveMissedLabel')}: <strong>{bastion.consecutive_turns_without_orders}</strong></span>
      </div>
      {updateMutation.isError && <ErrorBanner message={errorMessage(updateMutation.error)} />}
    </Card>
  );
}

function FacilitiesSection({
  campaignId, bastion, catalog, onChanged,
}: { campaignId: string; bastion: BastionWithFacilities; catalog: BastionFacilityCatalogEntry[]; onChanged: () => void }) {
  const { t } = useLocale();
  const [space, setSpace] = useState<'cramped' | 'roomy' | 'vast'>('cramped');
  const heldSpecialCatalogIds = new Set(bastion.facilities.filter((f) => f.catalog.facility_type === 'special').map((f) => f.catalog_id));
  const addableCatalog = catalog.filter((c) => c.facility_type === 'basic' || !heldSpecialCatalogIds.has(c.id));
  const [selectedCatalogId, setSelectedCatalogId] = useState(addableCatalog[0]?.id ?? '');
  const selectedCatalogEntry = catalog.find((c) => c.id === selectedCatalogId);

  const addMutation = useMutation({
    mutationFn: () =>
      api.post<{ facility: BastionFacility }>(`/campaigns/${campaignId}/bastions/${bastion.id}/facilities`, {
        catalogId: selectedCatalogId,
        space: selectedCatalogEntry?.facility_type === 'basic' ? space : undefined,
      }),
    onSuccess: onChanged,
  });

  const removeMutation = useMutation({
    mutationFn: (facilityId: string) => api.delete(`/campaigns/${campaignId}/bastions/${bastion.id}/facilities/${facilityId}`),
    onSuccess: onChanged,
  });

  const basicFacilities = bastion.facilities.filter((f) => f.catalog.facility_type === 'basic');
  const specialFacilities = bastion.facilities.filter((f) => f.catalog.facility_type === 'special');

  return (
    <Card className="gap-3">
      <CardKicker>{t('bastions.facilitiesTitle')}</CardKicker>

      {specialFacilities.length === 0 && basicFacilities.length === 0 && <EmptyState message={t('bastions.noFacilities')} />}

      {specialFacilities.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs uppercase text-stone-500">{t('bastions.specialFacilities')}</h4>
          {specialFacilities.map((f) => (
            <FacilityRow key={f.id} facility={f} onRemove={() => removeMutation.mutate(f.id)} disabled={removeMutation.isPending} />
          ))}
        </div>
      )}
      {basicFacilities.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs uppercase text-stone-500">{t('bastions.basicFacilities')}</h4>
          {basicFacilities.map((f) => (
            <FacilityRow key={f.id} facility={f} onRemove={() => removeMutation.mutate(f.id)} disabled={removeMutation.isPending} />
          ))}
        </div>
      )}

      {(addMutation.isError || removeMutation.isError) && (
        <ErrorBanner message={errorMessage((addMutation.error ?? removeMutation.error) as unknown)} />
      )}

      {bastion.status === 'active' && addableCatalog.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-stone-800">
          <Field label={t('bastions.addFacilityLabel')} htmlFor="addFacilitySelect" className="flex-1 min-w-[10rem]">
            <Select id="addFacilitySelect" value={selectedCatalogId} onChange={(e) => setSelectedCatalogId(e.target.value)}>
              {addableCatalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.min_level ? ` (lvl ${c.min_level})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          {selectedCatalogEntry?.facility_type === 'basic' && (
            <Field label={t('bastions.spaceLabel')} htmlFor="addFacilitySpace">
              <Select id="addFacilitySpace" value={space} onChange={(e) => setSpace(e.target.value as typeof space)}>
                <option value="cramped">{t('bastions.space.cramped')}</option>
                <option value="roomy">{t('bastions.space.roomy')}</option>
                <option value="vast">{t('bastions.space.vast')}</option>
              </Select>
            </Field>
          )}
          <Button variant="secondary" size="sm" disabled={addMutation.isPending || !selectedCatalogId} onClick={() => addMutation.mutate()}>
            {addMutation.isPending ? t('bastions.saving') : t('bastions.addFacilityButton')}
          </Button>
        </div>
      )}
      {selectedCatalogEntry?.prerequisite_text && (
        <p className="text-xs text-stone-500">{t('bastions.prerequisiteHint', { text: selectedCatalogEntry.prerequisite_text })}</p>
      )}
    </Card>
  );
}

function FacilityRow({ facility, onRemove, disabled }: { facility: BastionFacility; onRemove: () => void; disabled: boolean }) {
  const { t } = useLocale();
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-stone-200">
        {facility.catalog.name}
        <span className="text-stone-500 text-xs"> ({t(`bastions.space.${facility.space}`)})</span>
        {facility.status === 'shut_down' && (
          <span className="ml-2 rounded-full border border-red-700 px-1.5 py-0.5 text-[10px] uppercase text-red-400">
            {t('bastions.shutDown')}
          </span>
        )}
      </span>
      <button type="button" onClick={onRemove} disabled={disabled} className="text-red-400 hover:text-red-300 text-xs min-h-11 px-1">
        {t('bastions.remove')}
      </button>
    </div>
  );
}

function ResolveTurnSection({ campaignId, bastion, onResolved }: { campaignId: string; bastion: BastionWithFacilities; onResolved: () => void }) {
  const { t } = useLocale();
  const [inGameDay, setInGameDay] = useState('');
  const [maintain, setMaintain] = useState(true);
  const [selectedFacilityIds, setSelectedFacilityIds] = useState<string[]>([]);
  const [payRerollByFacility, setPayRerollByFacility] = useState<Record<string, boolean>>({});

  const orderableFacilities = bastion.facilities.filter((f) => f.catalog.facility_type === 'special' && f.status === 'operational');

  const resolveMutation = useMutation({
    mutationFn: () =>
      api.post<{ turn: BastionTurn }>(`/campaigns/${campaignId}/bastions/${bastion.id}/turns`, {
        inGameDay: Number(inGameDay),
        maintain,
        orders: maintain ? [] : selectedFacilityIds.map((facilityId) => ({ facilityId, payReroll: !!payRerollByFacility[facilityId] })),
      }),
    onSuccess: () => {
      setSelectedFacilityIds([]);
      onResolved();
    },
  });

  function toggleFacility(facilityId: string) {
    setSelectedFacilityIds((prev) => (prev.includes(facilityId) ? prev.filter((id) => id !== facilityId) : [...prev, facilityId]));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (inGameDay.trim() === '') return;
    if (!maintain && selectedFacilityIds.length === 0) return;
    resolveMutation.mutate();
  }

  return (
    <Card as="form" onSubmit={handleSubmit} className="gap-3">
      <CardKicker>{t('bastions.resolveTurnTitle')}</CardKicker>
      <Field label={t('bastions.inGameDayLabel')} htmlFor="turnInGameDay">
        <Input id="turnInGameDay" type="number" required value={inGameDay} onChange={(e) => setInGameDay(e.target.value)} />
      </Field>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={maintain} onChange={() => setMaintain(true)} /> {t('bastions.maintainOption')}
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={!maintain} onChange={() => setMaintain(false)} /> {t('bastions.ordersOption')}
        </label>
      </div>
      {!maintain && (
        <div className="space-y-1.5">
          {orderableFacilities.length === 0 && <p className="text-xs text-stone-500">{t('bastions.noOrderableFacilities')}</p>}
          {orderableFacilities.map((f) => (
            <label key={f.id} className="flex items-center gap-2 text-sm text-stone-300">
              <input type="checkbox" checked={selectedFacilityIds.includes(f.id)} onChange={() => toggleFacility(f.id)} />
              {f.catalog.name} <span className="text-stone-500 text-xs">({f.catalog.bp_die})</span>
              {selectedFacilityIds.includes(f.id) && (
                <span className="flex items-center gap-1 text-xs text-stone-500">
                  <input
                    type="checkbox"
                    checked={!!payRerollByFacility[f.id]}
                    onChange={(e) => setPayRerollByFacility((prev) => ({ ...prev, [f.id]: e.target.checked }))}
                  />
                  {t('bastions.payRerollLabel')}
                </span>
              )}
            </label>
          ))}
        </div>
      )}
      {resolveMutation.isError && <ErrorBanner message={errorMessage(resolveMutation.error)} />}
      <div>
        <Button type="submit" variant="primary" disabled={resolveMutation.isPending}>
          {resolveMutation.isPending ? t('bastions.saving') : t('bastions.resolveTurnButton')}
        </Button>
      </div>
    </Card>
  );
}

function RequestForAidPanel({
  campaignId, bastionId, turn, onResolved,
}: { campaignId: string; bastionId: string; turn: BastionTurn; onResolved: () => void }) {
  const { t } = useLocale();
  const [defendersSent, setDefendersSent] = useState('0');

  const resolveMutation = useMutation({
    mutationFn: () =>
      api.post<{ turn: BastionTurn }>(`/campaigns/${campaignId}/bastions/${bastionId}/turns/${turn.id}/resolve-request-for-aid`, {
        defendersSent: Number(defendersSent),
      }),
    onSuccess: onResolved,
  });

  return (
    <Card className="gap-2 border border-amber-800/50">
      <CardKicker>{t('bastions.requestForAidTitle')}</CardKicker>
      <p className="text-sm text-stone-400">{t('bastions.requestForAidHint')}</p>
      <div className="flex items-end gap-2">
        <Field label={t('bastions.defendersSentLabel')} htmlFor="defendersSent">
          <input
            id="defendersSent"
            type="number"
            min={0}
            className="w-20 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-sm"
            value={defendersSent}
            onChange={(e) => setDefendersSent(e.target.value)}
          />
        </Field>
        <Button variant="primary" size="sm" disabled={resolveMutation.isPending} onClick={() => resolveMutation.mutate()}>
          {resolveMutation.isPending ? t('bastions.saving') : t('bastions.resolveButton')}
        </Button>
      </div>
      {resolveMutation.isError && <ErrorBanner message={errorMessage(resolveMutation.error)} />}
    </Card>
  );
}

function SpendBpSection({ campaignId, bastion, onChanged }: { campaignId: string; bastion: Bastion; onChanged: () => void }) {
  const { t } = useLocale();
  const [rarity, setRarity] = useState<'common' | 'uncommon' | 'rare' | 'very_rare' | 'legendary'>('common');

  const spendMutation = useMutation({
    mutationFn: (body: { kind: 'magic_item'; rarity: typeof rarity } | { kind: 'charisma_boost' } | { kind: 'resurrection' }) =>
      api.post<{ bastion: Bastion }>(`/campaigns/${campaignId}/bastions/${bastion.id}/spend-bp`, body),
    onSuccess: onChanged,
  });

  if (bastion.status !== 'active') return null;

  return (
    <Card className="gap-3">
      <CardKicker>{t('bastions.spendBpTitle')}</CardKicker>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('bastions.rarityLabel')} htmlFor="spendBpRarity">
          <Select id="spendBpRarity" value={rarity} onChange={(e) => setRarity(e.target.value as typeof rarity)}>
            <option value="common">{t('bastions.rarity.common')} (20)</option>
            <option value="uncommon">{t('bastions.rarity.uncommon')} (70)</option>
            <option value="rare">{t('bastions.rarity.rare')} (250, lvl 9)</option>
            <option value="very_rare">{t('bastions.rarity.very_rare')} (350, lvl 13)</option>
            <option value="legendary">{t('bastions.rarity.legendary')} (700, lvl 17)</option>
          </Select>
        </Field>
        <Button variant="secondary" size="sm" disabled={spendMutation.isPending} onClick={() => spendMutation.mutate({ kind: 'magic_item', rarity })}>
          {t('bastions.spendMagicItemButton')}
        </Button>
        <Button variant="secondary" size="sm" disabled={spendMutation.isPending} onClick={() => spendMutation.mutate({ kind: 'charisma_boost' })}>
          {t('bastions.spendCharismaBoostButton')}
        </Button>
        <Button variant="secondary" size="sm" disabled={spendMutation.isPending} onClick={() => spendMutation.mutate({ kind: 'resurrection' })}>
          {t('bastions.spendResurrectionButton')}
        </Button>
      </div>
      {spendMutation.isError && <ErrorBanner message={errorMessage(spendMutation.error)} />}
    </Card>
  );
}

function TurnHistorySection({ turns, bastion, isLoading }: { turns: BastionTurn[]; bastion: Bastion; isLoading: boolean }) {
  const { t } = useLocale();
  return (
    <Card className="gap-2">
      <CardKicker>{t('bastions.turnHistoryTitle')}</CardKicker>
      {isLoading && <Loading />}
      {!isLoading && turns.length === 0 && <EmptyState message={t('bastions.noTurnsYet')} />}
      <ul className="space-y-2">
        {[...turns].reverse().map((turn) => (
          <li key={turn.id} className="text-sm text-stone-300 border-b border-stone-800 pb-2 last:border-0">
            <div className="flex items-center justify-between">
              <span>{t('bastions.turnLabel', { number: turn.turn_number, day: turn.in_game_day })}</span>
              <span className="text-xs text-stone-500">
                {turn.was_maintain ? t('bastions.maintainOption') : t('bastions.ordersOption')}
              </span>
            </div>
            {turn.event_key && turn.event_key !== 'nothing' && (
              <p className="text-xs text-amber-500">{t(`bastions.event.${turn.event_key}`)}</p>
            )}
            {turn.orders && turn.orders.length > 0 && (
              <ul className="text-xs text-stone-500 ml-2">
                {turn.orders.map((order: BastionOrder) => (
                  <li key={order.id}>
                    {t(`bastions.orderType.${order.order_type}`)} — {t('bastions.bpAwardedInline', { bp: order.bp_awarded })}
                    {order.result?.note ? ` — ${order.result.note}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-stone-600">{t('bastions.currentBpLabel', { bp: bastion.bastion_points })}</p>
    </Card>
  );
}

function DangerSection({ campaignId, bastion, onChanged }: { campaignId: string; bastion: Bastion; onChanged: () => void }) {
  const { t } = useLocale();

  const skipMutation = useMutation({
    mutationFn: () => api.post<{ bastion: Bastion }>(`/campaigns/${campaignId}/bastions/${bastion.id}/skip-turn`, {}),
    onSuccess: onChanged,
  });
  const abandonMutation = useMutation({
    mutationFn: () => api.post<{ bastion: Bastion }>(`/campaigns/${campaignId}/bastions/${bastion.id}/abandon`, {}),
    onSuccess: onChanged,
  });

  return (
    <Card className="gap-2 border border-red-900/40">
      <CardKicker>{t('bastions.dangerTitle')}</CardKicker>
      <p className="text-xs text-stone-500">{t('bastions.skipTurnHint')}</p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={skipMutation.isPending} onClick={() => skipMutation.mutate()}>
          {t('bastions.skipTurnButton')}
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={abandonMutation.isPending}
          onClick={() => {
            if (window.confirm(t('bastions.abandonConfirm'))) abandonMutation.mutate();
          }}
        >
          {t('bastions.abandonButton')}
        </Button>
      </div>
      {(skipMutation.isError || abandonMutation.isError) && (
        <ErrorBanner message={errorMessage((skipMutation.error ?? abandonMutation.error) as unknown)} />
      )}
    </Card>
  );
}
