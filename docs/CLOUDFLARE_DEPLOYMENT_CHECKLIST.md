# STORYFORGE — Cloudflare Setup Checklist

This is an owner-operated checklist. Repository changes do not create a Cloudflare account, D1 database, OAuth app, secrets, or deployment.

## Before starting

- [ ] Sign in to the Cloudflare account that will own StoryForge.
- [ ] Confirm the account dashboard shows the Free plan; do not select an upgrade.
- [ ] Keep the first deployment on the provider hostname (.workers.dev) if available. A custom domain may require a separate purchase.
- [ ] Do not enter payment details or enable paid add-ons for this setup.

## Create the D1 database

From the repository root, after installing Node.js and Wrangler locally:

1. Copy cloudflare/wrangler.toml.example to cloudflare/wrangler.toml.
2. Use only the staging configuration: name storyforge-staging and database_name storyforge-staging. A staging D1 and Worker have already been provisioned in the connected Cloudflare account; do not create or target a database named storyforge from this checklist.
3. Confirm the staging database ID in Cloudflare and place only that ID in the local staging wrangler.toml..
4. Apply migrations locally first: npx wrangler d1 migrations apply storyforge-staging --local
5. Run the schema/security checks from the repository root: python3 tests/check_d1_schema.py and python3 tests/check_worker_contract.py.
6. Run JavaScript/export checks: node --input-type=module --check < cloudflare/worker.js, node --check public/app.js, and node tests/check_exports.mjs
7. The connected account's isolated storyforge-staging D1 already has migrations 0001–0012 applied and schema-verified. Do not re-run them on the existing production storyforge database. Any future migration must be applied only to staging first, after verifying the database ID and taking a staging backup.

Do not commit cloudflare/wrangler.toml; it contains account-specific resource identifiers. The example file is safe to commit.

## Configure Worker secrets

Do not put secrets in source files, Wrangler vars, frontend code, or chat. Configure sensitive values with Wrangler's secret mechanism. Required values are the GitHub OAuth client secret and owner GitHub numeric ID; optional Telegram backup requires its own secret, bot token, and chat ID. The current identity OAuth flow discards the GitHub access token, so no token-encryption key is required by this implementation.

The Worker now implements owner-only GitHub OAuth and project/chapter/module APIs. The browser editor source is connected to those APIs for cloud projects, chapters, autosave, snapshots, and studio modules, while retaining local recovery drafts. These paths cannot be exercised until Worker/D1/OAuth are configured. Do not deploy as a finished writing app before end-to-end tests.

## Staging-first migration safety

Read-only inspection on 23 November 2026 found that the production `storyforge` D1 database has only migrations `0001`–`0003` recorded as applied and its Worker is an earlier build. A separate `storyforge-staging` D1 and Worker now exist; staging migrations `0001`–`0012` are applied and verified. The staging Worker serves the branch frontend files, but does not yet have a separate OAuth configuration/owner allowlist.

Therefore:
- Do not run `wrangler d1 migrations apply storyforge --remote` against the existing production binding.
- Keep the existing storyforge-staging D1/Worker isolated and do not attach production novel data.
- Configure a separate staging OAuth application and secrets, then verify authenticated API flows and run browser/device acceptance.
- Keep production unchanged until the owner reviews the staging evidence and explicitly approves a separate production migration and deployment plan.

## Release gates

- [ ] OAuth state is random, hashed, expiring, and single-use.
- [ ] Owner allowlist is enforced server-side and fails closed.
- [ ] Sessions are hashed, Secure/HttpOnly/SameSite, expiring, and revocable.
- [ ] CSRF validation protects every state-changing request.
- [ ] Every project query verifies session owner and project owner.
- [ ] Cross-project isolation tests pass, including same-named characters in different novels.
- [ ] Autosave, conflict handling, snapshots, restore, export, and encrypted independent backups are tested.
- [ ] No secrets or local Wrangler configuration are tracked by Git.
- [ ] Production deployment is explicitly approved by the owner.

## Current state

The staging Worker now serves embedded branch frontend assets and the branch API source using only the staging D1 binding. Staging OAuth/owner allowlist and authenticated browser testing remain outstanding. Production remains on the earlier Worker build. Copilot is not hosted on Workers. This checklist does not authorize paid runtime or shared Copilot credentials.


## Updated runtime setup

The current Worker requires D1 and these runtime values before owner login can work:
- GitHub OAuth App client ID and client secret.
- The owner's numeric GitHub user ID as the allowlist.
- Optional Telegram backup secret, bot token, and chat ID.

Set the GitHub OAuth App callback URL to the deployed origin plus `/auth/callback`. Store sensitive values with Wrangler secrets; never add them to source files or chat. The Worker and browser editor source now implement the listed authentication and API workflows, but cloud operation remains unavailable until the owner configures and deploys D1, OAuth, and Worker secrets. Do not treat the login control alone as proof that the live service is configured.

Before any production deployment, run the repository's GitHub Actions checks, finish staging OAuth and live API/browser/device tests, complete an independent backup/restore drill, and obtain explicit owner approval. The existing staging Worker deployment does not authorize production changes.
