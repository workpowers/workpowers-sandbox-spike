# GitHub App Repo Access

WorkPowers uses an organization-owned GitHub App installation to clone private repositories for live forks. It does not use manually configured user tokens, deploy keys, or per-environment GitHub checkout tokens.

## Local GitHub App Setup

Create a GitHub App with:

- Homepage URL: `https://workpowers.ai` or `http://localhost:3000`
- Setup URL: `http://localhost:3000/github/setup`
- Redirect on update: enabled
- Webhook: disabled for the current milestone
- Repository permissions:
  - Contents: read-only
  - Metadata: read-only
- User, organization, and account permissions: no access
- Installable by: any account, if the target repo is not under the app owner's account

After creating the app, generate a private key and add these to `.env`:

```env
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_SLUG=workpowers-live-fork-local
```

`GITHUB_APP_INSTALL_URL` can be used instead of `GITHUB_APP_SLUG` when the install URL needs to be explicit.

## WorkPowers Setup Flow

1. Run migrations:

   ```bash
   npm run db:migrate
   ```

2. Start the local services:

   ```bash
   npm run dev:spike-api
   npm run dev:spike
   npm run dev
   ```

3. Open `http://localhost:3000/github`.
4. Log in as a WorkPowers user in the target organization.
5. Click **Install GitHub App**.
6. Install the app on the repository owner account and select the target repositories.
7. GitHub redirects back to `/github/setup?installation_id=...`.
8. WorkPowers syncs the installation and repository grants into the active organization.

The UI also has a manual sync fallback: paste a GitHub installation id into the GitHub page and click **Sync**.

## Runtime Access Model

Live fork session creation uses:

```json
{
  "repoUrl": "https://github.com/evanfuture/ringofbeara.com.git",
  "credentialRef": "org:github-app"
}
```

The resolver:

1. Confirms the requesting user belongs to the WorkPowers organization.
2. Finds an active GitHub App installation for that organization.
3. Confirms the requested repository is in the synced repository grants.
4. Mints a short-lived GitHub App installation token.
5. Passes the token only to the runtime checkout layer.

The token is not stored in the database, session JSON, boot events, logs, diffs, API responses, or git remote URL. Daytona checkout uses `GIT_ASKPASS` and then rewrites `origin` back to the clean `https://github.com/owner/repo.git` URL.

## API Endpoints

- `GET /api/github/app`
  - Returns whether GitHub App env is configured and the install URL.
- `GET /api/github/installations`
  - Lists active installations and repository grants for the active WorkPowers organization.
- `POST /api/github/installations/sync`
  - Body: `{ "githubInstallationId": "..." }`
  - Fetches installation metadata, lists repositories available to the installation, upserts grants, and marks removed grants inactive.
- `POST /api/live-fork-sessions`
  - Starts a live fork through the control plane using the active WorkPowers organization and `credentialRef: org:github-app`.

## Troubleshooting

- **GitHub page says env is not configured**
  - Check `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY`.
  - Restart the spike API after changing `.env`.

- **Install button is missing**
  - Set `GITHUB_APP_SLUG` or `GITHUB_APP_INSTALL_URL`.
  - Restart the spike API.

- **Repo does not appear after install**
  - Confirm the app was installed on the account that owns the repo.
  - Confirm the repo was selected in the GitHub App installation settings.
  - Use the manual sync fallback with the installation id.

- **Live fork fails with setup error**
  - The expected setup error is: `GitHub App is not installed for this organization/repository.`
  - Re-sync the installation from the WorkPowers GitHub page.
  - Confirm the active WorkPowers organization is the one that owns the synced grant.
