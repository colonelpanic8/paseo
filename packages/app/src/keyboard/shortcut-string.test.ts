import { describe, expect, it } from "vitest";
import {
  keyComboToString,
  keyboardEventToComboString,
  parseShortcutString,
} from "./shortcut-string";

function keyboardEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    code: "",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("keyboardEventToComboString", () => {
  it("captures the minus key (regression: previously returned null)", () => {
    expect(keyboardEventToComboString(keyboardEvent({ key: "-", code: "Minus" }))).toBe("-");
  });

  it("captures minus with modifiers", () => {
    expect(
      keyboardEventToComboString(keyboardEvent({ key: "-", code: "Minus", metaKey: true })),
    ).toBe("Cmd+-");
    expect(
      keyboardEventToComboString(keyboardEvent({ key: "_", code: "Minus", shiftKey: true })),
    ).toBe("Shift+-");
  });

  it("captures equal, semicolon, and quote", () => {
    expect(keyboardEventToComboString(keyboardEvent({ key: "=", code: "Equal" }))).toBe("=");
    expect(keyboardEventToComboString(keyboardEvent({ key: ";", code: "Semicolon" }))).toBe(";");
    expect(keyboardEventToComboString(keyboardEvent({ key: "'", code: "Quote" }))).toBe("'");
  });

  it("still returns null for modifier-only presses", () => {
    expect(keyboardEventToComboString(keyboardEvent({ code: "ShiftLeft" }))).toBeNull();
  });
});

describe("parseShortcutString round-trips punctuation keys", () => {
  const cases: ReadonlyArray<[string, string, string, string]> = [
    ["-", "Minus", "-", "_"],
    ["=", "Equal", "=", "+"],
    [";", "Semicolon", ";", ":"],
    ["'", "Quote", "'", '"'],
  ];

  for (const [humanKey, code, key, shiftedKey] of cases) {
    it(`round-trips ${humanKey}`, () => {
      const combo = parseShortcutString(humanKey);
      expect(combo.code).toBe(code);
      expect(combo.key).toBe(key);
      expect(combo.shiftedKey).toBe(shiftedKey);
      expect(keyComboToString(combo)).toBe(humanKey);
    });
  }

  it("round-trips a modifier combo with minus", () => {
    const combo = parseShortcutString("Cmd+-");
    expect(combo.meta).toBe(true);
    expect(combo.code).toBe("Minus");
    expect(keyComboToString(combo)).toBe("Cmd+-");
  });
});

describe("function-key shortcuts", () => {
  for (let index = 1; index <= 24; index += 1) {
    const key = `F${index}`;

    it(`parses, displays, and captures ${key}`, () => {
      const combo = parseShortcutString(key);
      expect(combo).toEqual({ code: key });
      expect(keyComboToString(combo)).toBe(key);
      expect(keyboardEventToComboString(keyboardEvent({ key, code: key }))).toBe(key);
    });
  }

  it("rejects function keys outside F1-F24", () => {
    expect(() => parseShortcutString("F25")).toThrow('Unknown key: "F25"');
  });
});
