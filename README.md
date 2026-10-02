# Case Briefing

A dashboard that turns one Clio Manage matter into something an attorney can read
in about ten seconds, plus a way to share a filtered view with treating providers.

Everything on screen is read live from Clio. No case data is stored in the code.

## Three screens

**Quick brief (default).** Built for an attorney opening a case they have not seen in
weeks. A quick summary of who this is and what happened (accident, place, date the case
opened), the case value next to the coverage, where the case sits in its stages, then
three columns: *what just happened*, *what is holding it up*, *what is next*. Below
that, one simple picture of where things stand, with a bold Today line.

**Full case.** For the person working the case. Every open task with filters
(open, overdue, waiting, done), the detailed timeline with a focus-on-one-party filter,
a searchable list of all activity, and every custom field. Each item opens its source
text and links to the matter in Clio, where the work itself is done.

**Share with a provider.** A staging area. Pick a provider, optionally start from a
saved template, switch on the pieces they may see, and watch a live preview before
creating a private link. Nothing is shared by default. On a phone, a
*See provider preview* button switches the sheet to the preview before you send.

It works on desktop and on phones. The share sheet becomes a full-screen sheet on small
screens.

## Run it

1. Create a Clio developer application with **Read-only** permissions on Activities,
   Calendars, Communications, Contacts, Custom fields, Documents, Matters, Tasks and
   Users. Set the redirect URI to `http://127.0.0.1:3000/callback`.
2. `cp .env.example .env` and fill in `CLIO_CLIENT_ID` and `CLIO_CLIENT_SECRET`.
3. `npm install && npm start` (needs Node 22.5 or newer; the local database uses Node's
   built-in SQLite).
4. Open `http://127.0.0.1:3000` (use `127.0.0.1`, not `localhost`) and connect Clio.

## Read-only, by construction

- The Clio developer application only has Read permissions.
- `src/clio.ts` is the only code that talks to Clio, and it can only send GET requests.
  There is no code path that creates or changes case data.
- Share choices and templates are saved in a local SQLite file (`.data/app.db`),
  outside Clio.

## How a provider link stays safe

- The attorney's selections are stored as an allow list of item ids.
- The provider's page asks the server, which reads the case from Clio at that moment and
  builds the response **only from the allow list** (`src/share.ts`). Hidden items are
  never sent to the provider's browser.
- Note bodies and email bodies are never included. Providers see titles and dates only.
- Case value and coverage limits are never included. Coverage is a yes or no.
- Links can be revoked and stop working immediately.
- The server binds to `127.0.0.1` and has no login of its own. Do not expose it to the
  internet.

## What is computed, and how

- **Waiting on someone:** the most recent email sent to a party with no later reply from
  them, or an open task whose text says it is waiting.
- **Overdue:** open tasks with a due date in the past.
- **Which party an item belongs to:** emails and calls use the other party recorded in
  Clio. Tasks, notes and appointments are matched by names appearing in their text, so an
  occasional item can land under the wrong party.
- **Three lanes (providers, insurance and the other side, firm and client):** derived
  from each contact's relationship description in Clio plus a few keywords.
- **"N tasks still open before it moves on to <next stage>":** N is the count of open
  tasks, and the next stage is the next one in the practice area's stage order. Clio does
  not define what must be finished to advance, so this is a plain count.
- **Value and coverage cards:** read from custom fields whose names match value, limits,
  specials and liens. Every custom field is still available under "All case details".

## Known limitations

- It shows the first matter in the connected account. There is no matter picker yet.
- KPI cards find custom fields by name patterns. A matter whose fields are named very
  differently would show fewer cards.
- It runs locally. A provider link opens only on the machine running the app.
- Calendar times are not shown. The seeded data stores times in UTC, which Clio shifts
  into the account time zone, so the clock times would be misleading.
- Scanned document contents are not read. Documents appear by name, folder and date.
- Clio does not expose stage history through its API, so the stage bar shows only the
  current stage and treats earlier stages as passed.
- Clio is read-only here, so tasks are worked in Clio. Items link back to the matter.
  The deep link goes to the matter page, not to the individual task.

## Stack, data and cost

- Node 22 and TypeScript (run with tsx), Express, vanilla JavaScript with SVG, SQLite via
  Node's built-in module.
- Data outside Clio: `.data/app.db` (share allow lists and templates) and
  `.data/token.json` (the OAuth token). Both are gitignored.
- **No AI model runs at runtime.** Cost per case is $0, plus about 11 read requests to
  Clio per page load. The code was written with an AI coding assistant.
