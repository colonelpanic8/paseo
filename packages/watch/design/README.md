# Paseo Wear OS — design

`watch-mock.html` is the original static mock (fake data, Paseo dark tokens). Open it in a
browser; the voice screen animates streaming partials and running status dots pulse.

**The mock is no longer the source of truth — the app is.** It has been built and verified on
a Wear OS 5.1 emulator; see the parent [README](../README.md). Where the two disagree, the app
wins. Two places they knowingly disagree:

- **The mock was ~40% denser than Wear typography allows.** At 450×450 / 320dpi (density 2.0),
  the mock's 13px type maps to about 9sp, well under Wear's legibility floor. The app uses
  13sp/10.5sp with 46dp list chips, which fits 3½ rows rather than the mock's 4. Don't "fix"
  the app to match the mock here.
- **Project icon colors differ.** The mock hand-picked emerald/orange/sky; the app runs the
  real `projectKey` hash, so `paseo` is violet and `website` is sky. The app is correct.

Also learned on device: `ScalingLazyColumn` centers its first item by default, which spends the
top third of the screen before anything renders. Every list here passes `autoCentering = null`.

## Information architecture

Paseo's model is **Project → Workspace → Agent session** ([glossary](../../../docs/glossary.md)).
The watch respects that hierarchy but collapses every step that isn't a real choice.

```
Workspaces  ──tap──▶  1 agent   ──▶ Agent
                      0 agents  ──▶ Voice prompt (new agent in this workspace)
                      2+ agents ──▶ Agent picker ──▶ Agent
```

The agent picker exists **only** for ambiguous workspaces. The common case — one agent in a
workspace — never sees it.

### Naming on each surface

Mixing these up was the first mistake this mock made, so it's written down:

| Surface       | Primary line             | Secondary line                                 |
| ------------- | ------------------------ | ---------------------------------------------- |
| Workspace row | workspace name (`main`)  | single agent status, or `3 agents · 1 running` |
| Agent row     | provider (`Claude`)      | status + age + short intent                    |
| Agent detail  | workspace name in header | provider · status · age                        |

Worktree-backed workspaces carry the mnemonic names (`jubilant-wombat`), so those are
**workspace** labels, never agent labels.

### Project identity

Every workspace row, and every detail header, carries the project icon: a colored rounded
square with the project initial. Color derives from `projectKey` exactly as the app does
(`packages/app/src/utils/project-icon-color.ts`) so a project looks the same on wrist and phone.

The status dot rides the **corner of the project icon** on list rows and aggregates the whole
workspace (needs-input > running > idle). One glyph carries project, identity, and state.

## Sort order

Needs-attention first, then running, then idle. On a 450px screen the top two rows are all
most users will read, so they have to be the ones that matter.

## Voice

Google's system input sheet (`RemoteInput` / `ACTION_RECOGNIZE_SPEECH`) — on-device, offline,
free, and it bundles voice + keyboard + canned replies in one flow. Mic gets the accent color
and the biggest tap target; typing is the fallback inside the same sheet.

Paseo's own daemon-side dictation (`dictation_stream_*`, see `packages/protocol/src/messages.ts`)
is deliberately **not** used in v1 — the phone-tethered transport makes streaming PCM from the
watch a poor trade against a free on-device recognizer.

## Transport

Phone-tethered: the watch never speaks the daemon protocol. It talks to the phone app over the
Wearable Data Layer, and the phone app owns the daemon connection, pairing, and E2EE. Consequence
to design around, not ignore: **the phone must be reachable**, and Data Layer wakeups have to
survive the phone app being backgrounded or killed.

## Open questions

1. Agent detail shows only the last assistant message tail, capped at 3 lines — enough to reply
   from, or does it need a scrollable tail?
2. Canned replies — user-configurable from the phone, or hardcoded? Currently hardcoded in
   `ui/ReplyScreen.kt`.
3. Is `Stop` safe next to `Reply` at watch tap-target sizes? Both are 52dp; on device they sit
   about 10dp apart.
4. "New agent from a voice prompt" is built (empty workspaces route straight to it). Keep it in
   v1, or cut it back to react-to-existing-agents only?
5. On the multi-agent workspace row, is `3 agents · 1 running` the right summary, or should it
   surface the most-urgent agent's actual status?
