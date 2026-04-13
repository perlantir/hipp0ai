/**
 * GitHub App client — singleton Octokit with GitHub App authentication.
 *
 * Returns null when env vars are not configured (feature disabled).
 * Env: HIPP0_GITHUB_APP_ID, HIPP0_GITHUB_APP_PRIVATE_KEY (base64),
 *      HIPP0_GITHUB_APP_INSTALLATION_ID
 */
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

let _client: Octokit | null | undefined;

export function getGitHubClient(): Octokit | null {
  if (_client !== undefined) return _client;

  const appId = process.env.HIPP0_GITHUB_APP_ID;
  const privateKeyB64 = process.env.HIPP0_GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.HIPP0_GITHUB_APP_INSTALLATION_ID;

  if (!appId || !privateKeyB64 || !installationId) {
    _client = null;
    return null;
  }

  const privateKey = Buffer.from(privateKeyB64, 'base64').toString('utf-8');

  _client = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: parseInt(appId, 10),
      privateKey,
      installationId: parseInt(installationId, 10),
    },
  });

  return _client;
}

/** Reset singleton (for testing). */
export function resetGitHubClient(): void {
  _client = undefined;
}
