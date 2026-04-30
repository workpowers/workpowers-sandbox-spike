export const ORG_NAME_MAX_LENGTH = 100;

export type OrgMetadata = {
  personal?: boolean;
};

export function parseOrgMetadata(metadata: unknown): OrgMetadata | null {
  if (!metadata) return null;

  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === "object" ? (parsed as OrgMetadata) : null;
    } catch {
      return null;
    }
  }

  if (typeof metadata === "object") {
    return metadata as OrgMetadata;
  }

  return null;
}

export function isPersonalOrgByMetadata(metadata: unknown): boolean {
  return parseOrgMetadata(metadata)?.personal === true;
}

export function isPersonalOrg(org: { metadata?: unknown } | null | undefined): boolean {
  return isPersonalOrgByMetadata(org?.metadata);
}
