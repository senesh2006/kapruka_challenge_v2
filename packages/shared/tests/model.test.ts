import { describe, expect, it } from "vitest";
import { TenantSchema } from "../src/model/tenant.js";

describe("@sevana/shared model", () => {
  it("rejects a tenant missing required fields", () => {
    const result = TenantSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
