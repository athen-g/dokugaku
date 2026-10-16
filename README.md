# DokuGaku · 独学

A calm Japanese study desk, built with React, TypeScript, and Vite, with a local Node.js backend. The visual direction combines warm paper and editorial typography with restrained brutalist borders and controls.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Run `npm run build` to check types and produce a production build.

## Current scope

- Responsive Today screen and light/dark themes.
- Three-card sample Anki and WaniKani-style review rounds.
- Answer reveal, sample ratings, typed English meanings, examples, pause/resume, and round summaries.
- A short grammar lesson preview with furigana.

**Today shows live read-only connection data when configured locally. Reviews and lessons remain samples.** No reviews, card creation, or study logs are submitted by the app yet. Only the theme preference is saved in browser storage. WaniKani sample marking accepts the single displayed English meaning; a production reviewer will need richer answer handling.

## Local connections

Run Anki with AnkiConnect on `127.0.0.1:8765`. Anki queue counts include all decks except the integration-test deck/tag, and count due cards rather than new cards. Counts may differ from Anki's daily-limit display. Reviewed-today counts are distinct cards in Anki's current study day, not number of review attempts.

On Windows, the server can read user-encrypted SecureStrings from `.local/wanikani-token.clixml` and `.local/notion-token.clixml`. These must be created interactively on the same Windows account using `Read-Host -AsSecureString` and `Export-Clixml`. Never commit tokens or put them in frontend environment variables. The server decrypts tokens in memory and returns only dashboard summaries. It sends WaniKani GET requests and reads the Notion data-source schema; it does not write to either service.

The ignored `.local/notion-check.json` selects the study planner using this structure (replace the example ID locally):

```json
{
  "checks": [
    {
      "target": "Study Schedule",
      "data_sources": [{ "id": "YOUR_DATA_SOURCE_UUID" }]
    }
  ]
}
```

Existing local connection-check files are compatible. Credentials are machine/user-specific and are not portable to hosting. If a connection is missing or fails, its status is shown independently. Failed sources retain last-known counts in server memory with an explicit stale label; no successful history means unknown counts. The endpoint caches results for one minute and shares simultaneous requests. Its UI polls once a minute only while visible.

`GET /api/dashboard` is served by the local Vite server (development and preview). It rejects non-loopback hosts, cross-origin requests, and write methods. Static deployment alone cannot provide this backend. Do not expose this personal development server to the internet.

Run `npm test` for aggregation, caching, failure-state, and local-access tests.

## Planned integrations

AnkiConnect, WaniKani, and Notion will connect through a local backend. The frontend must never receive service tokens. Credentials, personal reports, private setup scripts, dependencies, and build output are ignored by Git. Integration validation is separate from this public prototype.

## Artwork

The sparrow and notebooks illustration was generated for this project with OpenAI's image-generation tool. It is decorative and does not contain study material.

## Prototype validation

The production build and TypeScript checks pass. Browser checks covered Anki sample ratings and round completion, pause/resume, correct and incorrect WaniKani-style meanings, the grammar dialog, and theme switching. Layout was checked at 320, 375, 414, and 768 pixels, with no document horizontal overflow. Private `.local` reports and PowerShell setup scripts return HTTP 403 from the Vite development server.
