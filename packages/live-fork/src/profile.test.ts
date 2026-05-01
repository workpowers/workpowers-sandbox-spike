import { describe, expect, it } from "vitest";
import { parseLiveForkProfile, profileRepoUrl, previewService, profileToEnv } from "./profile.js";

describe("live fork profiles", () => {
  it("parses the production-shaped ringofbeara profile", () => {
    const profile = parseLiveForkProfile(`
name: ringofbeara
repo:
  provider: github
  owner: evanfuture
  name: ringofbeara.com
  credentialRef: org:github-app
runtime:
  provider: daytona
  snapshot: workpowers-daytona-node-playwright-postgres
  resources:
    cpu: 2
    memoryGb: 4
    diskGb: 10
install:
  command: pnpm install
services:
  web:
    command: pnpm dev --host 0.0.0.0 --port 4321
    port: 4321
    preview: true
    healthcheck: http://localhost:4321
data:
  primary:
    kind: branch
    provider: neon
    environmentRef: ringofbeara:staging
env:
  required:
    - DATABASE_URL
agent:
  daemon:
    command: pnpm workpowers-daemon
    port: 8790
checks:
  playwright:
    command: pnpm exec playwright test
    targetUrl: http://localhost:4321
lifecycle:
  ttlMinutes: 240
  idleTimeoutMinutes: 45
`);

    expect(profile.name).toBe("ringofbeara");
    expect(profileRepoUrl(profile)).toBe("https://github.com/evanfuture/ringofbeara.com.git");
    expect(profile.data.primary.environmentRef).toBe("ringofbeara:staging");
    expect(previewService(profile)).toMatchObject({ name: "web", port: 4321 });
    expect(profile.lifecycle.ttlMinutes).toBe(240);
  });

  it("fails early when required env values cannot be generated", () => {
    const profile = parseLiveForkProfile(`
name: example
repo:
  provider: github
  owner: evanfuture
  name: example.com
env:
  required:
    - DATABASE_URL
`);

    expect(() => profileToEnv(profile, {})).toThrow("DATABASE_URL");
  });

  it("preserves shell commands that contain a quoted argument", () => {
    const profile = parseLiveForkProfile(`
name: quoted-command
repo:
  provider: github
  owner: evanfuture
  name: example.com
checks:
  playwright:
    command: node --input-type=module -e "console.log('ok')"
    targetUrl: http://localhost:4321
`);

    expect(profile.checks.playwright?.command).toBe(`node --input-type=module -e "console.log('ok')"`);
  });
});
