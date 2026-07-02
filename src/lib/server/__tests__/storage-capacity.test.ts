import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  isStorageOperationAllowed,
  resolveStorageThresholds,
  storageLevelForUsedPercent,
  type StorageProtectionLevel,
} from "../../storage-capacity-policy";
import {
  StorageCapacityError,
  assertStorageAllows,
  getStorageCapacityStatus,
  resetStorageCapacityCacheForTests,
  storageStatusForPublicHealth,
  type StorageStatProvider,
} from "../storage-capacity";

const defaultThresholds = resolveStorageThresholds({}).thresholds;

describe("storage capacity protection policy", () => {
  test("classifies default thresholds at 69, 70, 80, 85, 90, and 95 percent", () => {
    const cases: Array<[number, StorageProtectionLevel]> = [
      [69, "normal"],
      [70, "warning"],
      [80, "critical"],
      [85, "block-video"],
      [90, "block-media"],
      [95, "emergency"],
    ];
    for (const [usedPercent, level] of cases) {
      assert.equal(storageLevelForUsedPercent(usedPercent, defaultThresholds), level);
    }
  });

  test("threshold env can only lower values and must remain increasing", () => {
    const lowered = resolveStorageThresholds({
      STORAGE_WARNING_PERCENT: "60",
      STORAGE_CRITICAL_PERCENT: "75",
      STORAGE_VIDEO_BLOCK_PERCENT: "82",
      STORAGE_MEDIA_BLOCK_PERCENT: "88",
      STORAGE_EMERGENCY_PERCENT: "94",
    });
    assert.equal(lowered.valid, true);
    assert.deepEqual(lowered.thresholds, {
      warning: 60,
      critical: 75,
      blockVideo: 82,
      blockMedia: 88,
      emergency: 94,
    });

    const invalid = resolveStorageThresholds({
      STORAGE_WARNING_PERCENT: "70",
      STORAGE_CRITICAL_PERCENT: "69",
    });
    assert.equal(invalid.valid, false);
    assert.deepEqual(invalid.thresholds, defaultThresholds);

    const raised = resolveStorageThresholds({
      STORAGE_VIDEO_BLOCK_PERCENT: "86",
    });
    assert.equal(raised.valid, false);
    assert.deepEqual(raised.thresholds, defaultThresholds);
  });

  test("read, download, login, admin checks, and cleanup remain allowed at emergency", () => {
    for (const operation of ["read", "download", "login", "admin-check", "cleanup"] as const) {
      assert.equal(isStorageOperationAllowed("emergency", operation), true);
    }
    assert.equal(isStorageOperationAllowed("emergency", "image-generation"), false);
    assert.equal(isStorageOperationAllowed("block-video", "video-upload"), false);
    assert.equal(isStorageOperationAllowed("block-video", "image-generation"), true);
    assert.equal(isStorageOperationAllowed("block-media", "image-generation"), false);
  });
});

describe("storage capacity filesystem checks", () => {
  test("uses the strictest result when DATA_DIR and UPLOADS_DIR differ", async () => {
    resetStorageCapacityCacheForTests();
    const status = await getStorageCapacityStatus({
      fresh: true,
      statProvider: statSequence([69, 92]),
    });
    assert.equal(status.level, "block-media");
    assert.equal(status.roots[0].level, "normal");
    assert.equal(status.roots[1].level, "block-media");
  });

  test("stat failure fails conservatively and blocks media writes", async () => {
    resetStorageCapacityCacheForTests();
    const status = await getStorageCapacityStatus({
      fresh: true,
      statProvider: async () => {
        const error = new Error("simulated stat failure");
        (error as Error & { code?: string }).code = "EACCES";
        throw error;
      },
    });
    assert.equal(status.level, "unavailable");
    assert.equal(status.ok, false);
    assert.equal(status.needsCleanup, true);

    await assert.rejects(
      () => assertStorageAllows("image-generation", {
        fresh: true,
        statProvider: async () => {
          throw Object.assign(new Error("stat failed"), { code: "EIO" });
        },
      }),
      (error) => error instanceof StorageCapacityError && error.status === 503,
    );
  });

  test("storage protection errors are safe for HTTP diagnostics", async () => {
    await assert.rejects(
      () => assertStorageAllows("video-upload", { fresh: true, statProvider: statSequence([86, 86]) }),
      (error) => {
        assert(error instanceof StorageCapacityError);
        assert.equal(error.status, 507);
        assert.equal(error.publicMessage?.includes("服务器存储空间不足"), true);
        const serialized = JSON.stringify(error.safeDetails);
        assert.equal(serialized.includes(process.cwd()), false);
        assert.equal(serialized.includes("DATA_DIR"), false);
        assert.equal(serialized.includes("UPLOADS_DIR"), false);
        return true;
      },
    );
  });

  test("public health status contains labels and capacity numbers without absolute paths", async () => {
    resetStorageCapacityCacheForTests();
    const status = await getStorageCapacityStatus({
      fresh: true,
      statProvider: statSequence([80, 80]),
    });
    const publicStatus = storageStatusForPublicHealth(status);
    assert.equal(publicStatus.level, "critical");
    assert.equal(publicStatus.needsCleanup, true);
    assert.equal(publicStatus.roots[0].label, "DATA_DIR");
    assert.equal(publicStatus.roots[0].totalBytes, 1000);
    const serialized = JSON.stringify(publicStatus);
    assert.equal(serialized.includes(process.cwd()), false);
    assert.equal(serialized.includes(":\\\\"), false);
  });

  test("short cache avoids repeated stats, but fresh checks bypass cache", async () => {
    resetStorageCapacityCacheForTests();
    let calls = 0;
    const provider: StorageStatProvider = async () => {
      calls += 1;
      return statForUsedPercent(69);
    };
    await getStorageCapacityStatus({ statProvider: provider, fresh: true, cacheTtlMs: 60_000 });
    await getStorageCapacityStatus({ statProvider: provider });
    assert.equal(calls, 2, "cached status should avoid repeated stats for both roots");
    await getStorageCapacityStatus({ statProvider: provider, fresh: true });
    assert.equal(calls, 4, "fresh status should rerun stats for both roots");
  });
});

function statSequence(usedPercents: number[]): StorageStatProvider {
  let index = 0;
  return async () => statForUsedPercent(usedPercents[Math.min(index++, usedPercents.length - 1)]);
}

function statForUsedPercent(usedPercent: number) {
  const totalBlocks = 100;
  const availableBlocks = Math.max(0, totalBlocks - usedPercent);
  return {
    bsize: 10,
    blocks: totalBlocks,
    bavail: availableBlocks,
    bfree: availableBlocks,
  };
}
