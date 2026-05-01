import { describe, expect, it } from "vitest";
import {
  assertNeonEnvironmentConfig,
  decryptSecret,
  encryptSecret,
  parseEnvironmentRef
} from "./live-fork-config.js";

describe("live fork app environment config", () => {
  it("encrypts and decrypts org-owned credential material", () => {
    const encrypted = encryptSecret("neon-api-key", "workpowers-local-secret");

    expect(encrypted).toMatch(/^wpsec:v1:/);
    expect(encrypted).not.toContain("neon-api-key");
    expect(decryptSecret(encrypted, "workpowers-local-secret")).toBe("neon-api-key");
  });

  it("parses profile environment refs", () => {
    expect(parseEnvironmentRef("ringofbeara:staging")).toEqual({
      appName: "ringofbeara",
      environmentName: "staging"
    });
    expect(() => parseEnvironmentRef("ringofbeara")).toThrow("app:environment");
  });

  it("validates Neon environment config", () => {
    expect(assertNeonEnvironmentConfig({
      neonProjectId: "project",
      parentBranchId: "br-main",
      databaseName: "app",
      roleName: "app",
      pooled: true
    })).toMatchObject({ pooled: true });

    expect(() => assertNeonEnvironmentConfig({ neonProjectId: "project" })).toThrow("parentBranchId");
  });
});
