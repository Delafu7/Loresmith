import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember } from '../middleware/campaign.js';
import { createNoteSchema, updateNoteSchema } from '../schemas/notes.js';
import * as notesService from '../services/notes.js';

// Mounted at /campaigns/:id/notes
export const notesRouter = Router({ mergeParams: true });
notesRouter.use(requireAuth, requireCampaignMember());

notesRouter.get('/', async (req, res) => {
  const notes = await notesService.listNotes(pool, req.campaignId!, req.campaignRole!);
  res.json({ notes });
});

notesRouter.post('/', async (req, res) => {
  const input = createNoteSchema.parse(req.body);
  const note = await notesService.createNote(pool, req.campaignId!, req.user!.id, req.campaignRole!, input);
  res.status(201).json({ note });
});

notesRouter.get('/:noteId', async (req, res) => {
  const note = await notesService.getNote(pool, req.campaignId!, (req.params.noteId as string), req.campaignRole!);
  res.json({ note });
});

notesRouter.patch('/:noteId', async (req, res) => {
  const input = updateNoteSchema.parse(req.body);
  const note = await notesService.updateNote(pool, req.campaignId!, (req.params.noteId as string), req.user!.id, req.campaignRole!, input);
  res.json({ note });
});

notesRouter.delete('/:noteId', async (req, res) => {
  await notesService.deleteNote(pool, req.campaignId!, (req.params.noteId as string), req.user!.id, req.campaignRole!);
  res.status(204).send();
});
