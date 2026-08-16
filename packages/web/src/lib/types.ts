// Shared response/request shapes mirroring the server's actual contract
// (read from packages/server/src/{routes,schemas,services,sockets}). GET
// responses are largely raw `SELECT *` rows from services (snake_case);
// request bodies follow the Zod schemas (camelCase). Keep both conventions
// distinct rather than normalizing, so a diff against the server stays easy.

export type CampaignRole = 'dm' | 'player' | 'spectator';

export type UiTheme = 'crimson' | 'amber' | 'ember';

export type Locale = 'en' | 'es' | 'fr';

export type TextSize = 'normal' | 'large';

export type UnitSystem = 'imperial' | 'metric';

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
  // Distance-unit preference (Iteration 4) — same personal-preference shape
  // as textSize; see lib/units.ts's formatDistance for how this is applied.
  unitSystem: UnitSystem;
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
  // Phase 4 "Bastion tracking" — DM opt-in (docs/rules/bastions.md §1).
  bastions_enabled: boolean;
  // REFACTOR-PLAN.md §4 (1784269766666_add-movement-cost-schema.ts) — already
  // consumed server-side by services/movement.ts's MovementGrid; exposed here
  // too so the client's drag-time distance preview (encounters/dragPreview.ts)
  // can mirror the same rule instead of assuming 'flat'.
  diagonal_movement_rule: 'flat' | 'alternating_5_10_5';
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
  // Iteration 2 "Character ownership vs. control" — set when this invitation
  // doubles as "invite this specific person to claim this pre-built PC"
  // (accepting it sets the character's owner_user_id in the same
  // transaction as the membership insert). Null for a plain membership
  // invitation, unchanged from before this iteration.
  character_id: string | null;
}

