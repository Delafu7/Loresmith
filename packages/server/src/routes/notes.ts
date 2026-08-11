import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { createNoteSchema, searchNotesQuerySchema, updateNoteSchema } from '../schemas/notes.js';
import * as notesService from '../services/notes.js';

// Mounted at /campaigns/:id/notes
export const notesRouter = Router({ mergeParams: true });
notesRouter.use(requireAuth, requireCampaignMember());

notesRouter.get('/', async (req, res) => {
  const notes = await notesService.listNotes(pool, req.campaignId!, req.campaignRole!);
  res.json({ notes });
});

// Phase 3 "full-text search on notes" — registered before GET /:noteId so
// Express matches this literal path first (same "register the literal
// route before the :param one" discipline as GET /my-live in
// routes/encounters.ts — otherwise /:noteId would swallow "search" as a
// note id and hit a Postgres uuid-cast error instead of a clean route match).
notesRouter.get('/search', async (req, res) => {
  const query = searchNotesQuerySchema.parse(req.query);
  const notes = await notesService.searchNotes(pool, req.campaignId!, query.q);
  res.json({ notes });
});

notesRouter.post('/', requireRole('not-spectator'), async (req, res) => {
  const input = createNoteSchema.parse(req.body);
  const note = await notesService.createNote(pool, req.campaignId!, req.user!.id, req.campaignRole!, input);
  res.status(201).json({ note });
});

notesRouter.get('/:noteId', async (req, res) => {
  const note = await notesService.getNote(pool, req.campaignId!, (req.params.noteId as string), req.campaignRole!);
  res.json({ note });
});

notesRouter.patch('/:noteId', requireRole('not-spectator'), async (req, res) => {
  const input = updateNoteSchema.parse(req.body);
  const note = await notesService.updateNote(pool, req.campaignId!, (req.params.noteId as string), req.user!.id, req.campaignRole!, input);
  res.json({ note });
});

notesRouter.delete('/:noteId', requireRole('not-spectator'), async (req, res) => {
  await notesService.deleteNote(pool, req.campaignId!, (req.params.noteId as string), req.user!.id, req.campaignRole!);
  res.status(204).send();
});

notesRouter.post('/:noteId/duplicate', requireRole('not-spectator'), async (req, res) => {
  const note = await notesService.duplicateNote(pool, req.campaignId!, (req.params.noteId as string), req.user!.id, req.campaignRole!);
  res.status(201).json({ note });
});
