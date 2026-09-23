# Android intents

What the Android app accepts from other apps, what it exposes for automation,
and the rules every entry point follows. The pieces live in
`packages/app/src/intents/`, the native module
`packages/app/modules/paseo-android-intents/`, the shortcut config plugin
`packages/app/plugins/with-android-shortcuts.js`, and the `intentFilters` block
in `packages/app/app.config.js`.

## Entry points

| Entry point                                | Android intent                                        | What happens                                                                              |
| ------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Share sheet: text, URL, one or more images | `SEND` / `SEND_MULTIPLE` with `text/plain`, `image/*` | Lands in the New workspace composer as a draft. The user picks the project and sends.     |
| Text selection menu ("Paseo")              | `PROCESS_TEXT` with `text/plain`                      | Same as a text share. Paseo never writes the selection back.                              |
| `paseo://` links                           | `VIEW` with the `paseo` scheme                        | Routes below. Also used by launcher shortcuts.                                            |
| Static launcher shortcuts                  | long-press the app icon                               | New workspace, Open project, History. Declared by the config plugin.                      |
| Dynamic launcher shortcut                  | long-press the app icon                               | "Resume <workspace>" for the last workspace the user opened. Set from the app at runtime. |
| Assistant catalog provider                 | query `content://sh.paseo.assistant/…`                | Read-only workspace, agent, and message listing for on-device assistants. See below.      |
| EVA extension service                      | bind `com.colonelpanic.eva.action.EXTENSION`          | Starts agents and sends prompts for EVA, with durable receipts. See below.                |
| Pairing offer                              | any URL with `#offer=`                                | Adds the host. See `OfferLinkListener` in `packages/app/src/app/_layout.tsx`.             |

Shares and selections always go to the New workspace composer. It is the one
surface that exists before a host or workspace is chosen, and a fresh share
appends to whatever draft is already there rather than replacing it. Only text
and images are accepted; other files need a host to upload to, and there is
none yet at share time. The user sees a toast naming how many files were
skipped.

## Links

`paseo://<path>` resolves to the app route `/<path>`, so every route in
`packages/app/src/app` is reachable. These are the ones meant for other apps.
Every query parameter is optional unless marked.

| Link                                                                                                              | Parameters                                                      | Result                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `paseo://new`                                                                                                     | `prompt`, `serverId`, `projectId`, `dir`, `name`, `draftId`     | New workspace screen. `prompt` is appended to the composer draft; nothing is sent.                           |
| `paseo://agent`                                                                                                   | `agentId` (required), `serverId`, `prompt`, `send`              | Opens the agent. `prompt` is appended to its composer. `send=true` sends it instead, if the setting allows.  |
| `paseo://workspace`                                                                                               | `workspaceId` (required), `serverId`, `agentId` or `terminalId` | Opens the workspace, on the named agent or terminal tab when given.                                          |
| `paseo://h/<serverId>/agent/<agentId>`                                                                            | `prompt`, `send`                                                | Canonical agent link (`buildAgentDeepLink` in `packages/protocol`). Same prompt handling as `paseo://agent`. |
| `paseo://h/<serverId>/workspace/<workspaceId>`                                                                    | `open=agent:<id>` / `terminal:<id>` / `file:<encoded>`          | Canonical workspace link.                                                                                    |
| `paseo://open-project`, `paseo://sessions`, `paseo://schedules`, `paseo://settings`, `paseo://settings/<section>` | none                                                            | Open that screen.                                                                                            |

`paseo://agent` and `paseo://workspace` exist because some callers can only
fill query parameters, never path segments. They resolve the host and replace
themselves with the canonical route.

**Agent/workspace link host resolution** when `serverId` is omitted: the host of the last opened
workspace, else the only configured host. With several hosts and no history
the link fails with a toast asking for `serverId`. An unknown `serverId` fails
the same way; a link never adds a host on its own. `/new` uses the interactive
form's host defaults instead. Automation callers must supply `serverId` and
`projectId` together; do not rely on the form's remembered/online-host fallback.
The project ID resolves its root from that host's project registry, so `dir`
is not needed. An unresolved ID without `dir` retains its selection with no
usable directory until hydration or an explicit project choice.

