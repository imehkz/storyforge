# STORYFORGE — Implementation Plan

Status: Private beta preparation  
Working branch: `feature/storyforge-studio-80`  
Production deployment: **not authorized**

## Product constraints

- Reproduce the approved Figma design; do not redesign from scratch.
- Thai is the primary UI language. Preserve the Dark Fantasy Literature / Ancient Royal Library visual direction.
- Brand colors: Midnight Navy `#101827`, Antique Gold `#C5A15B`, Old Parchment `#E8D8B8`, Dark Mahogany `#382D29`.
- Never expose secrets in browser code, local storage, repository files, or chat.
- Do not use OpenAI API keys or silently fall back to a paid provider.
- Copilot must run with the authenticated user's own GitHub identity and subscription.
- No paid service, billing activation, production deployment, or merge to `main` without explicit approval.

## Verified current state

- The current web app is a small Node HTTP server serving static files plus a Telegram backup endpoint.
- The current writer, project list, and memories are stored in browser `localStorage`; they are not account-backed, server-synced, or isolated by server-enforced Project IDs.
- The current project list deduplicates by title rather than stable Project ID.
- AI is intentionally disabled.
- The UI previously said “OWNER ONLY”, but no sign-in or owner authorization is implemented. The label has been changed to disclose local-device storage instead of implying an enforced access policy.
- Render configuration no longer contains unused `OPENAI_API_KEY` or `OPENAI_MODEL` entries.

## MVP acceptance criteria

1. **Identity and access**
   - GitHub OAuth sign-in.
   - Owner allowlist enforced on the server, not by a UI label.
   - Secure, HttpOnly, SameSite session cookie; CSRF/state validation; session expiry and logout.
   - Fail closed when OAuth or owner allowlist configuration is absent.
2. **Project foundation**
   - Stable Project ID for every novel.
   - Server-side owner/permission checks on every project-scoped request.
   - All chapters, characters, notes, plot, lore, timeline, and assets belong to a Project ID.
   - Tests prove two projects with overlapping character names cannot read or mutate each other's data.
3. **Writing**
   - Create, rename, archive, restore, and delete projects with confirmation.
   - Create, edit, reorder, and delete chapters.
   - Autosave with visible saved/saving/error states.
   - Chapter history, snapshot, restore, and conflict handling.
   - TXT export as the first verified export format.
4. **Design and accessibility**
   - Implement the Figma dashboard and library structure faithfully.
   - Consolidate design tokens and navigation.
   - Test desktop and tablet layouts; keyboard focus, disabled/loading/error states, contrast, and readable type.
5. **AI (after identity and project isolation)**
   - Use the official `@github/copilot-sdk` package.
   - One SDK client/session per authenticated user; explicitly disable logged-in-user credential fallback.
   - Use only that user's OAuth token and Copilot entitlement. No shared owner token.
   - Scope every prompt to the active project and its approved canon.
6. **Publishing**
   - DOCX, PDF, and EPUB only after structure, Thai typography, images, front matter, TOC, and pagination have test fixtures.

## Data model baseline

- `users`: GitHub identity, role, created/updated timestamps.
- `sessions`: hashed session identifier, user ID, expiry, revocation.
- `oauth_credentials`: encrypted token material and expiry, never returned to the browser.
- `projects`: stable ID, owner ID, title, genre, status, timestamps.
- `chapters`: stable ID, project ID, title, body, ordering, timestamps.
- `project_memories`: stable ID, project ID, memory type, content, version.
- `snapshots`: stable ID, project ID, resource type/ID, immutable content, created time.
- Future modules (characters, relationships, plot, world, timeline, notes, illustrations, covers) must all include project ID and server-enforced ownership.

## Delivery sequence

- P0 — Requirements, owner-only authentication design, data model, project-isolation contract, save/version/recovery contract.
- P1 — Database and storage decision with verified free-tier limits and no billing activation; authentication and permissions; project CRUD; chapter editor and autosave.
- P2 — Figma-matched Dashboard and Library; Character Studio, Relationship Map, Plot, World, Timeline, Notes.
- P3 — Project-scoped Copilot assistant and approval workflow.
- P4 — Illustration/Cover Studio and DOCX/PDF/EPUB export.
- P5 — Accessibility, responsive, security, backup/restore, performance, and end-to-end QA.

## First end-to-end acceptance test

Create a novel → add a chapter → write text → save → sign out/in → restore a previous version → export text. Repeat with a second project containing duplicate character names and verify strict isolation.

## Current known blockers

- No authentication or server-side owner allowlist.
- No database or persistent user/project storage.
- Current browser storage is device-local and can be lost with browser data.
- No automated test suite is currently confirmed.
- Copilot OAuth app credentials and callback configuration have not been provisioned.
- Hosting/database pricing and persistent-storage limits must be verified before selecting infrastructure.
