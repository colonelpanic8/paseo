import { describe, expect, test } from "vitest";
import { openProviderAccountForm } from "./provider-account-form-model";

describe("provider account form model", () => {
  test("validates required and absolute host paths on submit", () => {
    const form = openProviderAccountForm({ existingConfigDirs: new Set() });

    expect(form.beginSubmit()).toBeNull();
    expect(form.getState()).toMatchObject({
      nameError: "required",
      configDirError: "required",
      canSubmit: false,
    });

    form.setName("Work");
    form.setConfigDir("~/.claude-work");
    expect(form.beginSubmit()).toBeNull();
    expect(form.getState().configDirError).toBe("absolute");

    form.setConfigDir("/home/ivan/.claude-work");
    expect(form.getState().canSubmit).toBe(true);
    expect(form.beginSubmit()).toEqual({
      name: "Work",
      configDir: "/home/ivan/.claude-work",
    });
    expect(form.getState().isSubmitting).toBe(true);
  });

  test("rejects an account directory that is already configured", () => {
    const form = openProviderAccountForm({
      existingConfigDirs: new Set(["/home/ivan/.claude-work"]),
    });
    form.setName("Duplicate");
    form.setConfigDir("/home/ivan/.claude-work");

    expect(form.beginSubmit()).toBeNull();
    expect(form.getState().configDirError).toBe("duplicate");
  });

  test("keeps a submission failure in model state and allows retry", () => {
    const form = openProviderAccountForm({ existingConfigDirs: new Set() });
    form.setName("Personal");
    form.setConfigDir("/home/ivan/.claude-personal");

    expect(form.beginSubmit()).not.toBeNull();
    form.endSubmit("Failed to save");

    expect(form.getState()).toMatchObject({
      isSubmitting: false,
      submitError: "Failed to save",
      canSubmit: true,
    });
  });
});
