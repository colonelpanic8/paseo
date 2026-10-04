/**
 * `paseo://dispatch?host=<serverId>&agent=<agentId>`
 *
 * A one-shot spoken prompt: the app records, transcribes on the host, sends the
 * text to an agent, and gets out of the way. Without parameters it targets the
 * Dispatch agent from settings — the same target watch Dispatch uses — so a
 * shortcut is one fixed URL. Opening the link again while a dispatch is
 * listening sends it, so a single earbud gesture is both "start" and "send".
 */
export interface DispatchLink {
  host: string | null;
  agent: string | null;
}

export function parseDispatchLink(url: string): DispatchLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const isDispatchLink =
    parsed.protocol === "paseo:" &&
    parsed.hostname === "dispatch" &&
    (parsed.pathname === "" || parsed.pathname === "/");
  if (!isDispatchLink) {
    return null;
  }
  const host = parsed.searchParams.get("host")?.trim() || null;
  const agent = parsed.searchParams.get("agent")?.trim() || null;
  // An agent id is meaningless without the host that owns it.
  return { host, agent: host ? agent : null };
}
