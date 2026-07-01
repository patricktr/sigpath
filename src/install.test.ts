import { describe, it, expect } from "vitest";
import { nextInstall, installStage, isCableDone, INSTALL_STAGES } from "./install";

describe("install status helpers (p3-cableschedule)", () => {
  it("absent status reads as planned", () => {
    expect(installStage(undefined)).toBe("planned");
  });

  it("cycles Planned → Pulled → Terminated → Tested → Planned", () => {
    let s = nextInstall(undefined); // planned -> pulled
    expect(s).toBe("pulled");
    s = nextInstall(s);
    expect(s).toBe("terminated");
    s = nextInstall(s);
    expect(s).toBe("tested");
    s = nextInstall(s); // wraps
    expect(s).toBe("planned");
    expect(INSTALL_STAGES).toHaveLength(4);
  });

  it("only 'tested' counts as done", () => {
    expect(isCableDone("tested")).toBe(true);
    expect(isCableDone("terminated")).toBe(false);
    expect(isCableDone(undefined)).toBe(false);
  });
});
