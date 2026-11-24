# CutieBot v3

A ground-up TypeScript rewrite of the legacy CutieBot Discord bot:
economy, moderation, music, and AI chat on discord.js v14 +
discord-player v7 + MongoDB, with a transactional data layer and a
full offline test suite.

## Setup

Requirements: Node.js 24, a MongoDB deployment **with a replica set**
(transactions are used for economy mutations — a standalone mongod
will not work), and a Discord application with a bot user.

```sh
npm ci
cp .env.example .env   # fill in the values (see below)
npm run build
npm run commands:deploy -- --guild <GUILD_ID>   # or --global
npm start
```

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Bot token. |
| `CLIENT_ID` | yes | Application (client) ID — a Discord snowflake. |
| `MONGO_URI` | yes | Must point at a replica set for transactions. |
| `GUILD_ID` | no | Default guild for the deploy script. |
| `OWNER_ID` | no | Gates the owner-only admin commands (`/restart`, `/setavatar`, `/setusername`). |
| `OPENAI_API_KEY` | no | Without it the AI features report themselves unavailable; everything else works. |
| `OPENAI_MODEL` | no | Defaults to the built-in model choice. |
| `YOUTUBE_COOKIE` | no | Optional burner-account cookie; see Limitations. |
| `AI_PER_USER_DAILY_CAP` | no | Default 50. Non-negative integer; 0 disables AI per-user. |
| `AI_GLOBAL_DAILY_CAP` | no | Default 500. Non-negative integer; 0 disables AI entirely. |
| `LOG_LEVEL` | no | pino level: trace, debug, info, warn, error, fatal, silent. |

The bot fails fast at boot with a descriptive `EnvError` listing every
missing or invalid variable.

## Development

```sh
npm run lint        # eslint
npm run typecheck   # tsc --noEmit (strict)
npm run build       # tsc → dist/
npm test            # the whole suite in one run (vitest)
npm run commands:deploy -- --dry-run   # print the command payload, no network
node dist/scripts/smoke-music.js       # extractor registration smoke check
```

Tests are fully offline: unit tests use fakes, and the MongoDB
integration tests run against a single shared in-memory replica set
(`mongodb-memory-server`, started once in a Vitest global setup; each
suite uses its own database). No Discord or OpenAI network access is
needed, and no manual cleanup is required — test data directories live
under the repo-local `.test-tmp/`.

## Operator notes

- **Economy idempotency.** Every money-moving command records its
  Discord interaction ID in an `economy_idempotency` ledger inside the
  same transaction as the mutation, together with the operation's
  parameters and the complete receipt (actual amount moved, game
  outcome, resulting balances). A redelivered interaction is answered
  from the stored receipt — before any balance validation — instead of
  moving money twice or re-rolling a game. Records expire after 24 h
  (TTL index).
- **Economy quarantine.** A stored account whose record cannot be
  normalized (garbage, negative, or unsafe-integer balances, a
  `userId`/`_id` identity conflict, or an inventory quantity that
  would overflow) is **not** silently reset: the original document is
  appended to the `economy_quarantine` collection as an event (every
  event is preserved) with the list of issues, an error is logged,
  and the account is **frozen** — every money movement for it is
  refused with a "frozen" error, and no fresh account is created over
  the archived record. To resolve a frozen account, an operator
  reviews the events in `economy_quarantine` and calls
  `EconomyRepo.resolveQuarantine(userId, corrected)` with a corrected
  record to restore the account, or with `null` to discard the
  quarantined record and let the account start fresh. Inspect that
  collection if a user reports a missing or frozen balance.
  (Normalization itself is not lossless in general: fractional values
  are floored and unrepresentable inventory entries are dropped, each
  reported in the event's issue list.)
- **AI caps are a cost circuit breaker**, not just counters: per-user
  and global daily caps (above), a per-request output-token cap, a
  pending-request bound, a provider concurrency bound, and a 60 s
  end-to-end deadline per request.
- **Mention-chat reset.** Mention/reply conversations are per-channel
  and shared. A member with the Manage Messages permission can reset
  the channel's conversation by mentioning the bot with just the word
  `reset`; `/ask reset` resets a user's own /ask conversation.

## Limitations (honest list)

- **YouTube playback is experimental and best-effort.** YouTube
  frequently bot-checks datacenter IPs ("sign in to confirm you're not
  a bot"); when that happens the bot says so plainly. A burner-account
  `YOUTUBE_COOKIE` is the documented mitigation. SoundCloud, Spotify
  (via its extractor bridge), Vimeo, Apple Music, and Reverbnation
  links are the reliable paths. Text searches follow the extractors
  that actually registered at boot: YouTube search when the YouTube
  extractor is live, otherwise SoundCloud — and a YouTube search that
  throws or comes back empty falls back once to SoundCloud, so a dead
  YouTube path never takes text search down with it. Song titles that
  contain a colon (e.g. "Re:Zero OST") are treated as searches, as
  they should be.
- **SSRF posture.** User-supplied links are restricted in-app to
  http(s) URLs on the extractor platforms' hosts, with no credentials
  and no explicit ports, and searches use explicit per-platform query
  engines instead of an auto resolver. What the bot **cannot** control
  in-app is the extractors' own network behavior (redirects and
  secondary requests inside extractor libraries); if that matters for
  your deployment, run the bot behind egress rules that only allow
  the platform hosts.
- **AI reply triggers need a ping or visible content.** With Discord's
  reply-ping disabled, a reply to the bot carries no mention and —
  without the privileged Message Content intent — no readable content,
  so the bot cannot detect it. Mention the bot (or enable reply pings)
  for reply-style chat.
- **Intentionally cut legacy features** (see PHASE6.md's parity table
  for the full accounting): anonymous `/say`, the prefix-command
  system, chess/TFT profile lookups, the Minecraft server status
  command, Reddit image fetching, and the legacy coin drip. `/filter`
  and the standalone controller-panel poster were not ported either;
  the controller lives on every now-playing message instead.
