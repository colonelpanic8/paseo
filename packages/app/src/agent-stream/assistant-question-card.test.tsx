/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

const COPY: Record<string, string> = {
  "agentStream.questions.answerPlaceholder": "Type your answer...",
  "agentStream.questions.submit": "Send answer",
  "agentStream.questions.answered": "Answered",
  "agentStream.questions.sendFailed": "Couldn't send your answer",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => COPY[key] ?? key }),
}));

// tsconfig sets the classic JSX runtime, so mounted components need React on globalThis.
vi.stubGlobal("React", React);

import { AssistantQuestionCard } from "./assistant-question-card";

const QUESTION = { title: "Which runtime?", options: ["Bun", "Node"] };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(props: React.ComponentProps<typeof AssistantQuestionCard>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<AssistantQuestionCard {...props} />);
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function option(label: string): HTMLElement {
  return screen.getByRole("radio", { name: label });
}

describe("AssistantQuestionCard", () => {
  it("preselects the recommended option and sends it", async () => {
    const onSubmit = vi.fn(async () => {});
    mount({ questions: [QUESTION], answeredInTimeline: false, onSubmit });

    expect(option("Bun").getAttribute("aria-checked")).toBe("true");
    expect(option("Node").getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      fireEvent.click(screen.getByTestId("assistant-question-submit"));
    });

    expect(onSubmit).toHaveBeenCalledWith("Bun");
    expect(screen.queryByTestId("assistant-question-submit")).toBeNull();
    expect(screen.getByTestId("assistant-question-answer").textContent).toBe("Bun");
  });

  it("sends a free-text answer instead of the preselected option", async () => {
    const onSubmit = vi.fn(async () => {});
    mount({ questions: [QUESTION], answeredInTimeline: false, onSubmit });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Type your answer..."), {
        target: { value: "Deno" },
      });
    });
    expect(option("Bun").getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      fireEvent.click(screen.getByTestId("assistant-question-submit"));
    });

    expect(onSubmit).toHaveBeenCalledWith("Deno");
  });

  it("keeps the controls after a failed send", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("offline");
    });
    mount({ questions: [QUESTION], answeredInTimeline: false, onSubmit });

    await act(async () => {
      fireEvent.click(screen.getByTestId("assistant-question-submit"));
    });

    expect(screen.getByTestId("assistant-question-submit")).toBeTruthy();
    expect(screen.getByText("Couldn't send your answer")).toBeTruthy();
  });

  it("renders as answered when a later user message already replied", () => {
    mount({ questions: [QUESTION], answeredInTimeline: true, onSubmit: vi.fn(async () => {}) });

    expect(screen.queryByTestId("assistant-question-submit")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Bun" })).toBeNull();
    expect(screen.getByText("Answered")).toBeTruthy();
    expect(screen.getByText("Which runtime?")).toBeTruthy();
  });
});
