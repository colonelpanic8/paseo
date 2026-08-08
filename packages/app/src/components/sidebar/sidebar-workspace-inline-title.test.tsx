/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { toastError } = vi.hoisted(() => ({
  toastError: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/constants/platform", () => ({
  isWeb: true,
}));

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ error: toastError }),
}));

import { SidebarWorkspaceInlineTitle } from "./sidebar-workspace-inline-title";

const titleStyle = { fontSize: 14 };

vi.stubGlobal("React", React);

describe("SidebarWorkspaceInlineTitle", () => {
  afterEach(() => {
    cleanup();
    toastError.mockReset();
  });

  it("opens on double click and commits the trimmed value on blur", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(
      <SidebarWorkspaceInlineTitle
        displayValue="main"
        renameValue="main"
        editable
        onSubmit={onSubmit}
        style={titleStyle}
        testID="workspace-title"
      />,
    );

    fireEvent.pointerDown(screen.getByTestId("workspace-title"));
    expect(screen.queryByTestId("workspace-title-input")).toBeNull();

    fireEvent.pointerDown(screen.getByTestId("workspace-title"));
    const input = screen.getByTestId("workspace-title-input");
    expect(input).toHaveProperty("value", "main");

    fireEvent.change(input, { target: { value: "  Payments Refactor  " } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("Payments Refactor");
    });
    await waitFor(() => {
      expect(screen.queryByTestId("workspace-title-input")).toBeNull();
    });
  });

  it("opens even when an ancestor swallows the event before React's root delegate", () => {
    // The sidebar row's Pressable stops `pointerdown` from bubbling, so a
    // `View`-level onPointerDown prop never fires from real input.
    const onSubmit = vi.fn(async () => undefined);
    const swallow = (event: Event) => {
      event.stopPropagation();
    };
    render(
      <div data-testid="row">
        <SidebarWorkspaceInlineTitle
          displayValue="main"
          renameValue="main"
          editable
          onSubmit={onSubmit}
          style={titleStyle}
          testID="workspace-title"
        />
      </div>,
    );
    screen.getByTestId("row").addEventListener("pointerdown", swallow);

    fireEvent.pointerDown(screen.getByTestId("workspace-title"));
    fireEvent.pointerDown(screen.getByTestId("workspace-title"));

    expect(screen.getByTestId("workspace-title-input")).toHaveProperty("value", "main");
  });

  it("does not edit when the displayed source is not the workspace title", () => {
    const onSubmit = vi.fn(async () => undefined);
    render(
      <SidebarWorkspaceInlineTitle
        displayValue="feature/sidebar"
        renameValue="Workspace title"
        editable={false}
        onSubmit={onSubmit}
        style={titleStyle}
        testID="workspace-title"
      />,
    );

    fireEvent.pointerDown(screen.getByTestId("workspace-title"));
    fireEvent.pointerDown(screen.getByTestId("workspace-title"));

    expect(screen.queryByTestId("workspace-title-input")).toBeNull();
  });
});
