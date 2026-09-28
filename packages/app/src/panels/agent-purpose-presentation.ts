/**
 * `fallback` is the runtime subtitle ("Claude · Opus 4.5 · High", or "Claude agent" while the
 * model is unknown). The purpose summary takes the subtitle slot when there is one, so the
 * tooltip keeps any model detail the subtitle would otherwise have shown.
 */
export function buildAgentPurposePresentation(input: {
  label: string | null;
  summary: string | null;
  fallback: string;
}): { subtitle: string; tooltip: string } {
  const hasRuntimeDetail = !input.fallback.endsWith(" agent");
  const lines = [
    input.label ?? input.fallback,
    input.summary,
    input.label && hasRuntimeDetail ? input.fallback : null,
  ].filter((line): line is string => Boolean(line));
  return {
    subtitle: input.summary ?? input.fallback,
    tooltip: lines.join("\n"),
  };
}
