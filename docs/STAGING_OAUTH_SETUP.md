# Staging GitHub OAuth setup

This guide configures authentication for the isolated StoryForge staging Worker only. It does not authorize or require any Production changes.

## 1. Create a separate GitHub OAuth App

While signed into the GitHub account that should own the staging instance, open **Settings → Developer settings → OAuth Apps → New OAuth App**.

Use these exact values:

- Application name: `StoryForge Staging`
- Homepage URL: `https://storyforge-staging.jastsadakorn-n.workers.dev/`
- Authorization callback URL: `https://storyforge-staging.jastsadakorn-n.workers.dev/auth/callback`
- Enable Device Flow: leave disabled

Do not reuse the Production OAuth App. Keep the new Client ID and generated Client Secret private.

## 2. Set the staging Worker variables

In Cloudflare Dashboard, open **Workers & Pages → storyforge-staging → Settings → Variables and Secrets**.

Add the following bindings to the **storyforge-staging Worker only**:

| Name | Type | Value |
|---|---|---|
| `GITHUB_CLIENT_ID` | Secret | Client ID from the new Staging OAuth App |
| `GITHUB_CLIENT_SECRET` | Secret | Client Secret from the new Staging OAuth App |
| `GITHUB_OWNER_ID` | Secret | Numeric GitHub user ID of the one permitted owner |

The owner ID is the numeric `id` from the GitHub user API, not the username/login. Do not put these values in Git, issue comments, chat, or frontend code.

If using Wrangler instead of the dashboard, run each command from a trusted local terminal and enter its value only at the hidden prompt:

```sh
npx wrangler secret put GITHUB_CLIENT_ID --name storyforge-staging
npx wrangler secret put GITHUB_CLIENT_SECRET --name storyforge-staging
npx wrangler secret put GITHUB_OWNER_ID --name storyforge-staging
```

Do not run these commands with `--name storyforge`; that is the Production Worker.

## 3. Verify staging readiness

After Cloudflare finishes activating the updated Worker:

1. Open `https://storyforge-staging.jastsadakorn-n.workers.dev/api/health`.
2. Confirm `ok`, `databaseReady`, and `authConfigured` are all `true`. The health endpoint exposes only a boolean readiness flag, never the OAuth values.
3. Open `https://storyforge-staging.jastsadakorn-n.workers.dev/auth/login` and confirm GitHub displays the **StoryForge Staging** authorization page.
4. Complete login using only the designated owner account.
5. Confirm the app returns to StoryForge and `/api/session` reports `authenticated: true`.
6. Test from a separate non-owner GitHub account in a controlled session; it must be denied and must not create an owner session.
7. Verify logout revokes the session and subsequent protected API requests return `401`.

## 4. Safety gates

- Use synthetic test novels only; do not import Production novels, backups, or personal writing into Staging.
- Do not copy Production OAuth credentials, Worker secrets, Telegram backup tokens, or production data into Staging.
- Do not alter Production OAuth callback URLs, Worker variables, D1 migrations, or deployment.
- After OAuth setup, run the staging HTTP smoke test and complete authenticated API, browser, Android tablet, and backup/restore QA before Private Beta.
- Keep the release blocked until evidence records the environment, date, test account role, and result.

## Current implementation behavior

- Login route: `GET /auth/login`
- Callback route: `GET /auth/callback`
- Required bindings: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_OWNER_ID`
- OAuth scope requested: `read:user`
- OAuth state is hashed, expires after 10 minutes, and is consumed once.
- The GitHub access token is used only to verify identity and is discarded after callback.
- Only the configured numeric owner ID is allowed to receive the `owner` role.