**Prompts** are capped at 16,000 characters and merged into the target draft,
which survives until that composer mounts. Sending without a tap is off by
default: `send=true` only sends when **Settings → General → Send prompts from
links** is on, because any installed app can open a `paseo://` link and an
agent runs commands on the host. With the setting off, or the host offline, the
prompt lands in the composer and a toast says why it was not sent. `send` is
ignored on `paseo://new`; creating an agent goes through the New workspace
form.

## Rules

- Payloads from the native side are validated with a schema before use and
  dropped whole when malformed. Route parameters are read through
  `readLinkParam` and friends in `packages/app/src/intents/automation-link.ts`,
  never straight from `useLocalSearchParams`.
- Shared files are accepted only as `content://` URIs with an `image/*` type,
  copied into the app cache (16 files, 25 MB each at most), and handed to the
  attachment store as `file://` paths. The native staging copy is removed after
  persistence or failure. The original grant is never retained.
- Links never launch components, open arbitrary URLs, or change hosts. The only
  side effect a link can have without a tap is the opt-in prompt send above.
- Dynamic shortcut links are checked on the native side to use the `paseo`
  scheme and are pinned to the app's own package.
- One share is one prompt: the native module strips the delivered intent after
  reading it so activity recreation and React Native reloads do not replay it.

## Assistant catalog provider

Links let another app act, but not look. The app exports a read-only content
provider (`AssistantContentProvider` in the native module) with four tables:

| URI                                                                            | Columns                                                                                               |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `content://sh.paseo.assistant/projects?serverId=&q=&limit=`                    | `id`, `serverId`, `name`, `kind`                                                                      |
| `content://sh.paseo.assistant/workspaces?q=&limit=`                            | `id`, `serverId`, `name`, `project`, `repository`, `branch`, `status`, `agentCount`, `lastActivityAt` |
| `content://sh.paseo.assistant/agents?workspaceId=&serverId=&q=&limit=`         | `id`, `serverId`, `workspaceId`, `name`, `provider`, `status`, `lastActivityAt`                       |
| `content://sh.paseo.assistant/messages?agentId=&workspaceId=&serverId=&limit=` | `id`, `serverId`, `workspaceId`, `agentId`, `agentName`, `kind`, `createdAt`, `text`                  |

`projects`, `workspaces`, and `agents` come from a catalog the app publishes whenever hosts,
workspaces, or agents change: ids, names, status, and activity, most recent
first, capped at 100 workspaces and 200 agents. Projects come from the host
registry, including projects without workspaces, sorted by name and capped at 100. Use `(serverId, id)` as the project identity, never the name or a repository
grouping key. The catalog publisher retains directory demand for configured
hosts while mounted, so discovery does not require first visiting a project. Paths, prompts, and transcripts
are never in it. Those three tables read a file, so they work without starting
React Native and answer as of the last time the app was open. `q` is a
case-insensitive substring match over the row's columns and `limit` is 1 to 100
(default 25).
`repository` is the Git remote's host and repository path, without credentials
or URL query parameters. It is empty when Paseo has no parseable remote.
Use `serverId` from a catalog row to scope an agent or message query to the
host that owns it. Omitting it preserves cross-host lookup for older callers.

