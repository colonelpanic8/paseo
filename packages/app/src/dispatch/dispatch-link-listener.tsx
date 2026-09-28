import * as Linking from "expo-linking";
import { useEffect } from "react";
import { isNative } from "@/constants/platform";
import { parseDispatchLink } from "@/dispatch/dispatch-link";
import { requestDispatch } from "@/dispatch/dispatch-request";

/**
 * Turns `paseo://dispatch` openings into dispatch requests. No host gating here:
 * the surface that records has to wait for the target's client anyway, and it
 * is the one that can explain what it is waiting on.
 */
export function DispatchLinkListener() {
  useEffect(() => {
    if (!isNative) {
      return;
    }

    let cancelled = false;
    function handleUrl(url: string | null): void {
      if (cancelled || !url) {
        return;
      }
      const link = parseDispatchLink(url);
      if (link) {
        requestDispatch(link);
      }
    }

    void Linking.getInitialURL()
      .then(handleUrl)
      .catch(() => undefined);
    const subscription = Linking.addEventListener("url", (event) => {
      handleUrl(event.url);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return null;
}
