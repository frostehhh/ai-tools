# Notion → Google Calendar (Pipedream Connect demo)

Minimal Express app that uses Pipedream Connect to sync new Notion tasks to Google Calendar. Repo-wide rules are in the root `AGENTS.md`.

## Layout

| File | Purpose |
|------|---------|
| `server.js` | Express backend: Connect tokens, account listing, Notion polling, Calendar event creation |
| `public/index.html` | Single-page UI: connect accounts, sync status, "Sync Now", manual event form |
| `.env` / `.env.example` | Config. `.env` holds real secrets and is gitignored. Never read it or commit it. |
| `synced-tasks.json` | Generated state: Notion page IDs already synced. Delete it to re-sync everything. |

## Run

```bash
npm install
npm run dev              # node server.js, default port 3000
PORT=3001 npm run dev    # if 3000 is taken
```

Port 3000 is often used by another Next.js app on this machine. If `/api/*` returns a Next.js 404, you are hitting the wrong server.

## Environment

- Project `proj_Das5blo`, environment `development`. The free plan has no production access, so do not switch to `production`.
- Required: `PIPEDREAM_CLIENT_ID`, `PIPEDREAM_CLIENT_SECRET`, `PIPEDREAM_PROJECT_ID`, `PIPEDREAM_ENVIRONMENT`.
- Sync: `NOTION_DATABASE_ID`. Optional: `NOTION_TITLE_PROPERTY` (default `Name`), `NOTION_DATE_PROPERTY` (default `Due date`).
- Add any new variable to `.env.example` too.

## Pipedream SDK quirks

The installed `@pipedream/sdk` is v1.8.x, an older API than the current docs show. Do not copy examples from the docs unchanged.

- Use `createBackendClient({ credentials: { clientId, clientSecret }, projectId, environment })`. There is no `PipedreamClient`, and the option is `environment`, not `projectEnvironment`.
- Methods are flat: `createConnectToken`, `getAccounts`, `makeProxyRequest`. There is no `client.tokens`, `client.accounts`, or `client.proxy`.
- Params and responses are snake_case: `external_user_id`, `expires_at`, `connect_link_url`.
- `makeProxyRequest({ searchParams: { external_user_id, account_id } }, { url, options: { method, headers, body } })`. `body` must be a JSON string.
- Check `node_modules/@pipedream/sdk/dist/server.d.ts` for real signatures before changing SDK calls.

## Behavior to preserve

- Polling (`setInterval`, 60s) runs only inside the local Node process. It stops when the server stops.
- Dedupe relies on `synced-tasks.json`. Keep writes after each sync run.
- `USER_ID` is hardcoded to `demo-user-1`. Replace it with real user IDs for any non-demo use.
- Date-only Notion values default to 09:00 UTC. Events last 1 hour.

## Testing

No test suite. Verify by running the server and calling:

```bash
curl -s localhost:3000/api/accounts
curl -s "localhost:3000/api/token?app=google_calendar"
curl -s -X POST localhost:3000/api/sync
```
