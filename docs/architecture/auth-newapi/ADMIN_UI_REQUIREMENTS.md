# Admin UI Requirements

## Ownership

Main line A owns admin visual pages. Line B provides backend foundations and documents the missing admin API work.

The existing `src/app/api/admin/providers/route.ts` still uses the old `x-admin-password` provider-admin gate. That is not the B09 project admin session and must not be expanded into the new customer account admin surface.

## Required Admin Authority

Future admin UI must use:

- local project account `role: admin`;
- B09 project HttpOnly session;
- server-only BFF calls to New API;
- stable backend error codes.

It must not use:

- New API browser session;
- New API UI;
- New API admin token in the browser;
- provider `x-admin-password` as customer-account admin identity;
- direct database edits from the UI.

## Required Admin Views

| View | Purpose | Backend status |
| --- | --- | --- |
| Users | Search local accounts and show status/role. | Needs admin API follow-up. |
| New API mappings | Show `pending`, `active`, `failed`, `disabled`, `orphaned`, `repair_required`. | Repository exists; admin API follow-up needed. |
| Mapping repair | Retry repairable failures and mark manual review. | Service logic exists; admin command/API follow-up needed. |
| Quota read-only | Show New API quota and used quota for a mapped user. | B10 user APIs exist; admin read API follow-up needed. |
| Usage | Show local audit and upstream New API logs by user/task. | B10 service exists; admin read API follow-up needed. |
| Orders | Show sandbox orders and statuses. | B11 repository exists; list/admin API follow-up needed. |
| Review queue | Show orders in `review`. | B11 reconciliation exists; admin API follow-up needed. |
| Reconciliation | Run or schedule conservative reconciliation. | Script/service exists; admin API follow-up needed. |
| Channel config | Show enabled sandbox channels. | Public config route exists; admin config write is not implemented. |

## Review And Repair Rules

- Do not automatically delete New API users when mapping state is uncertain.
- Do not apply quota twice.
- Do not create local balance adjustments to hide New API failure.
- Do not mark an order `paid` unless verified payment and quota credit both completed.
- Do not auto-refund without verified provider status and production policy.
- Record every repair action with local user ID, New API user ID, order ID when applicable, reason, operator, and timestamp.

## Required States

Admin UI must expose these states instead of collapsing them:

- account: `active`, `disabled`, `verification_required`;
- mapping: `pending`, `active`, `failed`, `disabled`, `orphaned`, `repair_required`;
- order: `pending`, `processing`, `paid`, `failed`, `cancelled`, `review`, `refunded`;
- quota: available, insufficient, unavailable;
- usage: local audit available, upstream unavailable, mapping pending.

## Production Guardrails

- Production payment controls must remain hidden until the production checklist is approved.
- Sandbox payment must be labeled as sandbox/test.
- Admin pages must not copy New API UI or branding.
- Admin pages must not expose internal base URLs, access tokens, webhook secrets, database DSNs, Redis URLs, or raw upstream error bodies.
