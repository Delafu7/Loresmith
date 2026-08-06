// Shared response/request shapes mirroring the server's actual contract
// (read from packages/server/src/{routes,schemas,services,sockets}). GET
// responses are largely raw `SELECT *` rows from services (snake_case);
// request bodies follow the Zod schemas (camelCase). Keep both conventions
// distinct rather than normalizing, so a diff against the server stays easy.

export type CampaignRole = 'dm' | 'player';

export type UiTheme = 'crimson' | 'amber' | 'ember';

export type Locale = 'en' | 'es' | 'fr';

export type TextSize = 'normal' | 'large';

export interface User {
  id: string;
  email: string;
  displayName: string;
  // Customizable Styles per Role (Phase 3.9) — a personal preference, not
  // tied to any campaign or role; see auth/AuthContext.tsx for how this
  // gets applied to <html data-theme> and index.css for the actual palette.
  uiTheme: UiTheme;
  // Interface language (i18n first pass) — same personal-preference shape
  // as uiTheme; see i18n/LocaleContext.tsx for how this is applied.
  locale: Locale;
  // My Profile (nav point 6) — avatar follows the user across every
  // campaign (not a campaign_assets FK); textSize is the one accessibility
  // preference backed by a real effect (root font-size override, index.css).
  avatarUrl: string | null;
  textSize: TextSize;
}

export interface Membership {
  campaignId: string;
  campaignName: string;
  role: CampaignRole;
}

export interface Campaign {
  id: string;
  name: string;
  dm_user_id: string;
  srd_edition: '2014' | '2024';
  description: string | null;
  created_at: string;
  archived_at: string | null;
  my_role?: CampaignRole; // present only on the list endpoint
  // Automated Ability Score Rolls (Phase 3.8) — DM-togglable, whether a
  // player may re-roll their 4d6-drop-lowest set after seeing the results.
  allow_ability_reroll: boolean;
}

export interface CampaignMember {
  id: string;
  campaign_id: string;
  user_id: string;
  role: CampaignRole;
  joined_at: string;
  email: string;
  display_name: string;
  // Per-player character-creation controls (DM-settable). null on
  // max_characters means unlimited.
  can_create_characters: boolean;
  max_characters: number | null;
}

export interface CampaignInvitation {
  id: string;
  campaign_id: string;
  invited_email: string;
  invited_by_user_id: string;
  role: CampaignRole;
  status: 'pending' | 'accepted' | 'revoked';
  created_at: string;
  responded_at: string | null;
  // Present only on GET /me/invitations (joined in for display there).
  campaign_name?: string;
}

