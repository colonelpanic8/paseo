# Usage history

**Usage history** is the app settings page that charts token and cost usage per day across every connected host. It is a different feature from **Usage**, which shows live subscription quota windows from `packages/server/src/services/quota-fetcher/`. The two share no code and no RPC. Do not merge them.

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
- **Cost is an API-equivalent estimate, not a bill.** Rates come from LiteLLM's `model_prices_and_context_window.json`, priced at the base tier. Models the table does not know are counted in tokens and reported as `unpriced`. `unpricedRecords` survives aggregation through the chart and tables. Every figure on the page is the priced cost, and shares are taken over it; the caveat is stated once, as a footnote under the summary, rather than by qualifying each figure.

## Reconciling a total by hand

A hand tally will read high unless it applies the same two filters the scan does, and the difference is large enough to look like a bug. Both were mistaken for missing tokens once:

- **Filter records by day, not files by mtime.** A file is admitted when its mtime is inside the window, then each record is placed on its own local day and dropped if it falls outside. Summing whole admitted files counts pre-window activity that the page correctly excludes; on a corpus reaching well before `sinceDay` that alone is tens of percent.
- **Dedupe Claude across files, not within one.** Resumed and forked sessions copy history forward, so the same `message.id:requestId` appears in several files and a per-file tally counts it once per file.

`sources[].scannedFiles` counts files that produced at least one record; files admitted by mtime with nothing in the window land in `skippedFiles`. A walk of the directory therefore finds more files than `scannedFiles` reports, which is not a sign of a skipped file. Transcripts are also appended while the scan runs, so two measurements taken minutes apart differ; compare them against the same corpus at the same instant.

## Cache

`$PASEO_HOME/usage-history/scan-cache.json` memoizes parsed records per file, keyed by `(size, mtime, provider)`, with the byte offset where parsing stopped. Transcripts are append-only, so a file that grew resumes from that offset after a 64-byte guard hash confirms the tail is unchanged; anything else re-parses from byte zero. The cache is per file rather than per day so changing the time zone invalidates nothing. Scans and cache persistence run serially. Identical pending requests share a result; at most eight distinct requests are admitted, with excess requests rejected for retry. Entries older than 90 days are pruned. A corrupt cache costs one cold scan, never an error.

`$PASEO_HOME/usage-history/model-rates.json` is the last fetched rate table. It is refreshed after 24 hours, or on the page's refresh action subject to a 60 second floor. Offline, the page keeps working from the snapshot and reports `pricing.status: "cached"`.

Files are prefiltered by mtime with 36 hours of slack, so a session that last wrote just before local midnight on the first day of the window is still opened.

## App

`packages/app/src/provider-usage-history/` owns the page. It lives under app settings, not host settings: usage across your machines is not a property of one of them.

The hook fans out one query per host from `useHosts()`, keyed per host so the filter reuses what is already cached, and resolves a status for each: `pending`, `ready`, `error`, `offline`, or `unsupported`. Results render as soon as any host is `ready` — the page never waits for the slowest one, and a muted coverage line under the summary names every host the totals do not cover. That line's height is reserved, so a host resolving late does not shove the rest of the page down.

Host names are resolved once, before the fan-out, so every place the page names a host reads the same string. Two hosts can carry the same name — three daemons on one machine all call themselves after it — and only then is a name qualified with the endpoint it is reached at, from `useHostRuntimeActiveConnectionLabels`. Qualifying unconditionally turns every host into an address.

`merge.ts` folds the payloads into one report and `derive.ts` does the arithmetic, taking one entry per contributing host; a single host is the length-1 case, not a second code path. Configured provider identity is `(serverId, providerId)`, because two hosts each running `codex` are two accounts, not one. Labels and ids carry the host name only once more than one host contributes, so a single-host page reads exactly as it did.

### Counting a shared directory once

Two daemons can read the same physical transcript directory — two hosts on one machine, or a home mounted over the network — and summing them doubles every token in it. Each source is fingerprinted by `(hostId, provider, path, volumeId)`, and the first host in serverId order to report a fingerprint claims it; a later host reporting the same one has that source's buckets dropped. The coverage line names the losers grouped under the host that claimed from them, and a host left with no counted source at all is named there instead of getting a zero row in the Host breakdown. Hostname alone would be wrong in both directions: every Mac in a fleet resolves `/Users/<user>/.claude`, and one machine can run two daemons under different hostnames.

`hostId` and `volumeId` are optional on the wire. A daemon that predates them sends neither, and such a source can never be proven a duplicate, so it is always counted. Two old daemons sharing a home therefore double count — the alternative is dropping real usage on a guess.

The graph uses the full settings content width above the provider summary. Host, Provider, Model, and Day are independent grouping toggles shared by the graph and table. Only observed combinations produce rows; selecting no dimensions gives one total. Provider identity remains `(serverId, providerId)`, even without the Host toggle. The grouped view consumes only buckets retained by the existing source deduplication, never the raw multi-host responses.

The chart keeps its time axis chronological. Group, cost, and token sorting applies to table rows and the chart legend; ascending and descending are selectable. Series colors stay attached to groups when sorting changes. The chart retains layered smooth areas, with a scale based on the largest individual series-day. Provider summaries remain below the graph, and failed sources and unpriced activity keep their coverage notes.
