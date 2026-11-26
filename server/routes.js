import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createAppointment,
  getAppointmentsBetween,
  listAppointments,
  deleteAppointment,
} from './db.js';
import { getAuthUrl, exchangeCode, insertCalendarEvent, isAuthorized, listUpcomingEvents } from './google.js';
import { generateIntent } from './chat.js';
import { loadKnowledge, saveKnowledge, retrieveRelevant } from './knowledge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Google OAuth flow
router.get('/google/authurl', (_req, res) => {
  try {
    res.json({ url: getAuthUrl(), authorized: isAuthorized() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/google/oauth2callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');
  try {
    await exchangeCode(code);
    res.send('Google Calendar connected. You can close this tab.');
  } catch (e) {
    res.status(500).send('OAuth error');
  }
});

router.get('/google/events', async (req, res) => {
  try {
    const events = await listUpcomingEvents(10);
    res.json({ events });
  } catch (e) {
    if (e && e.code === 'NO_AUTH') {
      return res.status(401).json({ error: 'Not authorized' });
    }
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Query availability within a date range
router.get('/appointments', (req, res) => {
  const { start, end, limit, offset } = req.query;
  if (start && end) {
    const items = getAppointmentsBetween(start, end);
    return res.json({ items });
  }
  const l = Number(limit ?? 100);
  const o = Number(offset ?? 0);
  const items = listAppointments(l, o);
  res.json({ items });
});

router.post('/appointments', (req, res) => {
  try {
    const { customer_name, customer_phone, notes, start_iso, end_iso } = req.body || {};
    if (!customer_name || !start_iso || !end_iso) {
      return res.status(400).json({ error: 'customer_name, start_iso, end_iso are required' });
    }
    const result = createAppointment({ customer_name, customer_phone, notes, start_iso, end_iso });
    res.status(201).json({ id: result.id });
  } catch (err) {
    if (err && err.code === 'OVERLAP') {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/appointments/google', async (req, res) => {
  try {
    const { customer_name, customer_phone, notes, start_iso, end_iso, timezone } = req.body || {};
    if (!customer_name || !start_iso || !end_iso) {
      return res.status(400).json({ error: 'customer_name, start_iso, end_iso are required' });
    }
    const result = createAppointment({ customer_name, customer_phone, notes, start_iso, end_iso });
    let gcal = null;
    try {
      gcal = await insertCalendarEvent({
        summary: `Appointment: ${customer_name}`,
        description: notes || '',
        start_iso,
        end_iso,
        timezone: timezone || 'UTC',
      });
    } catch (e) {
      if (e && e.code === 'NO_AUTH') {
        return res.status(202).json({ id: result.id, google: 'not_authorized' });
      }
      // keep the local booking even if calendar sync fails
      gcal = { error: 'google_insert_failed' };
    }
    res.status(201).json({ id: result.id, google: gcal });
  } catch (err) {
    if (err && err.code === 'OVERLAP') {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/chat', async (req, res) => {
  const { text, context } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Missing text' });
  
  // the KB is small enough to send whole
  const allKnowledge = loadKnowledge();
  const ctx = { ...(context || {}), knowledge: allKnowledge };
  
  const intent = await generateIntent(text, ctx);
  res.json({ intent });
});

// Knowledge management (simple JSON list of {title, text})
router.get('/knowledge', (_req, res) => {
  res.json({ items: loadKnowledge() });
});
router.post('/knowledge', (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [];
  saveKnowledge(items);
  res.json({ ok: true, count: items.length });
});


router.delete('/appointments/:id', (req, res) => {
  const { id } = req.params;
  deleteAppointment(Number(id));
  res.status(204).end();
});

export default router;

