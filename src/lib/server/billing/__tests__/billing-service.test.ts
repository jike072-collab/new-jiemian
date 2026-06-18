import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { applicationQuery, closeApplicationDatabasePool } from "../../database";
import { createMemoryNewApiUserMappingRepository, type NewApiUserMapping } from "../../integrations/new-api";
import { createPostgresNewApiUserMappingRepository } from "../../integrations/new-api/postgres-user-mapping";
import { createDualBillingRepository } from "../persistence";
import { createJsonBillingDualRepairRepository } from "../dual-repair";
import { createMemoryBillingRepository, type BillingRepository } from "../repository";
import { createPostgresBillingRepository } from "../postgres-repository";
import { signSandboxWebhook } from "../sandbox-provider";
import { BillingService, type CreditQuotaInput, type CreditQuotaResult } from "../service";
import { type BillingOrder, type BillingWebhookPayload } from "../types";

const secret = "sandbox-test-secret";
const hasDatabase = Boolean(process.env.APP_DATABASE_URL && process.env.APP_DATABASE_EXPECTED_NAME);
const dbTest = hasDatabase ? test : test.skip;

function mappingSeed(localUserId = "local-user", newApiUserId = "100"): NewApiUserMapping[] {
  const now = "2026-06-18T00:00:00.000Z";
  return [{
    local_user_id: localUserId,
    new_api_user_id: newApiUserId,
    sync_status: "active",
    created_at: now,
    updated_at: now,
    last_sync_at: now,
    last_error_code: null,
    last_error_message: null,
    retry_count: 0,
    version: 2,
    idempotency_key: `register:${localUserId}`,
  }];
}

function failedMappingSeed(localUserId = "local-user"): NewApiUserMapping[] {
  return [{
    ...mappingSeed(localUserId)[0],
    new_api_user_id: null,
    sync_status: "failed",
    last_error_code: "NEW_API_TIMEOUT",
    last_error_message: "timeout",
  }];
}

function withSecret<T>(callback: () => T | Promise<T>) {
  const previous = process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET;
  process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET = secret;
  return Promise.resolve(callback()).finally(() => {
    process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET = previous;
  });
}

function withoutSecret<T>(callback: () => T | Promise<T>) {
  const previous = process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET;
  delete process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET;
  return Promise.resolve(callback()).finally(() => {
    if (previous === undefined) {
      delete process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET;
      return;
    }
    process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET = previous;
  });
}

function service(overrides: {
  mappings?: NewApiUserMapping[];
  creditQuota?: (input: CreditQuotaInput) => Promise<CreditQuotaResult>;
  getProviderStatus?: (order: BillingOrder) => Promise<"pending" | "paid" | "failed" | "cancelled" | "refunded" | "unknown">;
  now?: () => Date;
} = {}) {
  const repository = createMemoryBillingRepository();
  const mappingRepository = createMemoryNewApiUserMappingRepository(overrides.mappings || mappingSeed());
  const creditCalls: CreditQuotaInput[] = [];
  const billing = new BillingService({
    repository,
    mappingRepository,
    getProviderStatus: overrides.getProviderStatus,
    now: overrides.now || (() => new Date("2026-06-18T00:00:00.000Z")),
    creditQuota: overrides.creditQuota || (async (input) => {
      creditCalls.push(input);
      return { ok: true, providerCreditId: `credit:${input.orderId}` };
    }),
  });
  return { billing, repository, mappingRepository, creditCalls };
}