// Iteration 2 "Character ownership vs. control" — one row per delegate/
// revoke action (services/characterControl.ts's character_control_delegations
// table), newest first. Read-only history for dispute resolution.
export interface ControlDelegationEvent {
  id: string;
  character_id: string;
  from_controller_user_id: string | null;
  to_controller_user_id: string | null;
  granted_by_user_id: string;
  reason: string | null;
  encounter_id: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface Character {
  id: string;
  campaign_id: string;
  is_pc: boolean;
  owner_user_id: string | null;
  // Iteration 2 "Character ownership vs. control" — who's actually driving
  // this character right now, separate from stable ownership above. Null
  // means "defer to owner_user_id" (the default for every character that's
  // never had control delegated). See services/characterControl.ts.
  controller_user_id: string | null;
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
  // Iteration 2's one concrete GM-only field — DM-only read/write; the
  // server strips it from any response served to a non-DM (redactGmNotes in
  // services/characters.ts), so a player's Character always has this null.
  gm_notes: string | null;
  // Phase 3 "NPC 'what they want' field" — same DM-only redaction as
  // gm_notes above (extended into the same redactGmNotes function).
  npc_motivation: string | null;
  // DM hide/reveal for NPCs (role_split, same shape as
  // Location/Faction.visible_to_players) — only ever meaningful when
  // is_pc is false; a PC is always visible regardless of this value. A
  // player's response never contains a hidden NPC row at all (server-side
  // filtered), so this is only meaningful to a DM viewer.
  visible_to_players: boolean;
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

// Phase 2 "weapon mastery (2024)" — GET /catalog/weapon-mastery-properties.
// A weapon's own mastery (if any) is items.properties.mastery, a plain
// string matching one of these rows' index_key — see InventoryPanel.tsx.
export interface WeaponMasteryPropertyCatalog {
  id: string;
  index_key: string;
  name: string;
  description: string;
}

export interface SkillCatalog {
  id: string;
  index_key: string;
  name: string;
  ability_score_id: string;
}

// ability_bonuses' shape is NOT uniform: official/seeded rows carry the raw
// SRD JSON array shape (`[{ ability_score: { index }, bonus }]`), while
// homebrew rows authored through the catalog editor carry the Zod schema's
// flat-map shape (`Record<string, number>`, schemas/catalogHomebrew.ts's
// raceHomebrewShape). `unknown` here on purpose — see
// characters/deriveAbilityBonuses.ts for the normalizer that reconciles both
// shapes into one; nothing else should read this field directly.
export interface RaceCatalog {
  id: string;
  index_key: string;
  name: string;
  edition_scope: '2014' | '2024' | 'both';
  speed: number;
  size: string;
  ability_bonuses: unknown;
  is_homebrew?: boolean;
  owning_campaign_id?: string | null;
  owning_user_id?: string | null;
}

export interface SubraceCatalog {
  id: string;
  race_id: string;
  index_key: string;
  name: string;
  ability_bonuses: unknown;
}

export interface ClassCatalog {
  id: string;
  index_key: string;
  name: string;
  edition_scope: '2014' | '2024' | 'both';
  hit_die: number;
  // Substitutes for subclasses having zero mechanical data columns today
  // (compendium feature decision — see the plan's "Substitute class-level
  // effects" note): character creation auto-populates saving-throw
  // proficiency toggles from the selected CLASS's own proficiencies, since
  // subclasses have none of their own to read.
  saving_throw_proficiency_ids: string[] | null;
  is_homebrew?: boolean;
  owning_campaign_id?: string | null;
  owning_user_id?: string | null;
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

export interface FeatCatalog {
  id: string;
  index_key: string;
  name: string;
  edition_scope: '2014' | '2024' | 'both';
  prerequisite: string | null;
  description: string;
  is_homebrew: boolean;
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
  // Phase 2 "legendary actions per-round counters" — the budget per round;
  // null for a creature with no legendary actions.
  legendary_action_count: number | null;
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
  // Phase 2 "legendary actions per-round counters" — only meaningful on a
  // legendaryActions entry; absent (not just falsy) defaults to 1 wherever
  // this is read.
  cost?: number;
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
  // Iteration 4 — this entry's image gallery, already role-filtered
  // server-side (a player never receives a GM-only image's row at all).
  images: BestiaryEntryImage[];
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

// Campaign race/class curation (packages/server/src/{routes,services}/
// campaignRaces.ts, campaignClasses.ts) — a reference to a RaceCatalog/
// ClassCatalog row plus campaign-scoped overrides, mirroring
// CampaignBestiaryEntry's shape (no categories/images/discovered flag,
// those are bestiary-specific). No FK relationship to characters.race_id/
// character_classes.class_id — a character keeps pointing at the catalog row
// directly, so importing/removing an entry never affects existing characters.

export interface CampaignRaceEntry {
  id: string;
  campaign_id: string;
  race_id: string;
  custom_name: string | null;
  // Raw override blob (snake_case keys matching races columns) — prefer
  // `effective` for display.
  overrides: Record<string, unknown>;
  notes: string | null;
  added_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  race: RaceCatalog;
  effective: RaceCatalog;
}

export interface CampaignClassEntry {
  id: string;
  campaign_id: string;
  class_id: string;
  custom_name: string | null;
  overrides: Record<string, unknown>;
  notes: string | null;
  added_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  class: ClassCatalog;
  effective: ClassCatalog;
}

export interface BestiaryEntryImage {
  id: string;
  asset_id: string;
  file_url: string;
  title: string | null;
  visible_to_players: boolean;
  sort_order: number;
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
  // Phase 2 "lair actions (round-start trigger)" — DM-authored per-encounter,
  // DM-only (redacted for a non-DM viewer; undefined, not null, for a player).
  lair_actions: Array<{ name: string; description: string }> | null;
  // Phase 3 "terrain/complications on encounters" — visible to every
  // campaign member, unlike lair_actions above.
  terrain_notes: string | null;
  // Phase 3 "locations and factions".
  location_id: string | null;
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

// Phase 2 "restore hp_visibility + banding" reversed the prior "HP always
// visible" state — combat_participants.hp_visibility now decides what a
// non-DM viewer's socket actually receives, computed server-side
// (sockets/broadcast.ts's resolveHpForViewer). The first branch covers BOTH
// "this is the DM's socket" (numbers always present, whatever the real
// hpVisibility is) and "this is a player's socket and hpVisibility is
// 'exact'" — a receiving component can't tell those two apart from the
// payload alone and doesn't need to. `band`/nothing only ever arrive for a
// player whose hpVisibility is 'banded'/'hidden'.
// Deliberately the same vocabulary as HPBar.tsx's pre-existing status label
// (Healthy/Injured/Bloodied/Critical/Down) — see domain/hpBanding.ts's
// (server-side) comment for why.
export type HpBand = 'healthy' | 'injured' | 'bloodied' | 'critical' | 'down';
export type ParticipantHp =
  | { hpVisibility: 'exact' | 'banded' | 'hidden'; hpCurrent: number; hpMax: number; hpTemp: number }
  | { hpVisibility: 'banded'; band: HpBand }
  | { hpVisibility: 'hidden' };

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
  // Phase 2 "legendary actions per-round counters" — null for a
  // non-legendary participant. Always visible (no redaction).
  legendaryActionsRemaining: number | null;
  // DM battle-map vision feature — encounter-scoped, DM-tunable per fight
  // (see server's 1784269817666_add-participant-vision.ts). No redaction,
  // same as faction/speed above.
  visionEnabled: boolean;
  visionRadiusFt: number;
  darkvisionRadiusFt: number;
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

// GET/PATCH /characters/:id/currency (Phase 1.5). No `id` — 1:1 with the
// character, PK = character_id.
export interface CharacterCurrency {
  character_id: string;
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
  updated_at: string;
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
  visible_to_players: boolean;
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

export type MapLightingState = 'bright' | 'dim' | 'dark';

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
  lighting_state: MapLightingState;
  created_at: string;
  updated_at: string;
}

// Generic DM map elements (walls/doors/lights/areas/notes/images) — see
// server/src/services/mapElements.ts's header comment for the persistence
// rationale (scoped to CampaignMap.id, not one encounter). Coordinates
// (x1/y1/x2/y2, and each point in `points`) are grid-cell units — the same
// space as SnapshotParticipant.posX/posY — not pixels, so they stay valid
// across a background swap or cellSizePx change; fractional values are
// allowed (e.g. a wall snapped to a cell edge sits at a whole number, but
// nothing stops finer placement). Pixel conversion is a render-time concern
// (`cellSizePx` from MapConfig), formalized in encounters/geometry.ts.
//
// One arm per `type`, discriminated exactly like ParticipantHp above. Adding
// a new type here + a schemas/mapElements.ts Zod branch (server) + one
// encounters/elements/registry.ts entry (client) is the whole surface area —
// no renderer/palette/property-panel file should ever need a type-specific
// edit (proven by `image`, which has zero legacy system underneath it).
// GM-only visibility layer — replaces the old visibleToPlayers boolean.
// ownerUserId is only meaningful when visibility is 'owner_only'.
export type GmVisibility = 'gm_only' | 'revealed_to_players' | 'owner_only';

interface MapElementBase {
  id: string;
  mapId: string;
  x1: number;
  y1: number;
  x2: number | null;
  y2: number | null;
  label: string | null;
  visibility: GmVisibility;
  ownerUserId: string | null;
  locked: boolean;
  zIndex: number;
}
export type MapElementType = 'wall' | 'door' | 'light' | 'area' | 'note' | 'image';
export type MapElement =
  | (MapElementBase & { type: 'wall'; points: null; props: Record<string, never> })
  | (MapElementBase & { type: 'door'; points: null; props: { state: 'open' | 'closed' | 'locked' | 'stuck' | 'broken'; forceDC?: number } })
  | (MapElementBase & {
      type: 'light';
      points: null;
      props: { brightRadiusFt: number; dimRadiusFt: number; color: string; intensity: number };
    })
  | (MapElementBase & {
      type: 'area';
      points: { x: number; y: number }[];
      props: { shape: 'rect' | 'circle' | 'polygon'; costType: 'difficult' | 'note-only'; color: string };
    })
  | (MapElementBase & { type: 'note'; points: null; props: { body: string } })
  | (MapElementBase & {
      type: 'image';
      points: null;
      props: { assetId: string | null; widthFt: number; heightFt: number; rotationDeg: number; opacity: number };
    });

// A hidden wall/door/light's redacted server stub (GM-only visibility layer)
// — geometry-only, no label/props, so a non-DM/non-owner viewer's
// fog-of-war raycast / light-radius rendering still works without leaking
// content. note/area/image are omitted entirely instead of redacted (they
// never block vision) — see server's formatMapElementForViewer.
export interface RedactedMapElement {
  id: string;
  mapId: string;
  type: 'wall' | 'door' | 'light';
  x1: number;
  y1: number;
  x2: number | null;
  y2: number | null;
  redacted: true;
  blocksVision?: boolean; // wall/door only
  lightRadii?: { brightRadiusFt: number; dimRadiusFt: number }; // light only
}
export type MapElementOrRedacted = MapElement | RedactedMapElement;

export interface Note {
  id: string;
  campaign_id: string;
  session_id: string | null;
  location_id: string | null;
  character_id: string | null;
  author_user_id: string;
  title: string;
  body: string;
  // Phase 3 "rulings log" — a discriminator, not a second table (matches
  // dice_rolls.roll_type/active_effects.source_type's precedent).
  note_type: 'note' | 'ruling';
  // GM-only visibility layer — 'owner_only' is visible to the DM plus
  // author_user_id.
  visibility: GmVisibility;
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
  // DM-only; redacted (key omitted) for a non-DM viewer, same convention as
  // Character.gm_notes above.
  recap: string | null;
  player_recap: string | null;
  // Phase 3 "locations and factions".
  location_id: string | null;
  created_at: string;
  updated_at: string;
}

// Phase 3 "plot threads" — GET /campaigns/:id/plot-threads.
// visibleToUserIds is DM-only bookkeeping (see services/plotThreads.ts's
// listPlotThreads): present when the viewer is the DM, absent for a player
// (who only ever receives threads they've already been granted).
export interface PlotThread {
  id: string;
  campaign_id: string;
  title: string;
  description: string | null;
  status: 'open' | 'resolved';
  origin_session_id: string | null;
  last_touched_at: string;
  created_at: string;
  visibleToUserIds?: string[];
}

// Phase 3 "locations and factions" — GET /campaigns/:id/locations and
// /campaigns/:id/factions. DM-only write (services/locations.ts,
// services/factions.ts); a player's response never contains a hidden row at
// all (server-side filtered), so `visible_to_players` here is only ever
// meaningful to a DM viewer — a player's own rows are always true.
export interface Location {
  id: string;
  campaign_id: string;
  name: string;
  description: string | null;
  notes: string | null;
  visible_to_players: boolean;
  created_at: string;
  updated_at: string;
}

export interface Faction {
  id: string;
  campaign_id: string;
  name: string;
  description: string | null;
  notes: string | null;
  visible_to_players: boolean;
  created_at: string;
  updated_at: string;
}

// Phase 3 "campaign calendar" — GET /campaigns/:id/events. All-member read,
// DM-only write. in_game_day is days since an arbitrary campaign epoch (day
// 0 = "campaign start"), not a real-world date — see the migration comment
// in services/campaignEvents.ts for why.
export interface CampaignEvent {
  id: string;
  campaign_id: string;
  in_game_day: number;
  title: string;
  description: string | null;
  created_at: string;
}

// Phase 4 "Bastion tracking" — GET /catalog/bastion-facilities. Fixed
// catalog, not homebrewable. See docs/rules/bastions.md.
export interface BastionFacilityCatalogEntry {
  id: string;
  index_key: string;
  name: string;
  facility_type: 'basic' | 'special';
  min_level: number | null;
  prerequisite_text: string | null;
  default_space: 'cramped' | 'roomy' | 'vast' | null;
  hireling_count: number | null;
  order_type: 'craft' | 'empower' | 'harvest' | 'recruit' | 'research' | 'trade' | null;
  bp_die: string | null;
  benefits: { summary: string } | null;
  source_note: string;
}

export interface Bastion {
  id: string;
  campaign_id: string;
  owner_character_id: string;
  name: string | null;
  combined_group_id: string | null;
  bastion_points: number;
  bastion_defenders: number;
  status: 'active' | 'fallen' | 'abandoned';
  turn_interval_days: number;
  last_turn_in_game_day: number | null;
  consecutive_turns_without_orders: number;
  last_resurrection_character_level: number | null;
  created_at: string;
  updated_at: string;
}

export interface BastionFacility {
  id: string;
  bastion_id: string;
  catalog_id: string;
  space: 'cramped' | 'roomy' | 'vast';
  status: 'operational' | 'shut_down';
  config: Record<string, unknown> | null;
  created_at: string;
  catalog: BastionFacilityCatalogEntry;
}

export interface BastionWithFacilities extends Bastion {
  facilities: BastionFacility[];
}

export type BastionOrderType = 'craft' | 'empower' | 'harvest' | 'recruit' | 'research' | 'trade';

export interface BastionOrder {
  id: string;
  bastion_turn_id: string;
  bastion_facility_id: string;
  order_type: BastionOrderType;
  paid_reroll_gp: number | null;
  bp_die_roll: number;
  bp_awarded: number;
  result: { note?: string } | null;
  created_at: string;
}

export type BastionEventKey =
  | 'nothing' | 'attack' | 'lost_hirelings' | 'refugees' | 'friendly_visitors' | 'request_for_aid'
  | 'honored_guest' | 'extraordinary_opportunity' | 'criminal_hireling' | 'magical_discovery';

export interface BastionTurn {
  id: string;
  bastion_id: string;
  turn_number: number;
  in_game_day: number;
  was_maintain: boolean;
  event_roll: number | null;
  event_key: BastionEventKey | null;
  event_outcome: Record<string, unknown> | null;
  created_at: string;
  orders?: BastionOrder[]; // present only on the just-resolved response, not the list endpoint
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
  // Iteration 3 dice-engine rebuild — only ever true for roll_type='damage'
  // rows (applyDamage's server-derived criticality, see
  // services/diceRolls.ts's deriveIsCriticalFromAttackRoll); every other
  // roll type always has this false.
  is_critical: boolean;
  // Iteration 3 §2.3/2.4 — net-new roll capability.
  visibility: DiceRollVisibility;
  visible_to_user_id: string | null;
  is_manual: boolean;
  voided_at: string | null;
  voided_by_user_id: string | null;
  created_at: string;
}

export type DiceRollVisibility = 'public' | 'gm_only' | 'private';

// GM-initiated "please roll X" fan-out (Iteration 3 §2.3).
export interface DiceRollRequest {
  id: string;
  campaign_id: string;
  encounter_id: string | null;
  requested_by_user_id: string;
  roll_type: DiceRollType;
  roll_context: string | null;
  dc: number | null;
  created_at: string;
}

export interface DiceRollRequestTarget {
  id: string;
  request_id: string;
  user_id: string;
  character_id: string | null;
  status: 'pending' | 'rolled' | 'passed';
  dice_roll_id: string | null;
  responded_at: string | null;
  // Only present on the GET .../dice-roll-requests read path — whether the
  // fulfilling roll (if any) is visible to the requesting viewer, per
  // services/diceRolls.ts's isRollVisibleToViewer.
  rollVisible?: boolean;
}

export interface DiceRollRequestWithTargets {
  request: DiceRollRequest;
  targets: DiceRollRequestTarget[];
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

// POST /encounters/:id/participants/:pid/doors/:elementId's response
// (interactive doors) — `roll`/`success` are only populated for a 'force'
// action (open/close never rolls); the door's new state itself is NOT read
// from this response (same "no local cache write" discipline as every other
// combat mutation in this app) — MAP_ELEMENTS_CHANGED over the socket is
// what actually updates the map/sidebar.
export interface DoorActionResult {
  element: MapElement;
  roll: DiceRoll | null;
  success: boolean | null;
  message: string;
}