export interface Character {
  id: string;
  campaign_id: string;
  is_pc: boolean;
  owner_user_id: string | null;
  created_by_user_id: string;
  name: string;
  race_id: string | null;
  subrace_id: string | null;
  background_id: string | null;
  alignment: string | null;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  armor_class: number;
  armor_class_mode: 'auto' | 'manual';
  speed: number;
  hp_max: number;
  hp_current: number;
  hp_temp: number;
  hit_dice_remaining: Record<string, number> | null;
  exhaustion_level: number;
  senses: string | null;
  languages: number[] | null;
  is_alive: boolean;
  notes: string | null;
  portrait_asset_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CharacterClass {
  character_id: string;
  class_id: string;
  subclass_id: string | null;
  level: number;
}

export type SkillProficiencyLevel = 'proficient' | 'expertise';

export interface SkillProficiency {
  character_id: string;
  skill_id: string;
  level: SkillProficiencyLevel;
}

export interface SavingThrowProficiency {
  character_id: string;
  ability_score_id: string;
}

export interface AbilityScoreCatalog {
  id: string;
  index_key: string;
  name: string;
  full_name: string;
}

export interface DamageTypeCatalog {
  id: string;
  index_key: string;
  name: string;
  description: string | null;
}

export interface SkillCatalog {
  id: string;
  index_key: string;
  name: string;
  ability_score_id: string;
}

export interface RaceCatalog {
  id: string;
  index_key: string;
  name: string;
  edition_scope: '2014' | '2024' | 'both';
}

export interface ClassCatalog {
  id: string;
  index_key: string;
  name: string;
  edition_scope: '2014' | '2024' | 'both';
  hit_die: number;
}

export interface SubclassCatalog {
  id: string;
  class_id: string;
  index_key: string;
  name: string;
}

export interface BackgroundCatalog {
  id: string;
  index_key: string;
  name: string;
  edition_scope: '2014' | '2024' | 'both';
}

export interface MonsterCatalogEntry {
  id: string;
  slug: string;
  name: string;
  edition_scope: '2014' | '2024' | 'both';
  size: string;
  creature_type: string;
  alignment: string | null;
  armor_class: number;
  armor_class_notes: string | null;
  hit_point_average: number;
  hit_dice: string;
  speed: Record<string, unknown>;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  saving_throws: Record<string, number> | null;
  skills: Record<string, number> | null;
  damage_vulnerabilities: string[] | null;
  damage_resistances: string[] | null;
  damage_immunities: string[] | null;
  senses: string | null;
  languages: string | null;
  challenge_rating: number;
  xp_value: number;
  traits: unknown;
  actions: unknown;
  legendary_actions: unknown;
  reactions: unknown;
  source: string | null;
  // Phase 3.2: homebrew bestiary entries (routes/monsters.ts's
  // campaignMonstersRouter). Global/seeded rows have is_homebrew=false and
  // owning_campaign_id=null; a campaign's own homebrew creatures union in via
  // GET /catalog/monsters?campaignId=.
  is_homebrew: boolean;
  owning_campaign_id: string | null;
  // Iteration 2 "Shared bestiary" — the other homebrew ownership tier,
  // mutually exclusive with owning_campaign_id: "my library, reusable
  // across every campaign I run." Provenance for a fork made via the
  // duplicate action — null unless this row was forked from another.
  owning_user_id: string | null;
  derived_from_template_id: string | null;
  art_asset_id: string | null;
  // Catalog-level: caps monster_instances at 1 per campaign for this stat
  // block (named legendary villains etc.) — see services/monsters.ts.
  is_unique: boolean;
  // REFACTOR-PLAN.md §1.1: plain-URL image, works for global AND homebrew
  // rows (unlike art_asset_id, which needs a campaign_assets upload).
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

// Shared shape for stat-block entries (traits/actions/legendaryActions/
// reactions). Homebrew rows written via POST/PATCH /campaigns/:id/monsters
// always use {name, description, ...} (schemas/monsterCatalog.ts's
// statBlockEntrySchema); OLD seeded rows (db/seeds/demo.ts) instead use
// {name, desc}. Both fields are declared optional here so a single type can
// describe either shape — consumers should read `description ?? desc`.
export interface StatBlockEntry {
  name: string;
  description?: string;
  desc?: string;
  attackBonus?: number;
  damageDice?: string;
  damageType?: string;
  saveDc?: number;
  saveAbilityIndex?: string;
}

// REFACTOR-PLAN.md §6 — a character's structured, selectable attack list
// (packages/server/src/db/migrations/..._add-attacks-and-damage-resistance.ts).
// Raw DB row shape (snake_case) — same "GET returns the raw row" convention
// as most other sub-resource list endpoints in this app.
export interface CharacterAttack {
  id: string;
  character_id: string;
  name: string;
  attack_bonus: number | null;
  damage_dice: string | null;
  damage_type: string | null;
  save_dc: number | null;
  save_ability_index: string | null;
  half_on_save: boolean;
  notes: string | null;
  sort_order: number;
}

export type MonsterInstanceStatus = 'alive' | 'dead' | 'fled' | 'captured';

export interface MonsterInstance {
  id: string;
  campaign_id: string;
  monster_id: string;
  custom_name: string | null;
  hp_max_override: number | null;
  hp_current: number;
  hp_temp: number;
  status: MonsterInstanceStatus;
  is_recurring: boolean;
  notes: string | null;
  created_at: string;
  // present on the list endpoint (joined with monsters catalog)
  monster_name?: string;
  monster_slug?: string;
  challenge_rating?: number;
  hit_point_average?: number;
  // Effective hp_max (COALESCE of hp_max_override / hit_point_average),
  // computed server-side (services/monsters.ts).
  hp_max?: number;
  // Weakness-reveal-gated (see entityFieldReveal.ts) — null for a player
  // role until the DM reveals it; always the true value for the DM.
  damage_vulnerabilities?: string[] | null;
  damage_resistances?: string[] | null;
  damage_immunities?: string[] | null;
}

// ---- Task 1: per-campaign bestiary curation + generic categories ----
// (packages/server/src/{routes,services}/campaignBestiary.ts,
// campaignCategories.ts) — a reference to a MonsterCatalogEntry plus
// campaign-scoped overrides, distinct from MonsterInstance (a live combat
// copy) and from homebrew monsters (a DM-authored new catalog row). No FK
// relationship to either — adding/removing an entry never touches combat
// instances or the catalog.

export interface CampaignCategory {
  id: string;
  campaign_id: string;
  entity_type: string;
  name: string;
  color: string | null;
  icon: string | null;
  sort_order: number;
  created_at: string;
}

export interface CampaignBestiaryEntry {
  id: string;
  campaign_id: string;
  monster_id: string;
  custom_name: string | null;
  // Raw override blob (snake_case keys matching monster columns) — prefer
  // `effective` for display; this is mainly useful to know which fields were
  // explicitly overridden.
  stat_overrides: Record<string, unknown>;
  notes: string | null;
  discovered: boolean;
  added_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  categories: CampaignCategory[];
  // The unmodified catalog row.
  monster: MonsterCatalogEntry;
  // monster with stat_overrides shallow-merged on top — what the UI should
  // render as this creature's actual stat block in this campaign.
  effective: MonsterCatalogEntry;
  // Iteration 2 "Shared bestiary" — DISTINCT campaign count currently
  // curating this template, computed fresh server-side on every read. 1
  // means "just this campaign" — render no badge, not a redundant one.
  shared_campaign_count: number;
}

export type EncounterStatus = 'preparing' | 'active' | 'paused' | 'completed';

// Exploration (free player movement, no turn/budget checks) vs. combat
// (strict turn-order + movement-budget enforcement) — a DM toggle
// independent of `status`. See services/encounters.ts's
// computeValidatedMoveCost.
export type EncounterMode = 'exploration' | 'combat';

// Orthogonal to CombatParticipant.faction (which side a participant is on):
// disposition is "is this scene currently a fight" — one value per
// encounter, changed via a logged transition (POST .../disposition), not a
// raw field edit. See 1784269787666_add-encounter-disposition.ts.
export type EncounterDisposition = 'friendly' | 'neutral' | 'hostile' | 'unknown';

export interface EncounterDispositionEvent {
  id: string;
  encounter_id: string;
  from_disposition: EncounterDisposition;
  to_disposition: EncounterDisposition;
  changed_by_user_id: string;
  note: string | null;
  created_at: string;
}

export interface Encounter {
  id: string;
  campaign_id: string;
  name: string;
  status: EncounterStatus;
  mode: EncounterMode;
  disposition: EncounterDisposition;
  current_round: number;
  current_turn_index: number;
  sync_seq: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  /** Only populated by GET /campaigns/:id/encounters (listEncounters) — a
   * cheap COUNT subquery added for MapSectionPage.tsx's focus-encounter
   * pick. Absent (undefined) from every other encounter-shaped response. */
  participant_count?: number;
}

export interface CombatParticipant {
  id: string;
  encounter_id: string;
  character_id: string | null;
  monster_instance_id: string | null;
  initiative_roll: number;
  initiative_tiebreak: number | null;
  turn_order: number;
  joined_round: number;
  left_round: number | null;
  created_at: string;
}

export interface EncounterWithParticipants extends Encounter {
  participants: CombatParticipant[];
}

// HP is always visible to every campaign member now (hide/reveal was
// removed) — every participant carries the real numbers.
export interface ParticipantHp {
  hpCurrent: number;
  hpMax: number;
  hpTemp: number;
}

// FULL_STATE_SYNC / snapshot participant row shape, enriched with name.
export interface SnapshotParticipant {
  participantId: string;
  characterId: string | null;
  monsterInstanceId: string | null;
  name: string;
  initiativeRoll: number;
  initiativeTiebreak: number | null;
  turnOrder: number;
  hp: ParticipantHp;
  effects: ActiveEffectSummary[];
  // Battle map (Phase 3.3) — cell indices (x=3 is the 4th column), not pixel
  // offsets. Null means the DM hasn't placed this participant on the map yet.
  posX: number | null;
  posY: number | null;
  // Phase 3.5: server-side COALESCE of character.armor_class /
  // monster_instance.armor_class_override / monster.armor_class (see
  // FULL_STATE_SYNC's participants shape). Always visible now (hide/reveal
  // was removed) — armor class is never redacted for any role.
  armorClass: number;
  // Phase 3.6: per-turn 5e action economy — reset server-side whenever this
  // participant's turn starts (see services/encounters.ts's advanceTurn).
  actionUsed: boolean;
  bonusActionUsed: boolean;
  reactionUsed: boolean;
  dashUsed: boolean;
  movementUsedFt: number;
  // REFACTOR-PLAN.md §5 — a fourth per-turn tracked resource, separate from
  // the three economy slots above (docs/rules/actions.md §1.6).
  objectInteractionUsed: boolean;
  // Display-only movement budget in feet (see CombatSnapshotParticipant's
  // speed_ft comment) — null if neither the character's speed column nor
  // the monster's speed.walk resolved to a usable number.
  speedFt: number | null;
  // Null for character participants. REFACTOR-PLAN.md §1: the map view only
  // renders a token for status='alive' monster instances.
  monsterInstanceStatus: 'alive' | 'dead' | 'fled' | 'captured' | null;
  // REFACTOR-PLAN.md §3 — see docs/rules/creature-sizes.md. Free-text catalog
  // string ('Medium' fallback for character participants); normalize before
  // using as a lookup key (see encounters/creatureSize.ts).
  size: string;
  faction: 'player' | 'ally' | 'enemy' | 'neutral';
  // Nav point 4 bug fix — resolved by the server (character portrait, or
  // monster homebrew art / catalog image_url); null renders Portrait's
  // existing initials/silhouette fallback, never a broken-image icon.
  imageUrl: string | null;
  // Encounter visibility by state (nav point 1) — always true for a player's
  // own payload (a hidden row is omitted entirely, never sent redacted); only
  // meaningful to read for the DM view, to render the reveal/hide toggle.
  visibleToPlayers: boolean;
}

// ---- Phase 2: spells/items/resources/effects (packages/server/src/routes/
// characters.ts's spells/items/resources sub-routes, routes/effects.ts,
// routes/rests.ts) ----

export interface SpellCatalogEntry {
  id: string;
  slug: string;
  name: string;
  edition_scope: '2014' | '2024' | 'both';
  level: number; // 0 = cantrip
  school_id: string;
  casting_time: string;
  range: string;
  component_v: boolean;
  component_s: boolean;
  component_m: boolean;
  material_description: string | null;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  saving_throw_ability_id: string | null;
  attack_type: 'melee' | 'ranged' | null;
  damage_at_level: Record<string, unknown> | null;
  description: string;
  higher_level_description: string | null;
  source: string | null;
}

export type CharacterSpellSource = 'class' | 'race' | 'feat' | 'item';

export interface CharacterSpell {
  id: string;
  character_id: string;
  spell_id: string;
  class_id: string | null;
  is_prepared: boolean;
  always_prepared: boolean;
  source: CharacterSpellSource;
}

export type ItemType =
  | 'weapon'
  | 'armor'
  | 'shield'
  | 'tool'
  | 'adventuring_gear'
  | 'magic_item'
  | 'consumable'
  | 'mount'
  | 'vehicle';

export type ItemRarity = 'mundane' | 'common' | 'uncommon' | 'rare' | 'very_rare' | 'legendary' | 'artifact';

export interface ItemCatalogEntry {
  id: string;
  slug: string;
  name: string;
  edition_scope: '2014' | '2024' | 'both';
  item_type: ItemType;
  rarity: ItemRarity;
  weight_lb: number | null;
  cost_cp: number | null;
  armor_class_base: number | null;
  armor_class_formula: string | null;
  // Phase 3.5: structured armor fields `computeArmorClass` actually reads
  // (armor_class_formula stays a legacy display string). Null for non-armor
  // item types.
  armor_category: 'light' | 'medium' | 'heavy' | null;
  dex_modifier_rule: 'full' | 'max_2' | 'none' | null;
  str_requirement: number | null;
  stealth_disadvantage: boolean;
  damage_dice: string | null;
  damage_type_id: string | null;
  requires_attunement: boolean;
  properties: Record<string, unknown> | null;
  description: string | null;
  source: string | null;
  is_homebrew: boolean;
  owning_campaign_id: string | null;
}

// PATCH /characters/:id/items/:itemId body shape (schemas/characterItems.ts's
// updateCharacterItemSchema — camelCase, all fields optional/partial).
export interface UpdateCharacterItemBody {
  quantity?: number;
  isEquipped?: boolean;
  isAttuned?: boolean;
  customName?: string | null;
  chargesRemaining?: number | null;
  notes?: string | null;
}

export interface CharacterItem {
  id: string;
  character_id: string | null;
  monster_instance_id: string | null;
  // Campaign-owned stash instance (nav point 5) — set when neither
  // character_id nor monster_instance_id is (see the add-campaign-item-
  // stash migration's "exactly one of the three" invariant).
  campaign_id: string | null;
  item_id: string;
  quantity: number;
  is_equipped: boolean;
  is_attuned: boolean;
  custom_name: string | null;
  charges_remaining: number | null;
  notes: string | null;
  acquired_at: string;
}

export type RechargeOn = 'short_rest' | 'long_rest' | 'dawn' | 'none';

export interface ResourcePool {
  id: string;
  character_id: string;
  resource_key: string;
  current_value: number;
  max_value: number;
  recharge_on: RechargeOn;
}

export type EffectDurationType =
  | 'rounds'
  | 'minutes'
  | 'hours'
  | 'until_save'
  | 'until_removed'
  | 'permanent'
  | 'special';

export interface EffectDefinitionCatalog {
  id: string;
  condition_id: string | null;
  name: string;
  description: string | null;
  default_duration_type: EffectDurationType;
  default_duration_value: number | null;
  concentration: boolean;
  stacking_rule: 'none' | 'stack' | 'refresh';
  is_homebrew: boolean;
  owning_campaign_id: string | null;
}

// The full active_effects row, as returned by GET /characters/:id/effects,
// GET /monster-instances/:id/effects, and GET /encounters/:id/effects.
export interface ActiveEffect {
  id: string;
  effect_definition_id: string;
  effect_definition_name: string;
  character_id: string | null;
  monster_instance_id: string | null;
  encounter_id: string | null;
  source_character_id: string | null;
  source_spell_id: string | null;
  source_type: 'spell' | 'class_feature' | 'monster_ability' | 'item' | 'manual';
  duration_type: EffectDurationType;
  duration_value: number | null;
  stack_count: number | null;
  applied_at_round: number | null;
  save_dc: number | null;
  save_ability_id: string | null;
  concentration: boolean;
  removed_at: string | null;
  notes: string | null;
  created_at: string;
}

// The compact per-participant shape carried on FULL_STATE_SYNC /
// EFFECT_APPLIED / EFFECT_EXPIRED (sockets/broadcast.ts's formatEffectForWire).
export interface ActiveEffectSummary {
  effectId: string;
  effectDefinitionId: string;
  name: string;
  durationType: EffectDurationType;
  durationRemaining: number | null;
  concentration: boolean;
  sourceCharacterId: string | null;
}

export interface MulticlassPrereqFailure {
  classId: string;
  className: string;
  abilityIndex: string;
  required: number;
  actual: number;
}

// ---- Phase 3.1: images / file uploads (routes/assets.ts, services/assets.ts) ----

export type AssetType = 'image' | 'handout';

export interface CampaignAsset {
  id: string;
  campaign_id: string;
  uploaded_by_user_id: string;
  asset_type: AssetType;
  file_url: string; // relative path, e.g. /uploads/campaigns/1/<uuid>.png — serve directly as <img src>
  mime_type: string;
  file_size_bytes: number;
  title: string | null;
  created_at: string;
  updated_at: string;
}

// Campaign-scoped map library (1784269788666_create-campaign-maps-library.ts)
// — a reusable location, linkable N:M to encounters via
// /encounters/:id/maps/:mapId/link and /encounters/:id/active-map. Distinct
// from `MapConfig` (socketTypes.ts), the wire shape for "this encounter's
// CURRENTLY ACTIVE map" as seen in the live view.
// Read-only derivation (services/encumbrance.ts) — GET /characters/:id/encumbrance.
export interface Encumbrance {
  carryCapacityLb: number;
  encumberedThresholdLb: number;
  heavilyEncumberedThresholdLb: number;
  totalCarriedLb: number;
  encumbered: boolean;
  heavilyEncumbered: boolean;
}

export interface CampaignMap {
  id: string;
  campaign_id: string;
  name: string;
  description: string | null;
  background_asset_id: string | null;
  grid_columns: number;
  grid_rows: number;
  cell_size_px: number;
  feet_per_cell: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  campaign_id: string;
  session_id: string | null;
  location_id: string | null;
  character_id: string | null;
  author_user_id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

// Session log (game-night recap, routes/campaigns.ts's /:id/sessions —
// distinct from the LIVE combat "Session" nav item/EncountersPage).
export interface SessionLog {
  id: string;
  campaign_id: string;
  session_number: number;
  title: string | null;
  played_at: string | null;
  recap: string | null;
  created_at: string;
  updated_at: string;
}

// GET /me/dashboard (Phase 3.6) — the campaign_name join field only exists
// on this aggregate endpoint's rows, not on the plain Character/Note shapes
// above (which come from campaign-scoped endpoints that don't need it).
export interface DashboardCharacter extends Character {
  campaign_name: string;
}

export interface DashboardNote extends Note {
  campaign_name: string;
}

export interface DashboardResponse {
  campaigns: Campaign[];
  characters: DashboardCharacter[];
  myNotes: DashboardNote[];
  campaignNotes: DashboardNote[];
}

// ---- Phase 3.4: server-authoritative d20 dice rolls (routes/diceRolls.ts) ----

export type DiceRollType =
  | 'ability_check'
  | 'saving_throw'
  | 'skill_check'
  | 'attack'
  | 'initiative'
  | 'death_save'
  | 'custom'
  | 'damage';

export type DiceRollKeep = 'normal' | 'advantage' | 'disadvantage';

export const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;
export type DiceSides = (typeof DICE_SIDES)[number];

// GET/POST /campaigns/:id/dice-rolls's raw dice_rolls row (snake_case, per
// this file's usual REST-response convention). `d20_rolls` has 1 element
// normally, 2 for advantage/disadvantage — both dice are always included so
// the UI can render both, not just the kept one. Nat20/nat1 highlighting
// must be derived from `d20_rolls` values, never from `result_total` (which
// includes `modifier` and could coincidentally match 20/1).
export interface DiceRoll {
  id: string;
  campaign_id: string;
  user_id: string;
  character_id: string | null;
  monster_instance_id: string | null;
  encounter_id: string | null;
  roll_type: DiceRollType;
  roll_context: string | null;
  d20_rolls: number[];
  keep: DiceRollKeep;
  dice_sides: DiceSides;
  dice_count: number;
  modifier: number;
  result_total: number;
  created_at: string;
}

// POST /campaigns/:id/roll-ability-scores's response (Phase 3.8) — one of
// these per ability, six total. `dice`/`droppedIndex` are shown so the
// player can see the discarded die, not just the final total.
export interface AbilityScoreRollSet {
  dice: number[];
  droppedIndex: number;
  total: number;
}

// POST /encounters/:id/participants/:pid/shove's response (Phase 3.7). Both
// rolls are already-persisted dice_rolls rows (see services/shove.ts) except
// defenderRoll, which is null when the DM supplied defenderRollOverride —
// there's no roll to show in that case, just the DM's adjudicated total.
export interface ShoveResult {
  // Raw combat_participants row (snake_case) — unlike SnapshotParticipant,
  // never read directly; ACTION_ECONOMY_CHANGED over the socket is what
  // actually updates the UI (same "no local cache write" discipline as
  // ActionEconomyPanel's spendMutation).
  participant: Record<string, unknown>;
  attackerRoll: DiceRoll;
  defenderRoll: DiceRoll | null;
  defenderTotal: number;
  defenderOverridden: boolean;
  success: boolean;
  outcome: 'push_5ft' | 'knock_prone' | null;
  message: string;
}

// POST /encounters/:id/participants/:pid/grapple's response (Phase 7) —
// same shape as ShoveResult, just no push/prone outcome (a successful
// Grapple always means "the target is now Grappled") and an appliedEffect
// (the new active_effects row, null on failure) instead.
export interface GrappleResult {
  participant: Record<string, unknown>;
  attackerRoll: DiceRoll;
  defenderRoll: DiceRoll | null;
  defenderTotal: number;
  defenderOverridden: boolean;
  success: boolean;
  appliedEffect: Record<string, unknown> | null;
  message: string;
}