async function createOrder(harness = service(), input: Partial<Parameters<BillingService["createOrder"]>[0]> = {}) {
  const result = await harness.billing.createOrder({
    localUserId: "local-user",
    channel: "sandbox_alipay",
    currency: "CNY",
    requestedAmount: 1000,
    idempotencyKey: "idem-order",
    ...input,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("order creation failed");
  return result.order;
}

function payloadFor(order: BillingOrder, overrides: Partial<BillingWebhookPayload> = {}): BillingWebhookPayload {
  return {
    event_id: "evt-1",
    event_type: "payment_succeeded",
    order_id: order.order_id,
    provider_order_id: order.provider_order_id,
    local_user_id: order.local_user_id,
    new_api_user_id: order.new_api_user_id,
    channel: order.channel,
    currency: order.currency,
    paid_amount: order.requested_amount,
    occurred_at: "2026-06-18T00:01:00.000Z",
    ...overrides,
  };
}

async function signedWebhook(billing: BillingService, payload: BillingWebhookPayload, timestamp = "1781740800") {
  const rawBody = JSON.stringify(payload);
  return billing.handleSandboxWebhook({
    rawBody,
    timestamp,
    signature: signSandboxWebhook({ secret, timestamp, body: rawBody }),
    now: new Date("2026-06-18T00:00:00.000Z"),
  });
}

test("returns sandbox payment channel configuration for the future UI", () => {
  const channels = service().billing.listPaymentChannels();
  assert(channels.length >= 2);
  assert.equal(channels[0].enabled, true);
  assert.equal(channels[0].currency, "CNY");
  assert.equal(typeof channels[0].display_color, "string");
  assert.equal(channels[0].fixed_amounts.includes(1000), true);
  assert.equal("quota_units_per_minor_unit" in channels[0], false);
  assert.equal(typeof channels[0].estimated_quota_units_per_minor_unit, "number");
});

test("creates a pending order with server-side discount and quota calculation", async () => {
  const harness = service();
  const order = await createOrder(harness, { requestedAmount: 3000 });

  assert.equal(order.status, "pending");
  assert.equal(order.local_user_id, "local-user");
  assert.equal(order.new_api_user_id, "100");
  assert.equal(order.requested_amount, 3000);
  assert.equal(order.credited_quota, 31500);
  assert.equal(order.paid_amount, 0);
  assert.equal(order.last_error, null);
});

test("creates orders idempotently and rejects invalid amount or inactive mapping", async () => {
  const harness = service();
  const first = await createOrder(harness);
  const second = await harness.billing.createOrder({
    localUserId: "local-user",
    channel: "sandbox_alipay",
    currency: "CNY",
    requestedAmount: 1000,
    idempotencyKey: "idem-order",
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.status, 200);
  assert.equal(second.order.order_id, first.order_id);

  const invalid = await harness.billing.createOrder({
    localUserId: "local-user",
    channel: "sandbox_alipay",
    currency: "CNY",
    requestedAmount: 1,
    idempotencyKey: "idem-invalid",
  });
  assert.equal(invalid.ok, false);
  if (invalid.ok) return;
  assert.equal(invalid.code, "invalid_billing_request");

  const pending = await service({ mappings: failedMappingSeed() }).billing.createOrder({
    localUserId: "local-user",
    channel: "sandbox_alipay",
    currency: "CNY",
    requestedAmount: 1000,
    idempotencyKey: "idem-pending",
  });
  assert.equal(pending.ok, false);
  if (pending.ok) return;
  assert.equal(pending.code, "mapping_pending");
});

test("rejects missing webhook secret and invalid signatures without paying the order", async () => {
  const harness = service();
  const order = await createOrder(harness);
  const rawBody = JSON.stringify(payloadFor(order));

  const missingSecret = await withoutSecret(() => {
    return harness.billing.handleSandboxWebhook({
      rawBody,
      timestamp: "1781712000",
      signature: "0".repeat(64),
      now: new Date("2026-06-18T00:00:00.000Z"),
    });
  });
  assert.equal(missingSecret.ok, false);
  if (missingSecret.ok) return;
  assert.equal(missingSecret.code, "billing_disabled");

  await withSecret(async () => {
    const invalid = await harness.billing.handleSandboxWebhook({
      rawBody,
      timestamp: "1781740800",
      signature: "1".repeat(64),
      now: new Date("2026-06-18T00:00:00.000Z"),
    });
    assert.equal(invalid.ok, false);
    if (invalid.ok) return;
    assert.equal(invalid.code, "payment_invalid_signature");
  });

  assert.equal((await harness.repository.getOrder(order.order_id))?.status, "pending");
});

test("rejects delayed replay webhooks", async () => {
  const harness = service();
  const order = await createOrder(harness);
  await withSecret(async () => {
    const delayed = await signedWebhook(harness.billing, payloadFor(order), "1");
    assert.equal(delayed.ok, false);
    if (delayed.ok) return;
    assert.equal(delayed.code, "payment_replay_detected");
  });
});

test("credits New API quota once for duplicate and concurrent webhooks", async () => {
  const harness = service();
  const order = await createOrder(harness);
  await withSecret(async () => {
    const first = await signedWebhook(harness.billing, payloadFor(order));
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.action, "credited");
    assert.equal(first.order.status, "paid");

    const duplicate = await signedWebhook(harness.billing, payloadFor(order));
    assert.equal(duplicate.ok, true);
    if (!duplicate.ok) return;
    assert.equal(duplicate.action, "idempotent");

    const concurrent = await Promise.all(Array.from({ length: 3 }, () => (
      signedWebhook(harness.billing, payloadFor(order, { event_id: "evt-concurrent" }))
    )));
    assert.equal(concurrent.every((result) => result.ok), true);
  });

  assert.equal(harness.creditCalls.length, 1);
  assert.equal(harness.creditCalls[0].quotaUnits, 10000);
  assert.equal((await harness.repository.getOrder(order.order_id))?.status, "paid");
});

test("serializes concurrent paid webhooks with distinct event ids", async () => {
  let releaseCredit: () => void = () => undefined;
  const creditGate = new Promise<void>((resolve) => {
    releaseCredit = resolve;
  });
  const creditCalls: CreditQuotaInput[] = [];
  const harness = service({
    creditQuota: async (input) => {
      creditCalls.push(input);
      await creditGate;
      return { ok: true, providerCreditId: `credit:${input.orderId}` };
    },
  });
  const order = await createOrder(harness);

  await withSecret(async () => {
    const requests = Array.from({ length: 3 }, (_, index) => (
      signedWebhook(harness.billing, payloadFor(order, { event_id: `evt-distinct-${index}` }))
    ));
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    releaseCredit();

    const results = await Promise.all(requests);
    assert.equal(results.every((result) => result.ok), true);
    assert.equal(results.filter((result) => result.ok && result.action === "credited").length, 1);
  });

  assert.equal(creditCalls.length, 1);
  assert.equal((await harness.repository.getOrder(order.order_id))?.status, "paid");
});

test("puts amount, user, currency, and channel tampering into review", async () => {
  const cases: Array<[string, Partial<BillingWebhookPayload>]> = [
    ["amount", { paid_amount: 999 }],
    ["user", { local_user_id: "attacker" }],
    ["currency", { currency: "USD" as never }],
    ["channel", { channel: "sandbox_other" }],
  ];

  for (const [name, override] of cases) {
    const harness = service();
    const order = await createOrder(harness, { idempotencyKey: `idem-${name}` });
    await withSecret(async () => {
      const result = await signedWebhook(harness.billing, payloadFor(order, { event_id: `evt-${name}`, ...override }));
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.action, "review");
      assert.equal(result.order.status, "review");
    });
    assert.equal(harness.creditCalls.length, 0);
  }
});

test("puts out-of-order callbacks into review", async () => {
  const harness = service();
  const order = await createOrder(harness);
  await withSecret(async () => {
    const cancelled = await signedWebhook(harness.billing, payloadFor(order, {
      event_id: "evt-cancel",
      event_type: "payment_cancelled",
      paid_amount: 0,
    }));
    assert.equal(cancelled.ok, true);
    if (!cancelled.ok) return;
    assert.equal(cancelled.order.status, "cancelled");

    const latePaid = await signedWebhook(harness.billing, payloadFor(order, { event_id: "evt-late-paid" }));
    assert.equal(latePaid.ok, true);
    if (!latePaid.ok) return;
    assert.equal(latePaid.action, "review");
    assert.equal(latePaid.order.status, "review");
  });
});

test("payment success with New API credit failure enters review and can be reconciled", async () => {
  let fail = true;
  const harness = service({
    creditQuota: async (input) => {
      if (fail) return { ok: false, code: "NEW_API_DOWN", message: "Authorization=Bearer secret-token", retryable: true };
      harness.creditCalls.push(input);
      return { ok: true, providerCreditId: `credit:${input.orderId}` };
    },
  });
  const order = await createOrder(harness);
  await withSecret(async () => {
    const failed = await signedWebhook(harness.billing, payloadFor(order));
    assert.equal(failed.ok, true);
    if (!failed.ok) return;
    assert.equal(failed.action, "review");
    assert.equal(failed.order.status, "review");
    assert.equal(failed.order.last_error?.includes("secret-token"), false);
  });

  fail = false;
  const result = await harness.billing.reconcile();
  assert.equal(result.checked >= 1, true);
  assert.equal(harness.creditCalls.length, 1);
  assert.equal((await harness.repository.getOrder(order.order_id))?.status, "paid");
});

test("refund webhook marks refunded without adding quota again", async () => {
  const harness = service();
  const order = await createOrder(harness);
  await withSecret(async () => {
    await signedWebhook(harness.billing, payloadFor(order));
    const refund = await signedWebhook(harness.billing, payloadFor(order, {
      event_id: "evt-refund",
      event_type: "payment_refunded",
    }));
    assert.equal(refund.ok, true);
    if (!refund.ok) return;
    assert.equal(refund.order.status, "refunded");
  });
  assert.equal(harness.creditCalls.length, 1);
});

test("users cannot read other users' orders through service boundary", async () => {
  const harness = service();
  const order = await createOrder(harness);
  const own = await harness.billing.getOrderForUser("local-user", order.order_id);
  const other = await harness.billing.getOrderForUser("other-user", order.order_id);

  assert.equal(own.ok, true);
  assert.equal(other.ok, false);
  if (other.ok) return;
  assert.equal(other.code, "payment_not_found");
});

test("lists current user orders with pagination and status filtering", async () => {
  const repository = createMemoryBillingRepository();
  const mappingRepository = createMemoryNewApiUserMappingRepository([
    ...mappingSeed("local-user", "100"),
    ...mappingSeed("other-user", "200"),
  ]);
  const creditCalls: CreditQuotaInput[] = [];
  const billing = new BillingService({
    repository,
    mappingRepository,
    now: () => new Date("2026-06-18T00:00:00.000Z"),
    creditQuota: async (input) => {
      creditCalls.push(input);
      return { ok: true, providerCreditId: `credit:${input.orderId}` };
    },
  });
  const harness = { billing, repository, mappingRepository, creditCalls };
  await createOrder(harness, { idempotencyKey: "idem-1" });
  const paid = await createOrder(harness, { idempotencyKey: "idem-2" });
  const other = await billing.createOrder({
    localUserId: "other-user",
    channel: "sandbox_alipay",
    currency: "CNY",
    requestedAmount: 1000,
    idempotencyKey: "idem-other",
  });
  assert.equal(other.ok, true);
  await harness.repository.updateOrder(paid.order_id, {
    status: "paid",
    updated_at: "2026-06-18T00:02:00.000Z",
    paid_amount: paid.requested_amount,
    paid_at: "2026-06-18T00:02:00.000Z",
    quota_credit_applied_at: "2026-06-18T00:02:00.000Z",
  }, paid.version);

  const firstPage = await harness.billing.listOrdersForUser({ localUserId: "local-user", page: 1, pageSize: 1 });
  assert.equal(firstPage.ok, true);
  if (!firstPage.ok) return;
  assert.equal(firstPage.orders.length, 1);
  assert.equal(firstPage.total, 2);
  assert.equal(firstPage.has_more, true);
  assert.equal(firstPage.orders.some((order) => order.local_user_id !== "local-user"), false);

  const paidOnly = await harness.billing.listOrdersForUser({
    localUserId: "local-user",
    statuses: ["paid"],
    page: 1,
    pageSize: 10,
  });
  assert.equal(paidOnly.ok, true);
  if (!paidOnly.ok) return;
  assert.equal(paidOnly.orders.length, 1);
  assert.equal(paidOnly.orders[0].status, "paid");
});

function unavailableBillingRepository(): BillingRepository {
  const fail = () => {
    throw new Error("connect ECONNREFUSED postgresql://user:password@10.0.0.5:5432/app?token=secret-token");
  };
  return {
    getOrder: async () => fail(),
    getOrderByIdempotencyKey: async () => fail(),
    getOrderByProviderOrderId: async () => fail(),
    createOrder: async () => fail(),
    updateOrder: async () => fail(),
    listOrders: async () => fail(),
    listOrdersPage: async () => fail(),
    appendWebhookEvent: async () => fail(),
    appendAudit: async () => fail(),
    listAuditEvents: async () => fail(),
  };
}

async function resetBillingTables() {
  await applicationQuery("truncate table audit_events, task_billing_records, usage_records, billing_idempotency_keys, billing_webhook_events, billing_orders, new_api_user_mappings, auth_sessions, app_users restart identity cascade");
}

async function seedPostgresUser(input: { localUserId: string; email: string; username: string }) {
  await applicationQuery(`
    insert into app_users(
      local_user_id, email, username, display_name, password_hash, status, role,
      session_version, created_at, updated_at, last_login_at
    ) values ($1,$2,$3,$3,$4,'active','user',1,$5,$5,null)
  `, [
    input.localUserId,
    input.email,
    input.username,
    "scrypt$v=1$n=16384$r=8$p=1$len=64$c2FsdA$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "2026-06-18T00:00:00.000Z",
  ]);
}

async function seedPostgresMapping(localUserId: string, newApiUserId: string) {
  const mappingRepository = createPostgresNewApiUserMappingRepository();
  await mappingRepository.createPending({
    localUserId,
    idempotencyKey: `register:${localUserId}`,
    now: new Date("2026-06-18T00:00:00.000Z"),
  });
  await mappingRepository.markActive({
    localUserId,
    newApiUserId,
    now: new Date("2026-06-18T00:00:00.000Z"),
  });
}

test("dual billing persistence failures do not break JSON order and webhook flow", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "billing-dual-repair-"));
  const previousRepairPath = process.env.APP_BILLING_DUAL_REPAIR_STORE_PATH;
  const repairPath = join(dataDir, "billing-dual-repair-records.json");
  const repair = createJsonBillingDualRepairRepository(repairPath);
  const jsonRepository = createMemoryBillingRepository();
  const warnings: string[] = [];
  const originalWarn = console.warn;
  const creditCalls: CreditQuotaInput[] = [];
  try {
    process.env.APP_BILLING_DUAL_REPAIR_STORE_PATH = repairPath;
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    const harness = service();
    const billing = new BillingService({
      repository: createDualBillingRepository(jsonRepository, unavailableBillingRepository()),
      mappingRepository: harness.mappingRepository,
      creditQuota: async (input) => {
        creditCalls.push(input);
        return { ok: true, providerCreditId: `credit:${input.orderId}` };
      },
      now: () => new Date("2026-06-18T00:00:00.000Z"),
    });
    const orderResult = await billing.createOrder({
      localUserId: "local-user",
      channel: "sandbox_alipay",
      currency: "CNY",
      requestedAmount: 1000,
      idempotencyKey: "dual-idem",
    });
    assert.equal(orderResult.ok, true);
    if (!orderResult.ok) return;

    await withSecret(async () => {
      const webhook = await signedWebhook(billing, payloadFor(orderResult.order));
      assert.equal(webhook.ok, true);
      if (!webhook.ok) return;
      assert.equal(webhook.action, "credited");
      assert.equal(webhook.order.status, "paid");
    });

    const own = await billing.getOrderForUser("local-user", orderResult.order.order_id);
    assert.equal(own.ok, true);
    assert.equal(creditCalls.length, 1);
    const records = await repair.list("pending");
    assert.equal(records.some((record) => record.scope === "billing_order"), true);
    assert.equal(records.some((record) => record.scope === "billing_webhook_event"), true);

    const serialized = `${JSON.stringify(records)}\n${warnings.join("\n")}`;
    for (const leaked of ["secret-token", "10.0.0.5", "postgresql://user:password", "password@", "token=secret"]) {
      assert.equal(serialized.includes(leaked), false, `dual repair output leaked ${leaked}`);
    }
  } finally {
    console.warn = originalWarn;
    if (previousRepairPath === undefined) delete process.env.APP_BILLING_DUAL_REPAIR_STORE_PATH;
    else process.env.APP_BILLING_DUAL_REPAIR_STORE_PATH = previousRepairPath;
    await rm(dataDir, { recursive: true, force: true });
  }
});

