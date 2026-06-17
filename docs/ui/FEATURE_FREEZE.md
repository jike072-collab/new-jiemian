# FEATURE_FREEZE

## Scope

This document freezes the current observable product surface before any UI rebuild.
The frozen object is the current workspace state, not a preferred future state.

## Must Keep

- Login: current `/login` entry and flow surface.
- Registration: preserve as an account-facing capability when present in the current workspace; if absent, record it as absent without adding it in module 1.
- Account entry: current top-level account/login access.
- Image generation, video generation, image upscale, video upscale, and library.
- Admin providers configuration.
- Existing backend/API routes that support the current tools.

## Explicitly Not Added

- OAuth extensions.
- Subscription extensions.
- Upgrade/paywall extensions.
- Payment and membership expansion.
- Language switcher.
- Marketing landing pages.
- FAQ, pricing copy blocks, and promotional sections.

## Template Carousel

Treat template carousel as audit-dependent.
Only mark it as retained or excluded after checking the current code and freeze evidence.

## Notes

- Current login and account entry behavior are preserved.
- No new business capability is added in module 1.
