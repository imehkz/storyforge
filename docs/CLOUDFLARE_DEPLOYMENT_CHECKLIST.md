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
2. From cloudflare/, run: npx wrangler d1 create storyforge
3. Copy the returned database ID into cloudflare/wrangler.toml.
4. Apply migrations locally first: npx wrangler d1 migrations apply storyforge --local
5. Run the schema/security checks from the repository root: python3 tests/check_d1_schema.py and python3 tests/check_worker_contract.py.
6. Run JavaScript/export checks: node --input-type=module --check < cloudflare/worker.js, node --check public/app.js, and node tests/check_exports.mjs
6. Only after reviewing the local result, apply migrations to remote D1: npx wrangler d1 migrations apply storyforge --remote

Do not commit cloudflare/wrangler.toml; it contains account-specific resource identifiers. The example file is safe to commit.

## Configure Worker secrets

Do not put secrets in source files, Wrangler vars, frontend code, or chat. Configure sensitive values with Wrangler's secret mechanism. Required values are the GitHub OAuth client secret and owner GitHub numeric ID; optional Telegram backup requires its own secret, bot token, and chat ID. The current identity OAuth flow discards the GitHub access token, so no token-encryption key is required by this implementation.

The Worker now implements owner-only GitHub OAuth and project/chapter/module APIs. The browser editor source is connected to those APIs for cloud projects, chapters, autosave, snapshots, and studio modules, while retaining local recovery drafts. These paths cannot be exercised until Worker/D1/OAuth are configured. Do not deploy as a finished writing app before end-to-end tests.

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

The Worker now serves static assets and owner-authenticated APIs. The browser editor has API integration but also retains device-local recovery copies; live cloud operation requires configuration and deployment. Copilot is not hosted on Workers. This checklist does not authorize paid runtime or shared Copilot credentials.


## Updated runtime setup

The current Worker requires D1 and these runtime values before owner login can work:
- GitHub OAuth App client ID and client secret.
- The owner's numeric GitHub user ID as the allowlist.
- Optional Telegram backup secret, bot token, and chat ID.

Set the GitHub OAuth App callback URL to the deployed origin plus `/auth/callback`. Store sensitive values with Wrangler secrets; never add them to source files or chat. The Worker and browser editor source now implement the listed authentication and API workflows, but cloud operation remains unavailable until the owner configures and deploys D1, OAuth, and Worker secrets. Do not treat the login control alone as proof that the live service is configured.

Before deployment, run the repository's GitHub Actions checks and test the Worker with local D1. No resource provisioning or deployment is authorized by this checklist.
