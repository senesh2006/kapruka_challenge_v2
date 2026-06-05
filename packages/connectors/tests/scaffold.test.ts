import { describe, expect, it } from "vitest";
import type { CatalogueConnector } from "../src/catalogue/index.js";

describe("@sevana/connectors", () => {
  it("declares a catalogue connector contract", () => {
    const stub: CatalogueConnector = { name: "stub" };
    expect(stub.name).toBe("stub");
  });
});
