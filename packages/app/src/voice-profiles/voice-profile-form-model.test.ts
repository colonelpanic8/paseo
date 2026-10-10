import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_PROFILE_CONFIGURATION } from "@getpaseo/protocol/voice-profiles";
import { openVoiceProfileForm, type VoiceProfileFormSnapshot } from "./voice-profile-form-model";

const PROFILE_ID = "prf_" + "c".repeat(32);

function snapshot(overrides: Partial<VoiceProfileFormSnapshot> = {}): VoiceProfileFormSnapshot {
  return {
    mode: "create",
    voiceOptions: ["cedar", "marin"],
    backendModelOptions: [
      { id: "gpt-5", label: "GPT-5", thinkingOptionIds: ["low", "high"] },
      { id: "gpt-5-mini", label: "GPT-5 mini", thinkingOptionIds: ["low"] },
    ],
    ...overrides,
  };
}

describe("voice profile form model", () => {
  it("requires a name and bounds the long fields", () => {
    const model = openVoiceProfileForm(snapshot());
    expect(model.getState().canSubmit).toBe(false);
    expect(model.getState().nameError).toBe("name_required");

    model.setName("  Ada  ");
    expect(model.getState().canSubmit).toBe(true);
    expect(model.buildSaveInput().name).toBe("Ada");

    model.setInstructions("x".repeat(1001));
    expect(model.getState().canSubmit).toBe(false);
    expect(model.getState().nameError).toBe("too_long");

    model.setInstructions("x".repeat(1000));
    expect(model.getState().canSubmit).toBe(true);
    model.setName("n".repeat(121));
    expect(model.getState().nameError).toBe("name_too_long");
  });

  it("parses one file path per line and refuses relative paths", () => {
    const model = openVoiceProfileForm(snapshot());
    model.setName("Ada");
    model.setFilesText("~/org/AGENTS.md\n\n  /srv/notes.org  \n");
    expect(model.getState().canSubmit).toBe(true);
    expect(model.buildSaveInput().configuration.files).toEqual([
      "~/org/AGENTS.md",
      "/srv/notes.org",
    ]);

    model.setFilesText("notes.org");
    expect(model.getState().canSubmit).toBe(false);
    expect(model.getState().nameError).toBe("files_invalid");

    model.setFilesText(Array.from({ length: 17 }, (_, i) => `/f/${i}`).join("\n"));
    expect(model.getState().nameError).toBe("files_invalid");
  });

  it("edits carry the record's id and revision and start from its files", () => {
    const edit = openVoiceProfileForm(
      snapshot({
        mode: "edit",
        record: {
          id: PROFILE_ID,
          name: "Ada",
          revision: 4,
          configuration: {
            ...DEFAULT_VOICE_PROFILE_CONFIGURATION,
            instructions: "keep",
            files: ["~/a.md", "~/b.md"],
          },
        },
      }),
    );
    expect(edit.getState().filesText).toBe("~/a.md\n~/b.md");
    expect(edit.buildSaveInput()).toEqual({
      profileId: PROFILE_ID,
      expectedRevision: 4,
      name: "Ada",
      configuration: {
        ...DEFAULT_VOICE_PROFILE_CONFIGURATION,
        instructions: "keep",
        files: ["~/a.md", "~/b.md"],
      },
    });
  });

  it("drops a thinking choice the new backend model does not offer", () => {
    const model = openVoiceProfileForm(snapshot());
    model.setBackendModel("gpt-5");
    model.setBackendThinking("high");
    expect(model.getState().availableThinkingOptionIds).toEqual(["low", "high"]);

    model.setBackendModel("gpt-5-mini");
    expect(model.getState().configuration.backendThinkingOptionId).toBeNull();
    expect(model.getState().availableThinkingOptionIds).toEqual(["low"]);

    model.setBackendModel(null);
    expect(model.getState().availableThinkingOptionIds).toEqual([]);
  });

  it("normalizes blank optional values to null on submit", () => {
    const model = openVoiceProfileForm(snapshot());
    model.setName("Ada");
    model.setVoice("  ");
    model.setBackendModel(" ");
    model.setContext("  notes  ");
    expect(model.buildSaveInput().configuration).toEqual({
      ...DEFAULT_VOICE_PROFILE_CONFIGURATION,
      context: "notes",
    });
  });
});
