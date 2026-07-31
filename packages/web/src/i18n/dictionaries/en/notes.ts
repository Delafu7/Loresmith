// Flat (no nesting) — LocaleContext.test.ts's dictionary-shape checks assume
// exactly one level of section -> string keys, so NotesIndexPage.tsx's own
// strings live here as index-prefixed keys rather than a nested `index: {}`.
export const notes = {
  title: 'Notes',
  newNote: 'New note',
  cancel: 'Cancel',
  titleLabel: 'Title',
  bodyLabel: 'Body',
  saving: 'Saving…',
  saveNote: 'Save note',
  noNotes: 'No notes yet.',
  edit: 'Edit',
  duplicate: 'Duplicate',
  delete: 'Delete',
  createdUpdated: 'Created {created} · Updated {updated}',
  editModalTitle: 'Edit note',
  saveChanges: 'Save changes',
  // NotesIndexPage.tsx — cross-campaign notes index.
  indexYourNotes: 'Your notes',
  indexCampaignNotes: 'Campaign notes',
  indexEmpty: 'Nothing here yet.',
  indexJustNow: 'just now',
  indexMinutesAgo: '{count}m ago',
  indexHoursAgo: '{count}h ago',
  indexDaysAgo: '{count}d ago',
};
