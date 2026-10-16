# DokuGaku · 独学

A personal JLPT N5 study desk built with React, TypeScript, Vite, and a local Node backend. Warm paper, editorial typography, restrained brutalist controls, and light/dark themes. No paid AI service is used.

## Run on your computer

```sh
npm install
npm run dev -- --port 3000
```

Open the printed loopback URL. Keep Anki open for Anki reviews and automatic card creation. The backend is included in both `npm run dev` and `npm run preview`; a static deployment alone cannot provide the integrations.

```sh
npm test
npm run build
```

## Study features

- Today: live connection summaries, exam countdown, weekday/weekend suggestions, next unfinished lesson, and active study time.
- Review: real Anki and WaniKani rounds of 5, 10, or 20 cards, with breaks and early finish.
- Learn: 28 original foundation lessons, examples with furigana, device speech, and server-marked lesson checks. These are independent teaching material, not copied from a textbook.
- Practice: short reading/listening rounds and a mistake queue that removes questions after a subsequent correct answer.
- Mock exams: one original 96-question paper, three timed sections (20/40/30 minutes), saved answers, refresh recovery, section locking, explanations, and raw results. The item mix is not an official replica. It uses supportive furigana and device-generated speech, not official recordings. Raw accuracy cannot predict a JLPT scaled score or pass.
- Progress: automatically recorded activity, daily Notion summaries, automatic mistake cards, connection retry controls, and record export.
- Library: official resource links and optional private Drive PDF/audio previews. Supplied reference papers are not transcribed or automatically scored; the built-in original paper is automatically scored.

Japanese practice audio requires an installed Japanese speech voice. Availability is detected and an unavailable voice is shown explicitly. Anki audio uses Anki's own playback on this computer. WanaKana provides romaji-to-kana input for reading answers.

## Connection setup and private data

AnkiConnect must listen on `127.0.0.1:8765`. The review flow uses Anki's active reviewer, available rating buttons, and scheduling intervals. Deck daily limits and learning steps still apply. Avoid reviewing the same deck in both windows simultaneously. Card HTML is sandboxed: scripts and external network requests are blocked. Script-driven template controls may require Anki's own window.

The live dashboard counts due cards across all decks except the integration-test deck/tag. These counts exclude new cards and can differ from Anki's daily-limit display. Reviewed-today counts are distinct cards in Anki's study day. DokuGaku's Progress page counts completed activity inside DokuGaku only.

On Windows, store credentials as user-encrypted SecureStrings in `.local/wanikani-token.clixml` and `.local/notion-token.clixml`, created interactively using `Read-Host -AsSecureString` and `Export-Clixml` on the same Windows account. Credentials are decrypted only in server memory, are never returned to the browser, and cannot be copied to hosting. WaniKani needs review-creation permission; Notion needs read/insert/update access to the planner.

The ignored `.local/notion-check.json` selects the existing planner:

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

The planner currently expects `Task` (title), `Done` (checkbox), and `Notes` (rich text). Daily entries are identified by `dokugaku-day-YYYY-MM-DD`. Existing unrelated entries are not edited. Active time excludes hidden tabs, breaks, and periods without interaction for more than a minute; it is an estimate of activity, not attention measurement. The exam timer continues while away.

Anki mistakes go into a separate `DokuGaku::Mistakes` deck using a `DokuGaku Recall` note type. Stable question tags avoid duplicate cards. Unanswered exam questions remain visible as gaps but do not create dozens of cards automatically. Card creation and Notion logging are on by default and can be disabled independently in Progress.

An optional ignored `.local/resource-catalog.json` adds source viewers without publishing personal file IDs:

```json
{
  "items": [
    {
      "title": "My reference paper",
      "kind": "paper",
      "url": "https://drive.google.com/file/d/YOUR_FILE_ID/preview"
    }
  ]
}
```

Supported kinds: paper, audio, answers, transcript, folder. Only Google Drive file previews/views and folder links are accepted. Drive remains responsible for access and previews.

## Saving and failure recovery

Activity, answers, sessions, pending cards, preferences, and sync receipts are saved atomically in ignored `.local/study-state.json`. Browser storage holds theme/page preferences and session pointers. Export in Progress produces a personal JSON backup; keep backups private. Do not run multiple backend processes against the same local state file.

Notion and pending card creation retry once a minute while the local server runs, or through Progress. A completed activity first saves locally, so unavailable external services do not erase results. The server queries stable markers before retrying card/log creation. Closed server = no background syncing; reopen it to continue.

Real review writes are serialized and guarded against repeat requests and changed cards/assignments. WaniKani checks accepted meanings, personal synonyms, whitelisted auxiliary meanings, and accepted readings. Both required parts must be correct before its review is sent; misses are counted. Marking uses exact normalized answers rather than WaniKani's full typo-tolerance algorithm. New lessons/assignment starts are not performed by this app.

An interrupted real-review write has an unknown outcome. It is kept as pending and never blindly retried, including after a server restart. Check the source app, then start a fresh round. Successful retries of the same completed request do not double-submit. No offline review scheduling is invented.

The dashboard is read-only and caches successful checks for a minute. Failed services show unknown or explicitly stale counts independently. Write endpoints require loopback Host, matching Origin, JSON, and the DokuGaku request header. Media access accepts only local filenames and supported image/audio types. Private files, setup scripts, tokens, and server source are denied by the Vite file server and ignored by Git. Keep this personal server on loopback.

## Verification

The test suite uses isolated fixtures and temporary storage, never live review submissions. It covers caching, source outages, scoring, deadlines, answer persistence, duplicate writes, unknown write outcomes, external assignment changes, lost create responses, atomic storage, and origin validation. Browser checks exercise the live queues, Anki answer/audio controls, lesson refresh recovery, mock navigation, source viewers, responsive layout, and themes without completing study activities on the user's behalf.

## Sources and artwork

Section timing: [official JLPT test sections](https://www.jlpt.jp/e/guideline/testsections.html). WaniKani integration: [official API](https://docs.api.wanikani.com/20170710/). Input conversion: [WanaKana](https://wanakana.com/). Independent project, not affiliated with WaniKani or JLPT organisers.

The decorative sparrow and notebooks illustration was generated for this project with OpenAI's image-generation tool.
