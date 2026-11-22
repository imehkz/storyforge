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
5. Run the schema check from the repository root: python3 tests/check_d1_schema.py
6. Only after reviewing the local result, apply migrations to remote D1: npx wrangler d1 migrations apply storyforge --remote

Do not commit cloudflare/wrangler.toml; it contains account-specific resource identifiers. The example file is safe to commit.

## Configure Worker secrets

Do not put secrets in source files, Wrangler vars, frontend code, or chat. Configure secrets with Wrangler's secret mechanism only after the OAuth flow is implemented and reviewed. Future values include the GitHub OAuth client secret, owner GitHub numeric ID, and strong encryption/session secrets.

The current Worker intentionally does not implement login or project APIs. Do not deploy it as a finished multi-user app.

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

The Worker scaffold only serves static assets and a health endpoint; other API routes return 503. The browser app still stores manuscript data locally. Copilot is not hosted on Workers. This checklist does not authorize paid runtime or shared Copilot credentials.
