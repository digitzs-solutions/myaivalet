# MyAIValet

The single home for MyAIValet code. One space: no sandbox copies, no separate test repos.

## What it is
The MyAIValet companion site: a visitor enters their website, and MyAIValet learns the business and answers as its AI receptionist (chat and voice).

## Pipeline
1. Contact/capture form (`/capture`, `/api/capture`)
2. Zapier capture webhook
3. Full-site crawl (`lib/fullcrawl.js`)
4. Private Vercel Blob storage for the captured record
5. Vendasta AI Knowledge import and assistant assignment (`lib/kb-ingest.js`, `lib/vendasta.js`)
6. Supabase record of the business and its discovery (`lib/supabase.js`, `lib/remember.js`)

## Configuration
All keys and IDs live in Vercel environment variables. Never commit them. `.env.example` lists the variable names only.

## Tests
`node --test test/` for unit tests; `npm run qa` for the QA script.
