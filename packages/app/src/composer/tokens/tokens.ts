/**
 * Composer inline tokens.
 *
 * A token is a *view* over the composer's plain text, re-derived on every render
 * from the same string that gets submitted. Nothing is stored alongside the text:
 * drafts, dictation, undo and the wire format all keep working because the text
 * is still the only source of truth. Deleting the sigil deletes the pill.
 */

import { DEFAULT_COMMAND_SIGIL, type ComposerSigils } from "./sigils";

export type ComposerTokenType = "command" | "skill";

export interface ComposerToken {
  type: ComposerTokenType;
  /** Token text without the sigil, e.g. `release-beta`. */
  name: string;
  /** Index of the sigil. */
  start: number;
  /** Index one past the last name character. */
  end: number;
}

/** `start` is the segment's offset in the source text and its React key. */
export type ComposerTextSegment =
  | { kind: "text"; text: string; start: number }
  | { kind: "token"; text: string; start: number; token: ComposerToken };

const NAME_START = /[A-Za-z]/;
const NAME_BODY = /[A-Za-z0-9:_-]/;

function readTokenName(text: string, nameStart: number): number {
  if (nameStart >= text.length || !NAME_START.test(text[nameStart] ?? "")) {
    return nameStart;
  }
  let index = nameStart + 1;
  while (index < text.length && NAME_BODY.test(text[index] ?? "")) {
    index += 1;
  }
  return index;
}

function isBoundary(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

/**
 * Find every command/skill token in `text`.
 *
 * The command trigger represents a command only at the start of the prompt.
 * Either trigger represents a skill after whitespace, preserving the existing
 * inline slash-skill flow while adding a dedicated skills trigger.
 */
export function collectComposerTokens(text: string, sigils: ComposerSigils): ComposerToken[] {
  const tokens: ComposerToken[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const isCommandSigil = char === sigils.command;
    const isSkillSigil = char === sigils.skill;
    if (!isCommandSigil && !isSkillSigil) {
      continue;
    }

    const previous = index > 0 ? text[index - 1] : undefined;
    if (!isBoundary(previous)) {
      continue;
    }

    const nameEnd = readTokenName(text, index + 1);
    const continuesAsPath = text[nameEnd] === "/";
    if (nameEnd === index + 1 || continuesAsPath) {
      continue;
    }

    tokens.push({
      type: isCommandSigil && index === 0 ? "command" : "skill",
      name: text.slice(index + 1, nameEnd),
      start: index,
      end: nameEnd,
    });
    index = nameEnd - 1;
  }

  return tokens;
}

/**
 * Convert configurable UI triggers to the slash form understood by the daemon
 * and every agent provider.
 */
export function normalizeComposerTokensForSubmission(text: string, sigils: ComposerSigils): string {
  const tokens = collectComposerTokens(text, sigils);
  if (tokens.length === 0) {
    return text;
  }

  let normalized = "";
  let cursor = 0;
  for (const token of tokens) {
    normalized += text.slice(cursor, token.start);
    normalized += DEFAULT_COMMAND_SIGIL;
    normalized += text.slice(token.start + 1, token.end);
    cursor = token.end;
  }
  normalized += text.slice(cursor);
  return normalized;
}

/**
 * Split `text` into alternating plain and token segments covering the whole
 * string, so a renderer can walk it once without doing its own slicing.
 */
export function segmentComposerText(
  text: string,
  tokens: readonly ComposerToken[],
): ComposerTextSegment[] {
  const segments: ComposerTextSegment[] = [];
  let cursor = 0;

  for (const token of tokens) {
    if (token.start > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, token.start), start: cursor });
    }
    segments.push({
      kind: "token",
      text: text.slice(token.start, token.end),
      start: token.start,
      token,
    });
    cursor = token.end;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor), start: cursor });
  }

  return segments;
}
