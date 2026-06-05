import { describe, expect, it } from "vitest";
import { ORCHESTRATOR_PACKAGE } from "../src/index.js";

describe("@sevana/orchestrator", () => {
  it("exposes its package marker", () => {
    expect(ORCHESTRATOR_PACKAGE).toBe("@sevana/orchestrator");
  });
});