On every table a SQL selection or sort order is refused rather than ignored.
The provider serves the exact `com.colonelpanic.eva` package only when Android
verifies its released signing certificate. `com.colonelpanic.eva.debug` is
accepted only by test builds (see [Authorization](#authorization)). Other
callers cannot read the catalog or transcripts. The pinned certificate in
`AssistantCallerPolicy` comes from EVA's signed release APK and must be
updated if its signing identity rotates.

### Messages

`messages` is the transcript, so it cannot come from a file. Pass exactly one of
`agentId` or `workspaceId` — `agentId` wins when both are set, neither is an
error — and `limit` 1 to 50 (default 10). Rows are newest first, `kind` is
`user`, `assistant`, `tool`, or `notice`, and `text` is plain text clipped to
1000 characters. A `workspaceId` fans out over that workspace's non-archived
top-level agents on every host that owns it and merges them by time.

The provider's binder thread parks for up to 17 seconds while
`AssistantQueryBridge` runs the `PaseoAssistantTask` Headless JS task (see
[Headless runtime](#headless-runtime)). The task connects the hosts it needs,
loads their directories, fetches the timelines, and answers with
`resolveAssistantQuery`. This works with no screen open and from a cold
process. Callers should allow 20 seconds. Reasoning, todos, and tool internals
are dropped on the way, because an assistant reads these out loud.

Anything that keeps the app from answering — a host offline, an unknown id, a
timeout, a failed fetch — comes back as a `kind=notice` row whose `text` is a
sentence the assistant can read, not an exception. A partial workspace fetch
includes a notice before the available messages so the assistant does not
present an incomplete transcript as complete. Only a request the provider
cannot parse throws. A workspace whose agents have said nothing yet returns no
rows.

The authority is `sh.paseo.assistant` for release builds and
`<package>.assistant` for the debug variant, declared by
`packages/app/plugins/with-assistant-provider.js`, because Android refuses to
install two apps that claim one authority.

## Assistant actions (EVA extension)

The provider only reads. To act, EVA binds `EvaExtensionService`, an
implementation of EVA's installed-app extension protocol v1 (EVA's
`docs/extension-protocol.md`). The same config plugin declares it with action
`com.colonelpanic.eva.action.EXTENSION` and metadata
`com.colonelpanic.eva.extension.version=1`. The two AIDL files under
`modules/paseo-android-intents/android/src/main/aidl/` are EVA's ABI: copy them
verbatim, never edit them here.

| Capability       | Effects | Wait | Arguments                                                                                                                                                                                                                                   |
| ---------------- | ------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_agent`   | write   | 25 s | `serverId`, `projectId`, `prompt`, `isolation` (`local`/`worktree`) required. Worktree only: `worktreeMode`, `baseRef`, `branch`, `prNumber`, `forge`, `worktreeSlug`. Optional `provider`, `model`, `modeId`, `thinkingOptionId`, `title`. |
| `send_prompt`    | write   | 25 s | `serverId`, `agentId`, `prompt` required; `activeTurnBehavior` `steer` (default) or `interrupt`.                                                                                                                                            |
| `request_status` | read    | 10 s | `invocationId` of an earlier call.                                                                                                                                                                                                          |

Schemas are flat and use only `type`, `description`, `enum`, `minLength` and
`maxLength`; EVA rejects the whole descriptor on any other keyword. Ranges,
the slug format and field combinations are enforced in
`assistant/AssistantCapabilities.kt`. The descriptor revision is a hash of the
descriptor, so any schema or wording change produces a new one. After changing
it, regenerate EVA's fixture (`app/src/test/resources/extensions/paseo-describe.json`
in EVA) and tell the EVA owner.

### Authorization

Every binder call checks the caller with `AssistantCallerPolicy`, the same
rule the provider uses (`assistant/CallerRules.kt`). The calling UID must own
exactly one package: `com.colonelpanic.eva` with the pinned release
certificate, or, in a test build only, `com.colonelpanic.eva.debug` signed
with this build's key. A test build is a debuggable build, or a release build
prebuilt with `PASEO_ASSISTANT_DEBUG_CALLERS=1`. That variable makes the config
plugin add the `sh.paseo.assistant.allowDebugCallers` metadata. Production
builds never set it, so they refuse debug EVA even when it shares their
signer. Mutations also need
**Settings → General → Let EVA run agents**. It is off by default and stored in
native `SharedPreferences`, so it is checked before any JavaScript starts. It
is rechecked whenever a saved request resumes. EVA's own per-action grants
still apply on EVA's side.

Unattended runs never borrow interactive state. `serverId` and `projectId` must
name a project in the host's live registry (`project.list`); there is no
remembered-host or remembered-project fallback. `provider` and `model` default
to the New workspace form's saved choice, and a saved model the host no longer
offers falls back to the provider default. `modeId` comes only from the request.
A saved permission mode is never applied, so an unattended agent cannot inherit
full access. No provider anywhere is `needs_configuration`.

### Receipts

Each call is journaled in `filesDir/assistant-requests/` (credential-encrypted
storage), keyed by caller UID and invocation ID. The record is written before
any network work and stores a fingerprint of the arguments. Reusing an ID with
different arguments is a conflict. An identical replay returns the recorded
receipt and never re-runs a settled request.

Before the first send, the executor resolves the exact daemon request and
commits it together with `dispatchStarted`. Every later run replays that stored
request under the same idempotency key (`assistant:<journal key>`) and message
ID. The daemon's durable `CreationService` and `MessageReceipts` turn a replay
into a status read, so a replay cannot create a second workspace or send a
second prompt. The daemon reports `outcomeUnknown` if it restarted mid-dispatch;
that becomes `uncertain` and is never retried.

| State                                                                             | Meaning                                                                                | EVA envelope                       |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------- |
| `accepted`                                                                        | Journaled. The daemon has not acknowledged it yet                                      | `handed_off`, pollable             |
| `waiting_for_host`                                                                | Host unreachable. Resumes on the next status call                                      | `handed_off`, pollable             |
| `submitted`                                                                       | Daemon admitted it. Workspace or agent may exist; prompt not confirmed                 | `handed_off`, pollable             |
| `completed`                                                                       | Creation reached `prompt_started`, or `send_agent_message` was accepted. Not task done | `completed`                        |
| `uncertain`                                                                       | May have run. Do not retry; check in Paseo                                             | `unknown`                          |
| `failed`                                                                          | Definite failure after admission. Partial effects possible                             | `failed`                           |
| `rejected`, `request_id_conflict`, `unknown_request`                              | Nothing sent: bad arguments, unknown host/project/agent/provider/model/mode, reused ID | `not_executed`/`invalid_arguments` |
| `expired`                                                                         | Pending 10 minutes and never sent                                                      | `not_executed`/`deadline_exceeded` |
| `not_started`                                                                     | No React host to run on                                                                | `not_executed`                     |
| `needs_authorization`, `needs_configuration`, `needs_host_update`, `needs_unlock` | Nothing sent. The user has to act                                                      | `not_executed`/`not_configured`    |

`ReceiptRules` in `assistant/AssistantReceipts.kt` is the only code that changes
a state. Terminal states are final, `submitted` never regresses, and once
`dispatchStarted` is set, a "nothing was sent" state becomes `uncertain`.
A request sent without an acknowledgement for 10 minutes becomes `uncertain`
rather than `expired`. `request_status` replies `completed`; the stored state
is in the receipt. It is also the only retry path. Paseo never retries in the
background, so a pending request advances only while EVA asks about it.

Execute replies arrive by the deadline minus 1.5 seconds with whatever state is
current. The daemon owns creation once it admits the request, so that work
finishes even if EVA unbinds. Work before admission continues only while the
process is alive and bound.

### Headless runtime

The daemon transport (pairing, relay encryption, request correlation) exists
only in the JavaScript client, so execution and transcript reads run in
JavaScript. `AssistantRuntime` starts the app's `ReactHost` without an Activity
when no React context exists, then runs `PaseoAssistantTask`. The task is
registered at bundle load in `src/intents/register-assistant-task.android.ts`,
because no component mounts in a headless start. It boots the host runtime from
storage and waits for the host connection
(`src/intents/assistant-task.ts`). A warm app runs the same task on its live
host runtime. Describe, caller checks, argument validation, the journal, and
status reads of settled requests stay native and never start JavaScript. This
deliberately departs from the protocol's advice to avoid starting JavaScript.
A native daemon transport would remove the dependency, but it would duplicate
the relay protocol.

A headless start mounts no React tree, so state that a provider or hook fills
in stays empty. The session's `serverInfo` is written by `session-context.tsx`,
so `refreshWorkspaceDirectory` waits on it forever headless, and route
preparation only reads the local cache. Headless code talks to the client
directly, or uses directory calls that do not wait on React-owned state, such
as `refreshAgentDirectory`.

### Lifecycle

| Phone state                         | What happens                                                                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App open, or warm in the background | The task runs on the live runtime and reuses its host connections.                                                                                                                                 |
| Process evicted or never started    | Binding cold-starts the process; the task starts React Native headless. Budget a few seconds of the 25-second wait for that.                                                                       |
| Locked after the first unlock       | Same as above. Credential-encrypted storage stays readable, and no activity launch or keyguard dismissal is involved.                                                                              |
| Before the first unlock             | Neither the service nor the provider is Direct Boot aware, so Android does not resolve them. EVA reports `needs_unlock`. Do not move hosts, prompts, or the journal into device-protected storage. |
| Force-stopped                       | An explicit bind from EVA still starts the service and the headless runtime.                                                                                                                       |
| Host offline                        | `waiting_for_host`. Each status call reconnects and resumes; after 10 minutes it is `expired`.                                                                                                     |

While EVA is bound, Android treats Paseo as serving a foreground client, so the
process is not frozen. Android's [background activity launch](https://developer.android.com/guide/components/activities/background-starts)
and [foreground-service start](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)
restrictions do not apply, because nothing launches an activity or a
foreground service. See [Direct Boot](https://developer.android.com/privacy-and-security/direct-boot)
for what is readable before the first unlock.

To test on a device, use EVA's `InstalledExtensionDeviceTest` (EVA
`docs/operations.md`). You need a disposable emulator or device, a Paseo test
build that shares a signer with EVA debug, and a disposable paired host. Treat
transcripts and logs as private. EVA has no device test for content queries.
Run a `/messages` query as EVA with a small instrumentation APK that targets
`com.colonelpanic.eva.debug` and is signed with EVA debug's key. Its code runs
in EVA's process, so the provider sees EVA's UID and package.

Verified on 2026-09-23 on an API 36 `google_apis` emulator with a PIN set and
the keyguard showing. The setup was a production-variant APK signed with the
RN template debug key (the same signer as EVA debug), a throwaway daemon, and
the `mock` provider. With the process killed or force-stopped, `create_agent`
(local and worktree) and `send_prompt` returned `completed` in 0.9–2.0
seconds. That time includes the cold React Native start. The daemon showed one
agent per call, with the prompt as its first user message. Settled
`request_status` reads took under 5 ms and started no JavaScript. With the host
down, `create_agent` returned `waiting_for_host` at 23.5 seconds. After the
host came back, one `request_status` resumed and completed it without a
duplicate. With the toggle off, the call returned `needs_authorization`.
With the app force-stopped, `/messages` from EVA's process returned the agent's
latest rows in 1.5 seconds, and a workspace fan-out in 1.4 seconds. A
production-configured build refused the same caller: the provider threw
`SecurityException`, and the service replied `unauthorized_caller`.
Before-first-unlock after a reboot, and a physical phone, are not yet verified.

## Invoking from adb

```bash
adb shell am start -a android.intent.action.VIEW -d 'paseo://new?prompt=Fix%20the%20flaky%20test'
adb shell am start -a android.intent.action.VIEW -d 'paseo://agent?agentId=agent-123&prompt=Run%20the%20tests&send=true'
adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT 'https://github.com/getpaseo/paseo/issues/1' sh.paseo
adb shell am start -a android.intent.action.PROCESS_TEXT -t text/plain --es android.intent.extra.PROCESS_TEXT 'explain this' sh.paseo
```

Use the variant's package id (`sh.paseo`, `sh.paseo.debug`) where a package is
named; the activity is always `<package>.MainActivity`.

## Automation clients

An automation tool that can only launch a fixed action, a fixed URI base, and
scalar query values (a voice assistant's declarative intent binding, a Tasker
task, a widget) has everything it needs in the links table: action `VIEW`,
base `paseo://agent` or `paseo://new`, query slots for the parameters.
Launching a link proves the handoff, not that the prompt was sent. EVA uses
[Assistant actions](#assistant-actions-eva-extension) instead, which report
the outcome. Ids come from the catalog provider above or from the user.

## Adding an entry point

1. Declare the filter in `androidIntentFilters` in `app.config.js`, or the
   shortcut in `STATIC_SHORTCUTS` in the config plugin.
2. Parse and bound the input in `packages/app/src/intents/`; add the test
   beside it.
3. Stage prompts through `stagePendingPrompt` keyed by the draft the composer
   will own. Do not write to the draft store directly: the composer merges the
   pending prompt once it has hydrated, which is what makes cold start, warm
   start, and an already-open composer behave the same.
4. Document the link or filter in the tables above.
