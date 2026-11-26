import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKENS_PATH = path.join(__dirname, 'tokens.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

function loadClient() {
  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/google/oauth2callback',
  } = process.env;
  
  // credentials.json if present, otherwise env vars
  if (fs.existsSync(CREDENTIALS_PATH)) {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const client = credentials.installed || credentials.web;
    return new google.auth.OAuth2(
      client.client_id,
      client.client_secret,
      GOOGLE_REDIRECT_URI
    );
  }
  
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET in environment or credentials.json file');
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

function loadTokens() {
  try {
    const raw = fs.readFileSync(TOKENS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

export function getAuthUrl() {
  const oAuth2Client = loadClient();
  const scopes = ['https://www.googleapis.com/auth/calendar'];
  const url = oAuth2Client.generateAuthUrl({ 
    access_type: 'offline', 
    scope: scopes, 
    prompt: 'consent' 
  });
  return url;
}

export async function exchangeCode(code) {
  const oAuth2Client = loadClient();
  const { tokens } = await oAuth2Client.getToken(code);
  saveTokens(tokens);
  return tokens;
}

function getAuthedClient() {
  const tokens = loadTokens();
  if (!tokens) return null;
  const client = loadClient();
  client.setCredentials(tokens);
  return client;
}

export async function insertCalendarEvent({ summary, description, start_iso, end_iso, timezone = 'UTC' }) {
  const auth = getAuthedClient();
  if (!auth) {
    const err = new Error('Not authorized');
    err.code = 'NO_AUTH';
    throw err;
  }
  const calendar = google.calendar({ version: 'v3', auth });
  const event = {
    summary,
    description,
    start: { dateTime: start_iso, timeZone: timezone },
    end: { dateTime: end_iso, timeZone: timezone },
  };
  const res = await calendar.events.insert({ calendarId: 'primary', requestBody: event });
  return res.data;
}

export async function listUpcomingEvents(maxResults = 10) {
  const auth = getAuthedClient();
  if (!auth) {
    const err = new Error('Not authorized');
    err.code = 'NO_AUTH';
    throw err;
  }
  const calendar = google.calendar({ version: 'v3', auth });
  const now = new Date().toISOString();
  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now,
    maxResults,
    singleEvents: true,
    orderBy: 'startTime'
  });
  return res.data.items || [];
}

export function isAuthorized() {
  return !!loadTokens();
}

