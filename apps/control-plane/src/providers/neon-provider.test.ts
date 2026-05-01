import { describe, expect, it } from "vitest";
import { NeonBranchProvider } from "./neon-provider.js";
import type { ResolvedLiveForkAppEnvironment } from "../../../spike-app/server/live-fork-config.js";

function environment(): ResolvedLiveForkAppEnvironment {
  return {
    app: {} as ResolvedLiveForkAppEnvironment["app"],
    environment: {} as ResolvedLiveForkAppEnvironment["environment"],
    credential: {} as ResolvedLiveForkAppEnvironment["credential"],
    neonApiKey: "neon-secret",
    neon: {
      neonProjectId: "project-123",
      parentBranchId: "br-parent",
      databaseName: "ringofbeara",
      roleName: "app",
      pooled: true
    }
  };
}

describe("NeonBranchProvider", () => {
  it("creates a branch with a read-write endpoint and retrieves the connection URI", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/branches")) {
        return Response.json({
          branch: { id: "br-session" },
          endpoints: [{ id: "ep-session", type: "read_write" }]
        }, { status: 201 });
      }
      return Response.json({ uri: "postgres://app:secret@ep-session.neon.tech/ringofbeara" });
    };

    const provider = new NeonBranchProvider({ fetch: fetchMock });
    const branch = await provider.createBranch({
      sessionId: "sess_123",
      environment: environment(),
      expiresAt: "2026-04-30T12:00:00.000Z"
    });

    expect(branch).toMatchObject({
      projectId: "project-123",
      branchId: "br-session",
      endpointId: "ep-session",
      databaseName: "ringofbeara",
      roleName: "app"
    });
    expect(calls[0]?.init?.body).toContain("\"parent_id\":\"br-parent\"");
    expect(calls[1]?.url).toContain("branch_id=br-session");
    expect(calls[1]?.url).toContain("endpoint_id=ep-session");
    expect(calls[1]?.url).toContain("pooled=true");
  });

  it("deletes the session branch by project and branch id", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 204 });
    };

    const provider = new NeonBranchProvider({ fetch: fetchMock });
    await provider.deleteBranch({ apiKey: "neon-secret", projectId: "project-123", branchId: "br-session" });

    expect(calls[0]?.url).toBe("https://console.neon.tech/api/v2/projects/project-123/branches/br-session");
    expect(calls[0]?.init?.method).toBe("DELETE");
  });
});
