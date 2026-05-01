import { redactSecrets } from "../../../../packages/live-fork/src/redaction.js";
import type { ResolvedLiveForkAppEnvironment } from "../../../spike-app/server/live-fork-config.js";

type Fetch = typeof fetch;

export type NeonBranch = {
  provider: "neon";
  projectId: string;
  branchId: string;
  endpointId?: string;
  databaseName: string;
  roleName: string;
  pooled: boolean;
  databaseUrl: string;
};

type NeonBranchResponse = {
  branch?: {
    id?: string;
    name?: string;
  };
  endpoints?: Array<{
    id?: string;
    branch_id?: string;
    type?: string;
  }>;
};

type NeonConnectionUriResponse = {
  uri?: string;
  connection_uri?: string;
};

function neonHeaders(apiKey: string) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

async function neonRequest<T>(
  path: string,
  options: {
    apiKey: string;
    method?: string;
    body?: unknown;
    fetch?: Fetch;
  }
) {
  const response = await (options.fetch ?? fetch)(`https://console.neon.tech/api/v2${path}`, {
    method: options.method ?? "GET",
    headers: neonHeaders(options.apiKey),
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const body = redactSecrets(await response.text(), [options.apiKey]);
    throw new Error(`Neon API request failed (${response.status}) for ${path}: ${body}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export class NeonBranchProvider {
  constructor(private readonly options: { fetch?: Fetch } = {}) {}

  async createBranch(input: {
    sessionId: string;
    environment: ResolvedLiveForkAppEnvironment;
    expiresAt?: string;
  }): Promise<NeonBranch> {
    const { neon, neonApiKey } = input.environment;
    const branchName = `workpowers-${input.sessionId}`;
    const body = {
      branch: {
        name: branchName,
        parent_id: neon.parentBranchId,
        expires_at: input.expiresAt
      },
      endpoints: [{ type: "read_write" }]
    };

    const created = await neonRequest<NeonBranchResponse>(
      `/projects/${encodeURIComponent(neon.neonProjectId)}/branches`,
      {
        apiKey: neonApiKey,
        method: "POST",
        body,
        fetch: this.options.fetch
      }
    );

    const branchId = created.branch?.id;
    if (!branchId) throw new Error("Neon branch creation response did not include a branch id.");

    const endpointId = created.endpoints?.find((endpoint) => endpoint.type === "read_write")?.id;
    const uriParams = new URLSearchParams({
      branch_id: branchId,
      database_name: neon.databaseName,
      role_name: neon.roleName,
      pooled: String(neon.pooled)
    });
    if (endpointId) uriParams.set("endpoint_id", endpointId);

    const connection = await neonRequest<NeonConnectionUriResponse>(
      `/projects/${encodeURIComponent(neon.neonProjectId)}/connection_uri?${uriParams.toString()}`,
      {
        apiKey: neonApiKey,
        fetch: this.options.fetch
      }
    );

    const databaseUrl = connection.uri ?? connection.connection_uri;
    if (!databaseUrl) throw new Error("Neon connection URI response did not include a URI.");

    return {
      provider: "neon",
      projectId: neon.neonProjectId,
      branchId,
      endpointId,
      databaseName: neon.databaseName,
      roleName: neon.roleName,
      pooled: neon.pooled,
      databaseUrl
    };
  }

  async deleteBranch(input: { apiKey: string; projectId: string; branchId: string }) {
    await neonRequest<void>(
      `/projects/${encodeURIComponent(input.projectId)}/branches/${encodeURIComponent(input.branchId)}`,
      {
        apiKey: input.apiKey,
        method: "DELETE",
        fetch: this.options.fetch
      }
    );
  }
}