dbTest("postgres billing repository supports orders, filtering, idempotent webhooks, and review states", async () => {
  await resetBillingTables();
  const localUserId = "11111111-1111-4111-8111-111111111111";
  const otherUserId = "22222222-2222-4222-8222-222222222222";
  await seedPostgresUser({ localUserId, email: "billing-pg@example.com", username: "billing_pg" });
  await seedPostgresUser({ localUserId: otherUserId, email: "billing-other@example.com", username: "billing_other" });
  await seedPostgresMapping(localUserId, "9001");
  await seedPostgresMapping(otherUserId, "9002");

  const creditCalls: CreditQuotaInput[] = [];
  const billing = new BillingService({
    repository: createPostgresBillingRepository(),
    mappingRepository: createPostgresNewApiUserMappingRepository(),
    now: () => new Date("2026-06-18T00:00:00.000Z"),
    creditQuota: async (input) => {
      creditCalls.push(input);
      return { ok: true, providerCreditId: `credit:${input.orderId}` };
    },
  });
  const first = await billing.createOrder({
    localUserId,
    channel: "sandbox_alipay",
    currency: "CNY",
    requestedAmount: 1000,
    idempotencyKey: "pg-idem-1",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const other = await billing.createOrder({
    localUserId: otherUserId,
    channel: "sandbox_alipay",
    currency: "CNY",
    requestedAmount: 1000,
    idempotencyKey: "pg-other",
  });
  assert.equal(other.ok, true);

  await withSecret(async () => {
    const paid = await signedWebhook(billing, payloadFor(first.order));
    assert.equal(paid.ok, true);
    if (!paid.ok) return;
    assert.equal(paid.action, "credited");
    const duplicate = await signedWebhook(billing, payloadFor(first.order));
    assert.equal(duplicate.ok, true);
    if (!duplicate.ok) return;
    assert.equal(duplicate.action, "idempotent");
  });
  assert.equal(creditCalls.length, 1);

  const second = await billing.createOrder({
    localUserId,
    channel: "sandbox_alipay",
    currency: "CNY",
    requestedAmount: 1000,
    idempotencyKey: "pg-idem-2",
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  await withSecret(async () => {
    const tampered = await signedWebhook(billing, payloadFor(second.order, {
      event_id: "evt-pg-tampered",
      local_user_id: otherUserId,
    }));
    assert.equal(tampered.ok, true);
    if (!tampered.ok) return;
    assert.equal(tampered.action, "review");
    assert.equal(tampered.order.status, "review");
  });

  const list = await billing.listOrdersForUser({ localUserId, statuses: ["paid"], page: 1, pageSize: 10 });
  assert.equal(list.ok, true);
  if (!list.ok) return;
  assert.equal(list.orders.length, 1);
  assert.equal(list.orders[0].status, "paid");
  assert.equal(list.orders.some((order) => order.local_user_id !== localUserId), false);

  const forbidden = await billing.getOrderForUser(otherUserId, first.order.order_id);
  assert.equal(forbidden.ok, false);
  if (forbidden.ok) return;
  assert.equal(forbidden.code, "payment_not_found");

  const idempotencyRows = await applicationQuery<{ count: string }>(
    "select count(*)::text as count from billing_idempotency_keys where local_user_id = $1",
    [localUserId],
  );
  assert.equal(Number(idempotencyRows.rows[0]?.count || 0), 2);
});

dbTest("postgres billing mode does not read JSON order storage", async () => {
  await resetBillingTables();
  const localUserId = "33333333-3333-4333-8333-333333333333";
  await seedPostgresUser({ localUserId, email: "billing-pg-only@example.com", username: "billing_pg_only" });
  await seedPostgresMapping(localUserId, "9101");
  const billing = new BillingService({
    repository: createPostgresBillingRepository(),
    mappingRepository: createPostgresNewApiUserMappingRepository(),
    now: () => new Date("2026-06-18T00:00:00.000Z"),
    creditQuota: async (input) => ({ ok: true, providerCreditId: `credit:${input.orderId}` }),
  });
  const created = await billing.createOrder({
    localUserId,
    channel: "sandbox_alipay",
    currency: "CNY",
    requestedAmount: 1000,
    idempotencyKey: "pg-only-idem",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const jsonOnlyRepository = createMemoryBillingRepository();
  await jsonOnlyRepository.createOrder({
    ...created.order,
    order_id: "bo_json_only",
    provider_order_id: "sandbox_bo_json_only",
    idempotency_key: "json-only",
  });
  const found = await billing.getOrderForUser(localUserId, "bo_json_only");
  assert.equal(found.ok, false);
  if (found.ok) return;
  assert.equal(found.code, "payment_not_found");
});

test.after(async () => {
  await closeApplicationDatabasePool();
});
