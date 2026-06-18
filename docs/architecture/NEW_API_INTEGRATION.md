# NEW_API_INTEGRATION

## References

- [QuantumNous/new-api](https://github.com/QuantumNous/new-api)
- [New API docs](https://docs.newapi.pro/zh/docs)
- [New API API docs](https://docs.newapi.pro/zh/docs/api)
- [New API payment settings](https://docs.newapi.pro/zh/docs/guide/console/settings/payment-settings)

## Boundary

- New API is a future independent deployment.
- This project should call it through the existing backend/BFF layer.
- The frontend must not store admin keys, payment keys, or other sensitive credentials.
- Account, recharge, payment, and reconciliation work belong to later modules.

## Planned Separation

- Module 8: account and recharge pages.
- Module 9: backend payment settings.
- Module 10: API integration, callbacks, and reconciliation.

## Menu Planning

- Account center
- Balance and recharge
- Recharge records
- Logout

## Rules

- Keep payment entry hidden until the later modules define it.
- Do not create dead frontend routes for payment now.
- Use feature flags and visibility controls in the shared registry when the later modules need them.
