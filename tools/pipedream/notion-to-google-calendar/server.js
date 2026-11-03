import 'dotenv/config';
import express from 'express';
import { createBackendClient } from '@pipedream/sdk';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json());
app.use(express.static('public'));

const pd = createBackendClient({
  credentials: {
    clientId: process.env.PIPEDREAM_CLIENT_ID,
    clientSecret: process.env.PIPEDREAM_CLIENT_SECRET,
  },
  projectId: process.env.PIPEDREAM_PROJECT_ID,
  environment: process.env.PIPEDREAM_ENVIRONMENT || 'development',
});

const USER_ID = 'demo-user-1';
const SYNC_STATE_FILE = path.resolve('synced-tasks.json');
const NOTION_DB_ID = process.env.NOTION_DATABASE_ID;
const NOTION_TITLE_PROP = process.env.NOTION_TITLE_PROPERTY || 'Name';
const NOTION_DATE_PROP = process.env.NOTION_DATE_PROPERTY || 'Due date';

// --- Sync state persistence ---

function loadSyncedTasks() {
  try {
    const raw = fs.readFileSync(SYNC_STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { lastSyncAt: null, syncedPageIds: [] };
  }
}

function saveSyncedTasks(state) {
  fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify(state, null, 2));
}

let syncState = loadSyncedTasks();

// --- Account helpers ---

async function getAccountBySlug(appSlug) {
  const resp = await pd.getAccounts({ external_user_id: USER_ID });
  const accounts = resp?.data || [];
  return accounts.find((a) => a.app?.name_slug === appSlug);
}

// --- Notion helpers ---

async function queryNotionDatabase() {
  const notionAccount = await getAccountBySlug('notion');
  if (!notionAccount) throw new Error('No Notion account connected.');

  const proxyResp = await pd.makeProxyRequest(
    {
      searchParams: {
        external_user_id: USER_ID,
        account_id: notionAccount.id,
      },
    },
    {
      url: `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`,
      options: {
        method: 'POST',
        headers: {
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page_size: 100 }),
      },
    }
  );

  return proxyResp;
}

function extractTaskFromPage(page) {
  const props = page.properties || {};

  // Extract title
  const titleProp = props[NOTION_TITLE_PROP];
  let title = '';
  if (titleProp?.title) {
    title = titleProp.title.map((t) => t.plain_text).join('');
  }

  // Extract date
  const dateProp = props[NOTION_DATE_PROP];
  let date = null;
  if (dateProp?.date?.start) {
    date = dateProp.date.start;
  }

  return { pageId: page.id, title, date };
}

// --- Google Calendar helpers ---

async function createCalendarEvent(title, dateStr) {
  const gcalAccount = await getAccountBySlug('google_calendar');
  if (!gcalAccount) throw new Error('No Google Calendar account connected.');

  const startTime = new Date(dateStr);
  // If the date string has no time component, default to 09:00 UTC
  if (dateStr.length <= 10) {
    startTime.setUTCHours(9, 0, 0, 0);
  }
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

  const eventBody = {
    summary: title,
    start: { dateTime: startTime.toISOString(), timeZone: 'UTC' },
    end: { dateTime: endTime.toISOString(), timeZone: 'UTC' },
    description: `Synced from Notion task: ${title}`,
  };

  const proxyResp = await pd.makeProxyRequest(
    {
      searchParams: {
        external_user_id: USER_ID,
        account_id: gcalAccount.id,
      },
    },
    {
      url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventBody),
      },
    }
  );

  return proxyResp;
}

// --- Core sync logic ---

async function syncTasks() {
  if (!NOTION_DB_ID) {
    throw new Error('NOTION_DATABASE_ID is not set in .env');
  }

  const notionResp = await queryNotionDatabase();
  const pages = notionResp?.results || [];
  const newTasks = [];
  const errors = [];

  for (const page of pages) {
    const { pageId, title, date } = extractTaskFromPage(page);

    if (!title || !date) continue;
    if (syncState.syncedPageIds.includes(pageId)) continue;

    try {
      const event = await createCalendarEvent(title, date);
      syncState.syncedPageIds.push(pageId);
      newTasks.push({ pageId, title, date, eventId: event?.id });
    } catch (err) {
      errors.push({ pageId, title, error: err.message });
    }
  }

  syncState.lastSyncAt = new Date().toISOString();
  saveSyncedTasks(syncState);

  return { synced: newTasks.length, tasks: newTasks, errors };
}

// --- Routes ---

/**
 * Generate a short-lived Connect token and a Connect Link URL for a given app.
 */
app.get('/api/token', async (req, res) => {
  try {
    const appSlug = req.query.app;
    const { token, expires_at, connect_link_url } = await pd.createConnectToken({
      external_user_id: USER_ID,
    });
    const connectUrl = `${connect_link_url}&app=${appSlug}`;
    res.json({ token, expires_at, connectUrl });
  } catch (err) {
    console.error('Token creation failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * List connected accounts for the demo user.
 */
app.get('/api/accounts', async (req, res) => {
  try {
    const accounts = await pd.getAccounts({ external_user_id: USER_ID });
    res.json(accounts);
  } catch (err) {
    console.error('Account listing failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Manual sync trigger: query Notion and create Calendar events for new tasks.
 */
app.post('/api/sync', async (req, res) => {
  try {
    const result = await syncTasks();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Sync failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get current sync status.
 */
app.get('/api/sync-status', async (req, res) => {
  res.json({
    lastSyncAt: syncState.lastSyncAt,
    syncedCount: syncState.syncedPageIds.length,
    databaseId: NOTION_DB_ID || null,
  });
});

/**
 * One-off tool: create a Google Calendar event manually.
 */
app.post('/api/notion-to-google-calendar', async (req, res) => {
  try {
    const { title, date } = req.body;
    if (!title || !date) {
      return res.status(400).json({ error: 'Missing title or date in request body' });
    }

    const event = await createCalendarEvent(title, date);
    res.json({ success: true, event });
  } catch (err) {
    console.error('Manual event creation failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Auto-poll (optional) ---

const POLL_INTERVAL_MS = 60_000; // 60 seconds
if (NOTION_DB_ID) {
  setInterval(async () => {
    try {
      const result = await syncTasks();
      if (result.synced > 0) {
        console.log(`[auto-poll] Synced ${result.synced} new task(s)`);
      }
    } catch (err) {
      console.error('[auto-poll] Sync error:', err.message);
    }
  }, POLL_INTERVAL_MS);
  console.log(`Auto-polling enabled every ${POLL_INTERVAL_MS / 1000}s`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Pipedream Connect demo running at http://localhost:${PORT}`);
});
