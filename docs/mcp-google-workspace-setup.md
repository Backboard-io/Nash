# Google Workspace MCP — operator setup

The in-app **Connect Google Workspace** catalog lets each Nash user authorize their
own Gmail/Drive/Calendar/Chat/Contacts and use those tools in chat, via Google's
official remote MCP servers.

**Who does this:** whoever operates your Nash deployment, **once**, at the app
level. **End users do nothing but click "Connect" and approve a Google consent
screen** — no forms, no Google approval, no per-user setup. Everything below is a
one-time operator task; users inherit it. This feature is entirely optional:
with no Google OAuth client configured, the catalog stays hidden.

## What's in the repo (no action needed)

- Per-user OAuth engine + AES-encrypted token store (`api/services/mcp_oauth_service.py`).
- The 5-server catalog (`api/services/mcp_catalog.py`) — Gmail, Drive, Calendar, Chat, People.
- Routes incl. the session-bound OAuth callback (`api/routes/misc.py`) and the
  one-click UI (`GoogleWorkspaceCatalog.tsx`). Configuration is two env vars:
  `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET`.

**The catalog is dark until the OAuth client env vars are set** — the catalog
endpoint returns `[]` and the UI section renders nothing. Shipping the code is
therefore safe; the feature only turns on once the steps below are done.

## The one prerequisite people miss: Developer Preview enrollment

Google's remote MCP servers (`gmailmcp.googleapis.com` etc.) are currently in the
**Google Workspace Developer Preview Program**, and enrollment is **per Google
Cloud project** — the project that owns Nash's OAuth client. If that project isn't
enrolled, every Gmail/Drive/… call returns **"The caller does not have permission"**
even though the user's token is perfectly valid (it works against the plain Gmail
API — the *remote MCP service* is what's gated).

- **Create Nash's OAuth client in a Google Cloud project that is enrolled in the
  preview.** Enroll the project via the
  [Developer Preview form](https://docs.google.com/forms/d/e/1FAIpQLSd7BiMXXHDlUDkF7G0TSY5zfJbQwFNH3m6K_ZYFi3vCHLFbng/viewform)
  (Workspace account + Cloud project; ~1–2 day Google approval; personal @gmail
  and service accounts are not eligible).
- This is a **temporary** requirement — it goes away when Google GAs the remote MCP.

## 1. Google Cloud — the OAuth client (once)

In the **enrolled** project:

1. **Enable APIs** — `gmail.googleapis.com`, `drive.googleapis.com`,
   `calendar-json.googleapis.com`, `chat.googleapis.com`, `people.googleapis.com`,
   **and** the MCP services `gmailmcp.googleapis.com`, `drivemcp.googleapis.com`,
   `calendarmcp.googleapis.com`, `chatmcp.googleapis.com`, `people.googleapis.com`.
2. **OAuth consent screen** — app name, support email, audience. If Nash is used
   only inside your own Workspace org, make it **Internal** (no verification
   needed). If it serves external Google accounts, it must be **published and
   verified** (Google's standard one-time OAuth verification + restricted-scope
   review — the same process every Gmail-integrated app completes).
   Under **Data Access → Add or remove scopes**, add all the scopes the 5 servers
   request (Gmail/Drive/Calendar/People/Chat — see `api/services/mcp_catalog.py`).
2b. **Google Chat only** — if you're enabling the Chat server, configure a Chat
   app in the console: **app name `Chat MCP`**, avatar
   `https://developers.google.com/chat/images/quickstart-app-avatar.png`,
   description `Chat MCP server`, **disable interactive features**, **enable error
   logging**. Chat requires a **Workspace-backed account** — it's unavailable for
   consumer `@gmail.com` accounts.
3. **Credentials → Create OAuth client ID → Web application.** Note the client ID
   and secret.
4. **Authorized redirect URIs** — one per server, on your deployment's public
   origin (or `http://localhost:3080` for local testing):
   ```
   https://<your-nash-domain>/api/mcp/google-gmail/oauth/callback
   https://<your-nash-domain>/api/mcp/google-drive/oauth/callback
   https://<your-nash-domain>/api/mcp/google-calendar/oauth/callback
   https://<your-nash-domain>/api/mcp/google-chat/oauth/callback
   https://<your-nash-domain>/api/mcp/google-people/oauth/callback
   ```
   They must match exactly (scheme, host, path). Nash derives the callback from
   `DOMAIN_SERVER`, so each env just needs its own origin's URIs registered.

## 2. Configure the env vars

Set the two variables in your deployment's environment (or `.env` locally):
```
GOOGLE_OAUTH_CLIENT_ID=…apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-…
```
The secret stays server-side — it is never returned to the browser or stored
per user.

## 3. Restart the app, then verify

Deploy as usual, open Nash → MCP servers panel → a **Google Workspace** section
with 5 Connect buttons appears. Connect Gmail → Google consent → approve → the card
flips to **Connected**. In a chat, enable the Gmail server and ask it to read/draft
a message.

## What each party does — summary

| | One-time? | Who |
|---|---|---|
| Enroll the app's Cloud project in the preview | once (until GA) | operator |
| Create the OAuth Web client + redirect URIs | once | operator |
| Verify the OAuth app (or make it Internal) | once | operator |
| Set the two env vars + restart | once per env | operator |
| **Connect their Google account** | **each time, one click** | **each user** |

## Caveats

- **"Caller does not have permission"** on Gmail calls = the OAuth client's project
  isn't enrolled in the preview (or, for a managed Workspace, the admin hasn't
  allowlisted the MCP tools). It is **not** a token/scope problem — verify by
  hitting `gmail.googleapis.com` directly with the token (returns 200).
- **Testing-mode refresh tokens expire after 7 days.** Publish/verify the app (or
  Internal) for durable tokens.
- **Docs/Sheets aren't in Google's remote set** (Gmail/Drive/Calendar/Chat/People
  only). A self-hosted MCP server would add them and drops the preview gate — the
  OAuth engine here is generic and would drive it with just a new catalog entry.
- **Usable tools are bounded by the granted scopes.** Google's remote servers
  expose *all* of a product's tools regardless of scope; a tool needing a scope we
  didn't request returns 403. The catalog requests Google's documented default
  scopes (e.g. Gmail `readonly` + `compose` → reads + draft creation; label/modify
  tools need `gmail.modify`/`gmail.labels`, which we don't request). Widen the
  scopes in `mcp_catalog.py` to enable more, weighing the extra consent/verification.
- **MCP tools surface in chat, not the Agent Builder.** `GET /api/mcp/tools`
  returns `[]` — a pre-existing Nash-wide limitation (all MCP servers, not just
  Google). Attaching MCP tools to Flask agents is a separate future item.
