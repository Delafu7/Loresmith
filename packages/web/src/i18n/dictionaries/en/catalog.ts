// The generic homebrew catalog editor (CatalogEditorPage.tsx +
// CatalogEntryForm.tsx) — chrome only; per-field labels for each of the 11
// catalog entity types live in catalogEntities.ts and are out of scope here.
export const catalog = {
  list: {
    heading: 'Content catalog',
    subtitle:
      "Official {plural} are shared across every campaign and can't be edited in place — duplicate one to fork it into your own, editable copy.",
    newEntity: '+ New {label}',
    noEntries: 'No {plural} yet.',
    homebrewBadge: 'Homebrew',
    officialBadge: 'Official',
    duplicate: 'Duplicate',
    confirmDelete: 'Delete "{name}"? This can\'t be undone.',
    modalEditTitle: 'Edit {label}',
    modalNewTitle: 'New {label}',
    createdUpdated: 'Created {created} · Updated {updated}',
    compendiumSubtitle:
      "Your personal {plural}, reusable across every campaign you run. Official {plural} can't be edited in place — duplicate one to fork it into your own copy.",
    promoteToLibrary: 'Move to my compendium',
    assignToCampaign: 'Move to this campaign',
    selectCampaign: 'Select campaign…',
    // Shown only for the races/subraces/classes/subclasses segments — this
    // page authors/edits the shared catalog row, but adopting one into THIS
    // campaign (plus any campaign-local tweak) happens on a separate page
    // (CampaignRacesClassesPage.tsx), which already links back here via its
    // own "Create / duplicate entries →". This is that link's other
    // direction, so the relationship is discoverable from either side.
    manageAdoptionLink: 'Choose which this campaign uses →',
  },
  form: {
    selectPlaceholder: 'Select…',
    noneOption: '(none)',
    invalidJson: '"{label}" isn\'t valid JSON.',
    saving: 'Saving…',
    saveChanges: 'Save changes',
  },
};
