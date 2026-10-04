import type pino from "pino";

import { publishToNtfy, type NtfyTarget } from "./ntfy.js";
import { PushService, type PushPayload } from "./push-service.js";
import { PushTokenStore } from "./token-store.js";

export type { PushPayload };
export type { NtfyTarget };

const PUSH_TOKEN_LEASE_MS = 48 * 60 * 60 * 1000;

export interface PushNotifications {
  renew(token: string): void;
  revoke(token: string): void;
  send(payload: PushPayload): Promise<void>;
}

export type PushNotificationSender = Pick<PushNotifications, "send">;

export function createPushNotifications(options: {
  logger: pino.Logger;
  filePath: string;
  now?: () => number;
  deliver?: (tokens: string[], payload: PushPayload) => Promise<void>;
  // Device tokens are registered by clients; the ntfy target comes from daemon
  // config so builds that cannot obtain a device token (F-Droid) still get push.
  readNtfyTarget?: () => NtfyTarget | null;
  publishNtfy?: (target: NtfyTarget, payload: PushPayload) => Promise<void>;
}): PushNotifications {
  const now = options.now ?? Date.now;
  const store = new PushTokenStore(options.logger, options.filePath, now, PUSH_TOKEN_LEASE_MS);
  const service = new PushService(options.logger, (token) => store.revokeToken(token));
  const deliver =
    options.deliver ??
    ((tokens: string[], payload: PushPayload) => service.sendPush(tokens, payload));
  const publishNtfy =
    options.publishNtfy ??
    ((target: NtfyTarget, payload: PushPayload) =>
      publishToNtfy({ target, payload, logger: options.logger }));

  return {
    renew(token) {
      store.renewToken(token);
    },
    revoke(token) {
      store.revokeToken(token);
    },
    async send(payload) {
      const tokens = store.getActiveTokens();
      const ntfyTarget = options.readNtfyTarget?.() ?? null;
      options.logger.info(
        { tokenCount: tokens.length, ntfy: ntfyTarget !== null },
        "Sending push notification",
      );
      await Promise.all([
        tokens.length > 0 ? deliver(tokens, payload) : undefined,
        ntfyTarget ? publishNtfy(ntfyTarget, payload) : undefined,
      ]);
    },
  };
}
