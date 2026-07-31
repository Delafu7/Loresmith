// /styleguide (deliverable per the Nocturne redesign brief) — the full
// token set, type scale, and every shared component in every state, in one
// place, viewable at both mobile and desktop widths. Not behind auth (it's
// a design reference, not app data) and deliberately reads its own classes
// directly off the token layer (index.css) rather than hardcoding hex, so
// it stays accurate if the palette in index.css changes later.

import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card, CardKicker, CardTitle, CardBody, CardMeta } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Field, Input, Textarea, Select } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { Table, type TableColumn } from '../components/ui/Table';
import { Sidebar, NavItemList, NavItem } from '../components/ui/Nav';
import { Loading, ErrorBanner, EmptyState, Skeleton, CardSkeleton } from '../components/Feedback';
import { Token } from '../encounters/Token';
import { InitiativeStrip } from '../encounters/InitiativeStrip';
import type { SnapshotParticipant } from '../lib/types';

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-stone-800 pt-8 first:border-t-0 first:pt-0">
      <div>
        <h2 className="font-display text-xl font-medium text-stone-100">{title}</h2>
        {description && <p className="mt-1 text-sm text-stone-400 max-w-2xl">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Swatch({ name, className, role }: { name: string; className: string; role: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={`h-14 rounded-md shadow-sm ${className}`} />
      <div className="text-xs font-medium text-stone-200">{name}</div>
      <div className="text-[11px] text-stone-500">{role}</div>
    </div>
  );
}

const STONE_SWATCHES = [
  { name: 'stone-950', role: 'Page background' },
  { name: 'stone-900', role: 'Card / panel background' },
  { name: 'stone-800', role: 'Nested surface, card elevation ring' },
  { name: 'stone-700', role: 'Default (soft) control border' },
  { name: 'stone-600', role: 'Stronger border, rare' },
  { name: 'stone-500', role: 'Muted text, AA-safe borders' },
  { name: 'stone-400', role: 'Secondary text' },
  { name: 'stone-300', role: 'Secondary text, lighter' },
  { name: 'stone-200', role: 'Near-primary text' },
  { name: 'stone-100', role: 'Primary text' },
];

const AMBER_SWATCHES = [
  { name: 'amber-950', role: 'Filled badge background' },
  { name: 'amber-700', role: 'Darker accent border' },
  { name: 'amber-600', role: 'Mid accent — non-text fills only (HP bars, active tabs); fails AA as button bg+text' },
  { name: 'amber-500', role: 'Primary interactive: links, button border+text, focus ring' },
  { name: 'amber-400', role: 'Lighter accent, filled-badge text' },
];

const SAMPLE_PARTICIPANTS: SnapshotParticipant[] = [
  {
    participantId: '1',
    characterId: '1',
    monsterInstanceId: null,
    name: 'Kaelen Duskrider',
    initiativeRoll: 18,
    initiativeTiebreak: null,
    turnOrder: 0,
    hp: { hpCurrent: 58, hpMax: 64, hpTemp: 0 },
    effects: [
      {
        effectId: '1',
        effectDefinitionId: '1',
        name: 'Blessed',
        durationType: 'rounds',
        durationRemaining: 3,
        concentration: false,
        sourceCharacterId: null,
      },
    ],
    posX: 0,
    posY: 0,
    armorClass: 19,
    actionUsed: false,
    bonusActionUsed: false,
    reactionUsed: false,
    dashUsed: false,
    movementUsedFt: 0,
    objectInteractionUsed: false,
    speedFt: 30,
    monsterInstanceStatus: null,
    size: 'Medium',
    faction: 'player',
    imageUrl: null,
    visibleToPlayers: true,
  },
  {
    participantId: '2',
    characterId: null,
    monsterInstanceId: '1',
    name: 'Ashclaw Wyrmling',
    initiativeRoll: 16,
    initiativeTiebreak: null,
    turnOrder: 1,
    hp: { hpCurrent: 12, hpMax: 48, hpTemp: 0 },
    effects: [],
    posX: 0,
    posY: 0,
    armorClass: 17,
    actionUsed: false,
    bonusActionUsed: false,
    reactionUsed: false,
    dashUsed: false,
    movementUsedFt: 0,
    objectInteractionUsed: false,
    speedFt: 40,
    monsterInstanceStatus: 'alive',
    size: 'Large',
    faction: 'enemy',
    imageUrl: null,
    visibleToPlayers: true,
  },
  {
    participantId: '3',
    characterId: null,
    monsterInstanceId: '2',
    name: 'Cinderfang',
    initiativeRoll: 9,
    initiativeTiebreak: null,
    turnOrder: 2,
    hp: { hpCurrent: 18, hpMax: 26, hpTemp: 0 },
    effects: [],
    posX: 5,
    posY: 5,
    armorClass: 13,
    actionUsed: false,
    bonusActionUsed: false,
    reactionUsed: false,
    dashUsed: false,
    movementUsedFt: 0,
    objectInteractionUsed: false,
    speedFt: 40,
    monsterInstanceStatus: 'alive',
    size: 'Small',
    faction: 'enemy',
    imageUrl: null,
    visibleToPlayers: true,
  },
];

interface SampleRow {
  id: string;
  name: string;
  cr: string;
  hp: number;
  ac: number;
}

const TABLE_COLUMNS: TableColumn<SampleRow>[] = [
  { key: 'name', header: 'Name', label: 'Name', render: (r) => r.name },
  { key: 'cr', header: 'CR', label: 'CR', render: (r) => r.cr },
  { key: 'hp', header: 'HP', label: 'HP', render: (r) => r.hp },
  { key: 'ac', header: 'AC', label: 'AC', render: (r) => r.ac },
];

const TABLE_ROWS: SampleRow[] = [
  { id: '1', name: 'Goblin', cr: '1/4', hp: 7, ac: 15 },
  { id: '2', name: 'Ashclaw Wyrmling', cr: '4', hp: 82, ac: 17 },
  { id: '3', name: 'The Sundered King', cr: '12', hp: 210, ac: 19 },
];

export function StyleguidePage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');

  return (
    <div className="min-h-dvh bg-stone-950 text-stone-100">
      <header className="border-b border-stone-800 px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <Link to="/home" className="text-xs text-stone-500 hover:text-stone-300">
          ← Home
        </Link>
        <h1 className="font-display text-2xl font-medium mt-1">Styleguide</h1>
        <p className="text-sm text-stone-400 max-w-2xl mt-1">
          Nocturne design system reference — docs/design-tokens.md is the full write-up; this page is the visual
          index. Resize the window (or open on a phone) to check every component at both mobile and desktop widths.
        </p>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-10 sm:px-6">
        <Section title="Color" description="Every swatch below reads its class straight from index.css — this is the live palette, not a static copy.">
          <div>
            <h3 className="text-xs uppercase tracking-wide text-stone-500 mb-2">Neutral (stone-*)</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {STONE_SWATCHES.map((s) => (
                <Swatch key={s.name} name={s.name} role={s.role} className={`bg-${s.name}`} />
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-xs uppercase tracking-wide text-stone-500 mb-2">Accent (amber-*)</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {AMBER_SWATCHES.map((s) => (
                <Swatch key={s.name} name={s.name} role={s.role} className={`bg-${s.name}`} />
              ))}
            </div>
          </div>
        </Section>

        <Section title="Type" description="Fraunces for h1-h3 (kept from the app's existing pairing — OPEN_QUESTIONS.md #11), Inter for everything else, weight 500 on headings per the source.">
          <div className="space-y-2">
            <h1 className="font-display text-4xl font-medium">Heading 1 / 42px</h1>
            <h2 className="font-display text-3xl font-medium">Heading 2 / 32px</h2>
            <h3 className="font-display text-2xl font-medium">Heading 3 / 25px</h3>
            <h4 className="text-xl font-medium">Heading 4 / 20px</h4>
            <p className="text-base">Body text — 16px minimum on mobile (iOS zoom threshold), 15-16px desktop.</p>
            <p className="text-sm text-stone-400">Muted / secondary text — 14px, stone-400 or stone-500.</p>
            <p className="text-[11px] uppercase tracking-wide text-stone-500">Micro / eyebrow label — 11px</p>
          </div>
        </Section>

        <Section title="Buttons" description="Primary is outline/ghost, not filled — a filled amber-600 background fails AA with text on top (docs/design-tokens.md).">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost →</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="icon" aria-label="Example icon button">
              ⚙
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled>
              Primary (disabled)
            </Button>
            <Button variant="secondary" disabled>
              Secondary (disabled)
            </Button>
          </div>
          <div className="max-w-xs">
            <Button variant="primary" block>
              Block button
            </Button>
          </div>
          <ButtonLink to="/styleguide" variant="ghost">
            ButtonLink (router Link styled as a button) →
          </ButtonLink>
        </Section>

        <Section title="Inputs" description="44px minimum height, 16px text on mobile (shrinks to 14px from sm: up) — both Phase 3 non-negotiables, not in the source.">
          <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
            <Field label="Text input" htmlFor="sg-input">
              <Input id="sg-input" value={inputValue} onChange={(e) => setInputValue(e.target.value)} placeholder="Type here…" />
            </Field>
            <Field label="With error (invented — not in source)" htmlFor="sg-input-error" error="This field is required.">
              <Input id="sg-input-error" error defaultValue="" />
            </Field>
            <Field label="Select" htmlFor="sg-select">
              <Select id="sg-select" defaultValue="b">
                <option value="a">Option A</option>
                <option value="b">Option B</option>
              </Select>
            </Field>
            <Field label="Disabled" htmlFor="sg-disabled">
              <Input id="sg-disabled" disabled value="Can't touch this" readOnly />
            </Field>
          </div>
          <div className="max-w-2xl">
            <Field label="Textarea" htmlFor="sg-textarea">
              <Textarea id="sg-textarea" placeholder="Longer text…" />
            </Field>
          </div>
        </Section>

        <Section title="Cards & badges">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardKicker>Kicker label</CardKicker>
              <CardTitle>Card title</CardTitle>
              <CardBody>Card body copy — muted, flexes to fill remaining height in a grid of uneven cards.</CardBody>
              <CardMeta>
                <Badge variant="accent">CR 4</Badge>
                <span>humanoid</span>
              </CardMeta>
            </Card>
            <Card interactive elevation="md">
              <CardKicker>interactive + elevation=&quot;md&quot;</CardKicker>
              <CardTitle>Hover / tap me</CardTitle>
              <CardBody>Interactive cards get a hover fill and a stronger shadow ring.</CardBody>
            </Card>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant="accent">Accent</Badge>
                <Badge variant="neutral">Neutral</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="danger">Danger</Badge>
              </div>
              <p className="text-xs text-stone-500">Four badge variants — filled accent/neutral pairs are pre-verified AA (9.2-9.4:1).</p>
            </div>
          </div>
        </Section>

        <Section title="Table" description="Auto-stacks into labeled cards below the sm: breakpoint — resize the window to see it happen, no separate mobile markup.">
          <Table columns={TABLE_COLUMNS} rows={TABLE_ROWS} rowKey={(r) => r.id} />
        </Section>

        <Section title="Modal" description="Native <dialog> — free focus-trap, Escape-to-close, and backdrop click, no dependency (no dialog primitive existed in this repo before).">
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            Open example modal
          </Button>
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Example modal"
            actions={
              <>
                <Button variant="secondary" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => setModalOpen(false)}>
                  Confirm
                </Button>
              </>
            }
          >
            <p className="text-sm text-stone-300">Sized via the `size` prop (`sm` default, `lg` for denser content like the character-sheet modal in the source).</p>
          </Modal>
        </Section>

        <Section title="Navigation" description="The sidebar shape the source's real screens use (CampaignShell.tsx) — icon+label rows, active = neutral-800 chip + accent left border.">
          <div className="flex rounded-md bg-stone-900 shadow-sm overflow-hidden max-w-xs">
            <Sidebar className="border-r-0">
              <NavItemList>
                <NavItem to="/styleguide">Characters</NavItem>
                <NavItem to="/styleguide#bestiary">Bestiary</NavItem>
                <NavItem to="/styleguide#maps">Maps</NavItem>
              </NavItemList>
            </Sidebar>
          </div>
        </Section>

        <Section title="Feedback states" description="Loading/error/empty/skeleton — Feedback.tsx, used across ~34 screens.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-md bg-stone-900 shadow-sm p-3">
              <Loading />
            </div>
            <div className="rounded-md bg-stone-900 shadow-sm p-3">
              <ErrorBanner message="Something went wrong loading this." />
            </div>
            <div className="rounded-md bg-stone-900 shadow-sm p-3">
              <EmptyState message="Nothing here yet." action={<Button variant="ghost">Create one →</Button>} />
            </div>
            <div className="rounded-md bg-stone-900 shadow-sm p-3 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <CardSkeleton />
            </div>
          </div>
        </Section>

        <Section
          title="Sample board"
          description="Tokens at full size, and below the 30px legibility threshold where Token.tsx swaps to a simplified faction-colored dot with initials (Phase 3 mobile pass). Turn-order strip is the same InitiativeStrip SessionScreen.tsx uses."
        >
          <InitiativeStrip participants={SAMPLE_PARTICIPANTS} activeParticipantId="1" />
          <div className="relative overflow-visible rounded-md bg-stone-950 shadow-sm p-6 flex items-center gap-8">
            <div className="text-center">
              <div className="relative h-20 w-20">
                <Token
                  participant={SAMPLE_PARTICIPANTS[0]!}
                  cellSizePx={80}
                  gridColumns={10}
                  gridRows={10}
                  zoom={1}
                  isActive
                  isDraggable={false}
                  onMove={() => {}}
                />
              </div>
              <p className="text-[10px] text-stone-500 mt-2">Full size (active)</p>
            </div>
            <div className="text-center">
              {/* Token's actual rendered size is cellSizePx x footprint (the
                  `zoom` prop only decides the simplified-vs-full threshold,
                  same as in BattleMap — visual scaling there comes from the
                  parent's CSS transform, not this prop). cellSizePx=14 here
                  is a deliberately tiny cell to demonstrate the <30px
                  simplified rendering truthfully, not a realistic setting. */}
              <div className="relative h-7 w-7">
                <Token
                  participant={SAMPLE_PARTICIPANTS[1]!}
                  cellSizePx={14}
                  gridColumns={10}
                  gridRows={10}
                  zoom={1}
                  isActive={false}
                  isDraggable={false}
                  onMove={() => {}}
                />
              </div>
              <p className="text-[10px] text-stone-500 mt-2">Simplified (below 30px)</p>
            </div>
          </div>
        </Section>

        <Section title="Motion" description="Respects prefers-reduced-motion globally (index.css) — toggle it in your OS accessibility settings and the skeleton pulse above and this spinner both go static.">
          <Loading label="Spinner respects prefers-reduced-motion" />
        </Section>
      </main>
    </div>
  );
}
