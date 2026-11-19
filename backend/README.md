# /backend/

Reference copies of the two Apps Script files that make up the Web App
backend. **Nothing here is deployed from this repo** — the live code lives
in the Apps Script project bound to `Apostello_Comm_Base_Missionnaires`.
These files exist so the backend is version-controlled like everything
else, and so a change can be reviewed in a diff rather than in a browser
text area.

| File | Purpose |
|---|---|
| `apocomm_backend.gs` | The `doGet` Web App: the eight actions the six tools call. |
| `apocomm_reminder.gs` | Monthly trigger that emails each client their intake link and their client-space link. |

## Deploying a change

1. Sheet → **Extensions → Apps Script**.
2. Replace the matching file's contents with the copy here.
3. **Ctrl+S**.
4. **Deploy → Manage deployments** → pencil icon on the existing
   deployment → Version: **New version** → Deploy.

Use *Manage deployments*, never *New deployment*: a new deployment mints a
new `/exec` URL, and `shared/apocomm-config.js` would have to change too.

## No credentials here

`API_KEY` lives in **Project Settings → Script Properties** and is read at
runtime by `getApiKey()`. Rotating it means editing that property — no code
change, no redeployment. The key is served to every browser that opens any
of the tools, so it is not a secret; see the header comment in
`apocomm_backend.gs` for what it does and does not protect.

## Keep in step with the frontend

Two things must agree across the boundary, or the system fails quietly:

- **`isSecuritySensitive()`** here and `ApoComm.isSecuritySensitive()` in
  `shared/apocomm-common.js`. Both fail closed: only an explicit, recognised
  "no" clears a profile. If they diverge, the backend can publish a photo
  folder for a client the frontend then refuses to generate for.
- **The 11-value intake row order** in `saveIntake()` and
  `ApoComm.BACKEND_INTAKE_COLUMNS`. They are positional, with no header
  lookup on either side.
- **`SEARCH_MIN_CHARS`** here and `ApoComm.SEARCH_MIN_CHARS` in
  `shared/apocomm-common.js`. If the frontend's is the lower of the two, the
  backend silently returns nothing for queries the frontend was willing to
  send.

## Access tokens

`Access_Tokens` (ClientID, Token, Created) is what the client space at
`/espace/` authenticates against, and `getOrCreateTokensSheet()` creates it
on first use. A token is minted at signup by `registerClient` and emailed;
`sendMonthlyIntakeReminders()` mints one for any active client who still has
none, which is how clients who registered before the space existed get in.

**Every row in this tab is a live credential**, and `resolveToken()` matches
any of them, so a client with several rows has several working links. That
is why the reminder reuses an existing token rather than minting monthly.
**Revoking someone's access means deleting their row(s) here** — there is no
expiry and no other revocation path. Deleting a row cannot be undone: the
next reminder will mint that client a new token and email it to them.
