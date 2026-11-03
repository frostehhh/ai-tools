# Pipedream Connect Demo — Notion → Google Calendar

A minimal example showing how to use **Pipedream Connect** managed auth to let users connect their Notion and Google Calendar accounts, then automatically sync new Notion tasks to Google Calendar.

## What it does

1. **Managed Auth** — Users click to connect Notion and Google Calendar through Pipedream's OAuth flow.
2. **Auto-Sync** — Polls your Notion database every 60 seconds for new tasks and creates corresponding Google Calendar events.
3. **Manual Sync** — Click **Sync Now** to trigger a sync on demand.
4. **One-off Tool** — Manually create a Google Calendar event via `POST /api/notion-to-google-calendar`.

## Prerequisites

- A Pipedream account with project `proj_Das5blo`
- A Pipedream OAuth client (Client ID + Secret) from your workspace API settings
- A Notion database with tasks (you'll need the Database ID)

## Setup

1. **Copy environment variables:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env`** and add your credentials:
   ```
   PIPEDREAM_CLIENT_ID=your_client_id
   PIPEDREAM_CLIENT_SECRET=your_client_secret
   PIPEDREAM_PROJECT_ID=proj_Das5blo
   PIPEDREAM_ENVIRONMENT=development

   # Notion database to watch for new tasks
   NOTION_DATABASE_ID=your_notion_database_id

   # Optional: customize property names if your database uses different ones
   NOTION_TITLE_PROPERTY=Name
   NOTION_DATE_PROPERTY=Due date
   ```

   **Finding your Notion Database ID:**
   Open your Notion database in the browser. The URL looks like:
   ```
   https://www.notion.so/workspace/abc123?v=xyz
   ```
   Copy the `abc123` part (the database ID).

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Run the server:**
   ```bash
   npm run dev
   ```

5. **Open** http://localhost:3000

## How to use

1. Click **Connect Notion** and **Connect Google Calendar** to link your accounts.
2. The app will now **auto-poll** your Notion database every 60 seconds.
3. Any task with a **title** and **date** that hasn't been synced yet will get a Google Calendar event.
4. Click **Sync Now** to trigger a manual sync and see the results instantly.

## How the sync works

- **State tracking:** Synced Notion page IDs are stored in `synced-tasks.json` so tasks are never duplicated.
- **Date handling:** If your Notion date has no time, the event defaults to **09:00 UTC**.
- **Event duration:** All created events are **1 hour** long.
- **Property mapping:** The app reads the `Name` (title) and `Due date` (date) properties by default. Change `NOTION_TITLE_PROPERTY` and `NOTION_DATE_PROPERTY` in `.env` if your database uses different names.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/token?app=google_calendar` | GET | Generates a Connect token and link for the requested app |
| `/api/accounts` | GET | Lists connected accounts for the demo user |
| `/api/sync` | POST | Manually triggers a Notion → Google Calendar sync |
| `/api/sync-status` | GET | Returns last sync time, synced count, and database ID |
| `/api/notion-to-google-calendar` | POST | Creates a one-off Google Calendar event |

### `POST /api/sync`

**Response:**
```json
{
  "success": true,
  "synced": 2,
  "tasks": [
    { "pageId": "...", "title": "Task 1", "date": "2024-01-15", "eventId": "..." }
  ],
  "errors": []
}
```

### `POST /api/notion-to-google-calendar`

**Body:**
```json
{
  "title": "Team Standup",
  "date": "2024-01-15T09:00:00.000Z"
}
```

## Notes

- This demo uses a hardcoded `external_user_id` (`demo-user-1`). In production, replace this with your actual user IDs.
- The `development` environment is used since the free plan does not include production access.
- `synced-tasks.json` is created automatically and stores which Notion pages have already been synced.
