# Usage history

**Usage history** is the per-host settings page that charts token and cost usage per day. It is a different feature from **Usage**, which shows live subscription quota windows from `packages/server/src/services/quota-fetcher/`. The two share no code and no RPC. Do not merge them.

## Where the numbers come from

The daemon scans the provider CLIs' own session transcripts on disk, not Paseo's agent records:

| Provider    | Directory                                          | Usage carrier                                                           |
| ----------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| Claude Code | `<home>/projects/**/*.jsonl` (default `~/.claude`) | `type: "assistant"` records, `message.usage`                            |
| Codex       | `<home>/sessions/**/*.jsonl` (default `~/.codex`)  | `token_count` events; the model comes from the preceding `turn_context` |

Reading the CLI's files means usage is complete even for turns that never went through Paseo. It also means the page only knows about providers that keep a transcript with token counts. Copilot, OpenCode, and Pi are absent for that reason, not by policy. Adding one is a new parser in `packages/server/src/services/usage-history/transcripts.ts` plus a kind in `provider-homes.ts`.

## One home per configured provider

The scan enumerates a transcript home for **every configured provider**, not just the two defaults. A user can run several accounts of the same kind by extending a built-in provider with its own `CLAUDE_CONFIG_DIR` or `CODEX_HOME` (see [custom-providers.md](custom-providers.md)), and each of those homes holds its own transcripts. Reading only `process.env` and the default home is the bug this replaced: on a machine with three extra homes it reported less than half the real Codex usage, and looked healthy while doing it.

The base kind is resolved by following `extends` transitively; anything that does not land on `claude` or `codex` keeps no token transcripts and is skipped. Homes are deduplicated by `realpath`, because two configured providers may point at one directory and would otherwise double count every token in it. Built-in defaults are always scanned, even when the provider is disabled, since past usage is still real. Each scan re-reads the current configuration, so adding a provider takes effect without a daemon restart.

A bucket therefore carries both `provider`, the base kind that groups the chart series, and `providerId`, the configured provider that owns the home. `sources[]` reports one entry per home with that provider's label, so the page can name a home whose scan failed rather than quietly dropping its tokens.

RPC: `provider.usage_history.read.request` / `.response`, gated on `server_info.features.providerUsageHistory`. Buckets are `(day, provider, providerId, model)` in the client's IANA time zone, so a turn lands on the day the user experienced it. Invalid time zones and windows longer than 90 calendar days are rejected before scanning.

## Counting rules that are easy to break

- **Claude repeats `usage` per content block.** Every record for one assistant message carries the same complete usage object. The parser keys on `message.id:requestId` and the aggregator keeps the first. Summing without this overcounts by more than 2x.
- **Resumed and forked Claude sessions copy history forward**, so the same key appears in several files. Dedupe is global across the scan, not per file.
- **Codex `token_count` carries deltas in `last_token_usage`** and re-emits an unchanged event on some stream boundaries. Consecutive identical payloads are dropped. `input_tokens` is inclusive of the cached portion.
- **Codex forked and subagent rollouts open with the parent's history re-stamped to the fork instant.** The parser drops the leading burst until the first event that is more than a second after its predecessor.
- **Reasoning tokens are a subset of output tokens.** Total processed tokens is uncached input + cached input + cache creation + output. Never add reasoning on top.
- **Cost is an API-equivalent estimate, not a bill.** Rates come from LiteLLM's `model_prices_and_context_window.json`, priced at the base tier. Models the table does not know are counted in tokens and reported as `unpriced`. `unpricedRecords` survives aggregation through the chart and tables. Any unpriced activity makes the estimate incomplete: known costs show a lower bound, wholly unknown costs show “—”, and cost shares are withheld.

## Cache

`$PASEO_HOME/usage-history/scan-cache.json` memoizes parsed records per file, keyed by `(size, mtime, provider)`, with the byte offset where parsing stopped. Transcripts are append-only, so a file that grew resumes from that offset after a 64-byte guard hash confirms the tail is unchanged; anything else re-parses from byte zero. The cache is per file rather than per day so changing the time zone invalidates nothing. Scans and cache persistence run serially. Identical pending requests share a result; at most eight distinct requests are admitted, with excess requests rejected for retry. Entries older than 90 days are pruned. A corrupt cache costs one cold scan, never an error.

`$PASEO_HOME/usage-history/model-rates.json` is the last fetched rate table. It is refreshed after 24 hours, or on the page's refresh action subject to a 60 second floor. Offline, the page keeps working from the snapshot and reports `pricing.status: "cached"`.

Files are prefiltered by mtime with 36 hours of slack, so a session that last wrote just before local midnight on the first day of the window is still opened.

## App

`packages/app/src/provider-usage-history/` owns the page. The hook returns a discriminated view; the section never reads raw query state. The chart is stacked daily bars, one segment per base kind, zero-filled across the window — configured providers of one kind share a series, so adding an account does not shift the colors.

`derive.ts` splits the same buckets twice: per kind, which drives the headline, the summary rows, and the chart, and per configured provider, which drives the summary sub-rows and the Provider breakdown. A kind only grows sub-rows once more than one of its configured providers has activity, so the common single-account host looks exactly as it did. A `failed` source puts a muted line in the summary naming that provider, because its tokens are missing from every total on the page; a `missing` home stays silent.
