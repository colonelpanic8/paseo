# Voice shortcut links

Two `paseo://` links let something outside the app — an earbud gesture, a
watch, an automation — start a spoken interaction without touching the screen.
Both are native-only; the web app ignores them.

| Link                 | Does                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `paseo://live-voice` | Starts a Live Voice call.                                                                   |
| `paseo://dispatch`   | Records one spoken prompt, transcribes it on the host, sends it to an agent, and goes away. |

The app's `+native-intent.tsx` keeps these off the router: a cold start lands
on `/`, a warm one changes no route. The listeners in
`packages/app/src/live-voice/live-voice-link-listener.tsx` and
`packages/app/src/dispatch/dispatch-link-listener.tsx` consume the URL.

## `paseo://live-voice`

Parameters, all optional:

- `host=<serverId>` — the host to call. Without it, the **Shortcut host** from
  Settings → Voice; without that, the only eligible host; with several
  eligible hosts and nothing configured, the launcher menu opens instead of
  guessing.
- `assistant=<id or name>` — who answers. Without it, the launcher's selected
  assistant on that host (which is what the **Shortcut assistant** row in
  Settings edits). An id (`ast_…`) matches exactly; a name matches
  case-insensitively and only when unique. A name that matches nothing starts a
  call with **no** assistant rather than a different one — a shortcut wired to
  "Reviewer" must not quietly call whoever was last selected.

The shortcut waits for Paseo to become visible before starting microphone access.
Opening the link during a call does nothing. If startup fails, or a previous
call ended with an error, the launcher opens with the error and retry action.

## `paseo://dispatch`

Parameters: `host=<serverId>&agent=<agentId>`, together or not at all. Without
them the target is the **Dispatch agent** from Settings → Voice, the same one
watch Dispatch uses.

The flow is hands-free by construction, because the trigger is usually a button
on an earbud:

1. Recording starts as soon as the request lands and the target host's client
   exists (a cold start waits for it).
2. Speech ends when the host's partial transcript and the microphone level have
   both been still for 2 s after something was heard. Nothing heard for 8 s
   gives up; 90 s sends whatever was heard.
3. **Opening the link again while listening sends immediately.** One gesture is
   therefore both "start" and "send".
4. The transcript goes to the agent through `sendAgentMessage`, the same call
   watch Reply and Dispatch use. A short cue plays on success or failure so the
   result is audible in the earbuds, and the strip lingers for 3 s.

The rules live in `packages/app/src/dispatch/dispatch-silence.ts`; the surface
is `dispatch-strip.tsx`, docked at the root next to the Live Voice strip.

Dispatch takes the shared microphone lease as `dictation`, so it refuses while a
Live Voice call or voice mode holds the microphone, and they refuse while it
records.

## Wiring an earbud

[soundcore-actions](https://github.com/colonelpanic8/soundcore-actions) remaps
the Soundcore app's Anka and translation screens to a link. The Liberty 5 Pro
exposes at most three distinguishable phone-side events, so a working mapping
is:

| Soundcore event       | Link                 |
| --------------------- | -------------------- |
| Anka assistant        | `paseo://live-voice` |
| Real-time translation | `paseo://dispatch`   |

Choose **Link** as the action type and `sh.paseo.assembly` (or `sh.paseo`) as
the package. The parameters above are how one gesture reaches a specific
assistant or agent when the settings default is not the one wanted.

From a shell, the same thing:

```bash
adb shell am start -n sh.paseo.assembly/.MainActivity -a android.intent.action.VIEW \
  -d 'paseo://dispatch'
```
