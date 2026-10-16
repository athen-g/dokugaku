# DokuGaku · 独学

A calm Japanese study desk, built with React, TypeScript, and Vite. The visual direction combines warm paper and editorial typography with restrained brutalist borders and controls.

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

**This is an interactive design prototype.** All cards and progress displayed are sample data. It does not submit reviews, create cards, log study, or access connected accounts. Only the theme preference is saved in browser storage. WaniKani sample marking accepts the single displayed English meaning; a production reviewer will need richer answer handling.

## Planned integrations

AnkiConnect, WaniKani, and Notion will connect through a local backend. The frontend must never receive service tokens. Credentials, personal reports, private setup scripts, dependencies, and build output are ignored by Git. Integration validation is separate from this public prototype.

## Artwork

The sparrow and notebooks illustration was generated for this project with OpenAI's image-generation tool. It is decorative and does not contain study material.
