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
  },
  form: {
    selectPlaceholder: 'Select…',
    noneOption: '(none)',
    invalidJson: '"{label}" isn\'t valid JSON.',
    saving: 'Saving…',
    saveChanges: 'Save changes',
  },
};
