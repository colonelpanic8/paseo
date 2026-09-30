import type { UsageDisplayAs } from "./preferences";
import type { UsageTone } from "./types";

export function deriveTone(usedPct: number | null | undefined): UsageTone {
  if (usedPct == null) return "default";
  if (usedPct > 90) return "danger";
  if (usedPct >= 70) return "warning";
  return "default";
}

export function resolveWindowBarTone(
  displayAs: UsageDisplayAs,
  usedPct: number | null | undefined,
  windowTone: UsageTone | undefined,
): UsageTone {
  return displayAs === "remaining" ? "ok" : (windowTone ?? deriveTone(usedPct));
}
