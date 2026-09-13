# Push notifications

How an agent or terminal that needs attention reaches a phone that is not connected. In-app attention (the badge, the toast) is a different path and is not covered here.

## Pipeline

1. The agent manager reports attention with a reason: `finished`, `permission`, or `error` (`packages/protocol/src/agent-attention-notification.ts`). Terminals report `finished` and `needs_input` through `packages/server/src/server/websocket-server.ts`.
2. `computeNotificationPlan` in `packages/server/src/server/agent-attention-policy.ts` picks one delivery from client presence. Every connected client sends a `client_heartbeat` with `lastActivityAt`; on desktop that comes from the system idle timer, not from the app being open.
   - A visible client focused on that agent or terminal: nothing.
   - Any client active in the last 3 minutes: in-app notification to the most recent one only.
   - Otherwise: push. `error` never pushes.
3. `createPushNotifications` in `packages/server/src/server/push/index.ts` delivers to every configured channel at once.

## Channels

| Channel | Who registers                                  | Transport                                | Works on                     |
| ------- | ---------------------------------------------- | ---------------------------------------- | ---------------------------- |
| Expo    | the app, per daemon, via `register_push_token` | daemon → `exp.host` → FCM/APNs           | store builds                 |
| ntfy    | `daemon.push.ntfy` in `config.json`            | daemon → your ntfy server → the ntfy app | any build, including F-Droid |

Both channels are independent of the relay: the daemon posts outbound over HTTPS and the phone does not need a live connection to receive. A connection is still needed to register an Expo token and to act on the notification.

### Expo

Tokens live in `$PASEO_HOME/push-tokens.json` with a 48 hour lease, renewed on every heartbeat from the registering client. A phone that has not connected for two days silently stops receiving push until it reconnects. There is no log line for a lease expiring; `Sending push notification` with `tokenCount: 0` is the symptom.

The F-Droid build (`PASEO_FDROID_BUILD=1`) cannot use this channel. Firebase is excluded from that profile and `packages/app/src/fdroid/expo-notifications.ts` reports the permission as permanently denied, so the app never obtains a token and never registers one. A daemon whose only phone runs the F-Droid build has zero active tokens forever. Use ntfy there.

### ntfy

`packages/server/src/server/push/ntfy.ts` publishes JSON to the server root with the topic in the body, so the config only needs a server URL and a topic. The `click` field is a `paseo://` deep link: agents open directly through `buildAgentDeepLink`; terminal notifications land on the host, because the workspace path encoding lives in the app (`packages/app/src/utils/host-routes.ts`) and the daemon cannot reproduce it.

`daemon.push` is reloadable; editing `config.json` takes effect without a restart. The notification body is the agent's last message, so point this at a server you trust or one only reachable on your own network. User-facing setup is in [public-docs/configuration.md](../public-docs/configuration.md#push-notifications).

Adding a UnifiedPush channel later means storing endpoints alongside Expo tokens in the same store and posting to them the same way ntfy is posted to; the app registers the endpoint like it registers a token today.
