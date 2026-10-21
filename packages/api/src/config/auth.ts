import { env } from './env';

/** One server-owned switch controls both advertised UI and OAuth routes. */
export function isGitHubAuthEnabled() {
  return (
    env.GITHUB_AUTH_ENABLED === 'true' &&
    Boolean(
      env.GITHUB_CLIENT_ID &&
        env.GITHUB_CLIENT_SECRET &&
        env.GITHUB_REDIRECT_URI,
    ) &&
    (env.NODE_ENV !== 'production' ||
      new URL(env.GITHUB_REDIRECT_URI!).protocol === 'https:')
  );
}
