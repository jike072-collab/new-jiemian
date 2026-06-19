# Parallel Line B Scope

## Purpose

Parallel line B owns the backend-only authentication, account, New API integration, quota, usage, and billing-sandbox workstream.

This line is intentionally isolated from the main workspace UI rebuild. Its first goal is to create a safe Git and documentation baseline before any authentication research, New API deployment, or business code is written.

## Parallel Line B Owns

- New API official capability and security research.
- Independent New API test deployment planning and verification.
- Server-side BFF client boundaries for New API access.
- Local project user to New API user mapping.
- Login, registration, and secure session backend design and implementation.
- Quota, usage, and audit log adaptation.
- Recharge order and payment sandbox planning and integration.
- API contracts needed by later login and registration UI work.

## Main Line A Owns

- The public workbench surface.
- Frontend shell, header, sidebar, root workspace layout, and official navigation.
- Shared public UI components.
- Visual design, responsive behavior, and module 3 screenshot verification.
- Login and registration page visuals.
- Admin visual surfaces.

## Explicit Non-Goals For B01

- Do not research authentication behavior.
- Do not deploy or configure New API.
- Do not write business code.
- Do not add dependencies.
- Do not modify runtime configuration.

## Required Integration Target

Every module in this line must merge into `integration/auth-newapi` through its own pull request. The final handoff may only create a Draft PR from `integration/auth-newapi` to `develop`; it must not merge into `develop` automatically.
