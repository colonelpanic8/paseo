# Usage history

**Usage history** is the per-host settings page that charts token and cost usage per day. It is a different feature from **Usage**, which shows live subscription quota windows from `packages/server/src/services/quota-fetcher/`. The two share no code and no RPC. Do not merge them.

## Where the numbers come from

The daemon scans the provider CLIs' own session transcripts on disk, not Paseo's agent records:

| Provider    | Directory                                                      | Usage carrier                                                           |
| ----------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Claude Code | `$CLAUDE_CONFIG_DIR/projects/**/*.jsonl` (default `~/.claude`) | `type: "assistant"` records, `message.usage`                            |
| Codex       | `$CODEX_HOME/sessions/**/*.jsonl` (default `~/.codex`)         | `token_count` events; the model comes from the preceding `turn_context` |

Reading the CLI's files means usage is complete even for turns that never went through Paseo. It also means the page only knows about providers that keep a transcript with token counts. Copilot, OpenCode, and Pi are absent for that reason, not by policy. Adding one is a new parser in `packages/server/src/services/usage-history/transcripts.ts` plus a directory in `service.ts`.

RPC: `provider.usage_history.read.request` / `.response`, gated on `server_info.features.providerUsageHistory`. Buckets are `(day, provider, model)` in the client's IANA time zone, so a turn lands on the day the user experienced it.

## Counting rules that are easy to break

- **Claude repeats `usage` per content block.** Every record for one assistant message carries the same complete usage object. The parser keys on `message.id:requestId` and the aggregator keeps the first. Summing without this overcounts by more than 2x.
- **Resumed and forked Claude sessions copy history forward**, so the same key appears in several files. Dedupe is global across the scan, not per file.
- **Codex `token_count` carries deltas in `last_token_usage`** and re-emits an unchanged event on some stream boundaries. Consecutive identical payloads are dropped. `input_tokens` is inclusive of the cached portion.
- **Codex forked and subagent rollouts open with the parent's history re-stamped to the fork instant.** The parser drops the leading burst until the first event that is more than a second after its predecessor.
- **Reasoning tokens are a subset of output tokens.** Total processed tokens is uncached input + cached input + cache creation + output. Never add reasoning on top.
- **Cost is an API-equivalent estimate, not a bill.** Rates come from LiteLLM's `model_prices_and_context_window.json`, priced at the base tier. Models the table does not know are counted in tokens and reported as `unpriced`. `costSource` on a bucket says which case applies.

## Cache

`$PASEO_HOME/usage-history/scan-cache.json` memoizes parsed records per file, keyed by `(size, mtime, provider)`, with the byte offset where parsing stopped. Transcripts are append-only, so a file that grew resumes from that offset after a 64-byte guard hash confirms the tail is unchanged; anything else re-parses from byte zero. The cache is per file rather than per day so changing the time zone invalidates nothing. Entries older than 90 days are pruned. A corrupt cache costs one cold scan, never an error.

`$PASEO_HOME/usage-history/model-rates.json` is the last fetched rate table. It is refreshed after 24 hours, or on the page's refresh action subject to a 60 second floor. Offline, the page keeps working from the snapshot and reports `pricing.status: "cached"`.

Files are prefiltered by mtime with 36 hours of slack, so a session that last wrote just before local midnight on the first day of the window is still opened.

## App

`packages/app/src/provider-usage-history/` owns the page. The hook returns a discriminated view; the section never reads raw query state. The chart is stacked daily bars, one segment per provider, zero-filled across the window.
