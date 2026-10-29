/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CopyButton from "../components/CopyButton.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("CopyButton", () => {
  it("uses title-case Copy with an icon and copies the exact command", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const command = "npm install -g agent-skill-manager";
    render(<CopyButton text={command} />);
    const button = screen.getByRole("button", { name: "Copy to clipboard" });
    expect(button.textContent).toBe("Copy");
    expect(button.querySelector("svg")).not.toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(button.textContent).toContain("copied!"));
    expect(writeText).toHaveBeenCalledWith(command);
    expect(button.querySelector("svg")).not.toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
  });
});
