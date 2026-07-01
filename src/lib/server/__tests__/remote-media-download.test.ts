import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { test } from "node:test";

import { libraryStorageInternalsForTests, storeBytes, storeDataUrl } from "../library";
import { remoteMediaDownloadInternalsForTests, storeRemoteUrlStreamed } from "../remote-media-download";

type TestHandler = (request: IncomingMessage, response: ServerResponse) => void;
type TestLookup = NonNullable<Parameters<typeof storeRemoteUrlStreamed>[1]["lookupImpl"]>;

async function withServer(handler: TestHandler, callback: (baseUrl: string) => Promise<void>) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    await callback(`http://mock-provider.test:${address.port}`);
  } finally {
    await closeServer(server);
  }
}

async function closeServer(server: Server) {
  server.close();
  await once(server, "close").catch(() => undefined);
}

function lookupPublicToLocal(): TestLookup {
  const lookup = async (hostname: string) => {
    if (["mock-provider.test", "media.example.test", "cdn.media.example.test"].includes(hostname)) {
      return [{ address: "93.184.216.34", family: 4 as const }];
    }
    if (hostname === "loopback.test") return [{ address: "127.0.0.1", family: 4 as const }];
    if (hostname === "private.test") return [{ address: "192.168.1.10", family: 4 as const }];
    if (hostname === "metadata.test") return [{ address: "169.254.169.254", family: 4 as const }];
    if (hostname === "evil.test") return [{ address: "93.184.216.34", family: 4 as const }];
    return [{ address: "93.184.216.34", family: 4 as const }];
  };
  return lookup as unknown as TestLookup;
}

function localFetch() {
  return (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(input instanceof URL ? input.toString() : String(input));
    if (["mock-provider.test", "media.example.test", "cdn.media.example.test"].includes(url.hostname)) {
      url.hostname = "127.0.0.1";
      return fetch(url, init);
    }
    return fetch(input, init);
  };
}

function fakeSmallContentLengthFetch(): typeof fetch {
  const fetchImpl = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.alloc(1024 * 1024));
      controller.enqueue(Buffer.alloc(1024 * 1024));
      controller.enqueue(Buffer.alloc(1024 * 1024));
      controller.close();
    },
  }), {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": "1",
    },
  });
  return fetchImpl as unknown as typeof fetch;
}

async function withEnv(patch: Record<string, string | undefined>, callback: () => Promise<void> | void) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("streams remote media without requiring content-length", async () => {
  await withServer((request, response) => {
    assert.equal(request.url, "/ok");
    response.writeHead(200, { "content-type": "image/png" });
    response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }, async (baseUrl) => {
    const result = await storeRemoteUrlStreamed(`${baseUrl}/ok`, {
      prefix: "remote-test",
      fallbackMime: "image/png",
      fetchImpl: localFetch(),
      lookupImpl: lookupPublicToLocal(),
    });
    assert.match(result.storedName, /^remote-test-/);
    assert.equal(result.mimeType, "image/png");
    assert.equal(result.size, 4);
  });
});

test("aborts oversized streams even when content-length is missing or false", async () => {
  const uploadsDir = process.env.UPLOADS_DIR;
  assert(uploadsDir);
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "image/png" });
    response.write(Buffer.alloc(1024 * 1024));
    response.write(Buffer.alloc(1024 * 1024));
    response.write(Buffer.alloc(1024 * 1024));
    response.end();
  }, async (baseUrl) => {
    await assert.rejects(
      () => storeRemoteUrlStreamed(`${baseUrl}/missing-length`, {
        prefix: "remote-test",
        fallbackMime: "image/png",
        fetchImpl: localFetch(),
        lookupImpl: lookupPublicToLocal(),
      }),
    );
  });
  await assert.rejects(
    () => storeRemoteUrlStreamed("http://mock-provider.test/false-length", {
      prefix: "remote-test",
      fallbackMime: "image/png",
      fetchImpl: fakeSmallContentLengthFetch(),
      lookupImpl: lookupPublicToLocal(),
    }),
  );
  const leftovers = (await readdir(uploadsDir)).filter((name) => name.includes(".remote-"));
  assert.deepEqual(leftovers, []);
});

test("rejects unsafe protocols and private redirect targets", async () => {
  await assert.rejects(
    () => storeRemoteUrlStreamed("file:///etc/passwd", {
      prefix: "remote-test",
      fallbackMime: "image/png",
      fetchImpl: localFetch(),
      lookupImpl: lookupPublicToLocal(),
    }),
  );
  await withServer((request, response) => {
    const target = request.url === "/to-loopback"
      ? "http://loopback.test/asset.png"
      : request.url === "/to-private"
        ? "http://private.test/asset.png"
        : "http://metadata.test/latest/meta-data";
    response.writeHead(302, { location: target });
    response.end();
  }, async (baseUrl) => {
    for (const path of ["/to-loopback", "/to-private", "/to-metadata"]) {
      await assert.rejects(
        () => storeRemoteUrlStreamed(`${baseUrl}${path}`, {
          prefix: "remote-test",
          fallbackMime: "image/png",
          fetchImpl: localFetch(),
          lookupImpl: lookupPublicToLocal(),
        }),
      );
    }
  });
});

test("rejects excessive redirects and cleans temporary files", async () => {
  const uploadsDir = process.env.UPLOADS_DIR;
  assert(uploadsDir);
  await withServer((request, response) => {
    const count = Number(new URL(`http://x${request.url}`).searchParams.get("n") || "0");
    response.writeHead(302, { location: `/redirect?n=${count + 1}` });
    response.end();
  }, async (baseUrl) => {
    await assert.rejects(
      () => storeRemoteUrlStreamed(`${baseUrl}/redirect?n=0`, {
        prefix: "remote-test",
        fallbackMime: "image/png",
        fetchImpl: localFetch(),
        lookupImpl: lookupPublicToLocal(),
        maxRedirects: 2,
      }),
    );
  });
  const leftovers = (await readdir(uploadsDir)).filter((name) => name.includes(".remote-"));
  assert.deepEqual(leftovers, []);
});

test("rejects unsupported content types", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html></html>");
  }, async (baseUrl) => {
    await assert.rejects(
      () => storeRemoteUrlStreamed(`${baseUrl}/html`, {
        prefix: "remote-test",
        fallbackMime: "image/png",
        fetchImpl: localFetch(),
        lookupImpl: lookupPublicToLocal(),
      }),
    );
  });
});

test("removes temp file when the download fails midway", async () => {
  const uploadsDir = process.env.UPLOADS_DIR;
  assert(uploadsDir);
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "image/png" });
    response.write(Buffer.from([0x89, 0x50]));
    response.destroy();
  }, async (baseUrl) => {
    await assert.rejects(
      () => storeRemoteUrlStreamed(`${baseUrl}/fail`, {
        prefix: "remote-test",
        fallbackMime: "image/png",
        fetchImpl: localFetch(),
        lookupImpl: lookupPublicToLocal(),
      }),
    );
  });
  const leftovers = (await readdir(uploadsDir)).filter((name) => name.includes(".remote-"));
  assert.deepEqual(leftovers, []);
});

test("total timeout covers response body and closes the connection", async () => {
  const uploadsDir = process.env.UPLOADS_DIR;
  assert(uploadsDir);
  let closed = false;
  await withServer((_request, response) => {
    response.on("close", () => {
      closed = true;
    });
    response.writeHead(200, { "content-type": "image/png" });
    response.write(Buffer.from([0x89, 0x50]));
  }, async (baseUrl) => {
    await assert.rejects(
      () => storeRemoteUrlStreamed(`${baseUrl}/never-finishes`, {
        prefix: "remote-test",
        fallbackMime: "image/png",
        fetchImpl: localFetch(),
        lookupImpl: lookupPublicToLocal(),
        timeoutMs: 50,
        idleTimeoutMs: 500,
      }),
    );
  });
  assert.equal(closed, true);
  const leftovers = (await readdir(uploadsDir)).filter((name) => name.includes(".remote-"));
  assert.deepEqual(leftovers, []);
});

test("idle timeout aborts a stalled response body and slow valid streams still succeed", async () => {
  const uploadsDir = process.env.UPLOADS_DIR;
  assert(uploadsDir);
  await withServer((request, response) => {
    response.writeHead(200, { "content-type": "image/png" });
    response.write(Buffer.from([0x89]));
    if (request.url === "/slow-ok") {
      setTimeout(() => {
        response.end(Buffer.from([0x50, 0x4e, 0x47]));
      }, 20);
      return;
    }
  }, async (baseUrl) => {
    await assert.rejects(
      () => storeRemoteUrlStreamed(`${baseUrl}/stalled`, {
        prefix: "remote-test",
        fallbackMime: "image/png",
        fetchImpl: localFetch(),
        lookupImpl: lookupPublicToLocal(),
        timeoutMs: 500,
        idleTimeoutMs: 30,
      }),
    );
    const result = await storeRemoteUrlStreamed(`${baseUrl}/slow-ok`, {
      prefix: "remote-test",
      fallbackMime: "image/png",
      fetchImpl: localFetch(),
      lookupImpl: lookupPublicToLocal(),
      timeoutMs: 500,
      idleTimeoutMs: 100,
    });
    assert.equal(result.size, 4);
  });
  const leftovers = (await readdir(uploadsDir)).filter((name) => name.includes(".remote-"));
  assert.deepEqual(leftovers, []);
});

test("production allowlist is fail-closed and rejects suffix bypasses and unlisted redirects", async () => {
  await withEnv({ NODE_ENV: "production", REMOTE_MEDIA_ALLOWED_HOSTS: undefined }, async () => {
    await assert.rejects(
      () => storeRemoteUrlStreamed("http://media.example.test/asset.png", {
        prefix: "remote-test",
        fallbackMime: "image/png",
        fetchImpl: localFetch(),
        lookupImpl: lookupPublicToLocal(),
      }),
    );
  });

  await withEnv({ NODE_ENV: "production", REMOTE_MEDIA_ALLOWED_HOSTS: "media.example.test,*.media.example.test" }, async () => {
    await withServer((request, response) => {
      if (request.url === "/ok" || request.url === "/sub-ok") {
        response.writeHead(200, { "content-type": "image/png" });
        response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return;
      }
      response.writeHead(302, { location: "http://evil.test/asset.png" });
      response.end();
    }, async (baseUrl) => {
      const port = new URL(baseUrl).port;
      const exact = await storeRemoteUrlStreamed(`http://media.example.test:${port}/ok`, {
        prefix: "remote-test",
        fallbackMime: "image/png",
        fetchImpl: localFetch(),
        lookupImpl: lookupPublicToLocal(),
      });
      assert.equal(exact.mimeType, "image/png");
      const subdomain = await storeRemoteUrlStreamed(`http://cdn.media.example.test:${port}/sub-ok`, {
        prefix: "remote-test",
        fallbackMime: "image/png",
        fetchImpl: localFetch(),
        lookupImpl: lookupPublicToLocal(),
      });
      assert.equal(subdomain.mimeType, "image/png");
      await assert.rejects(
        () => remoteMediaDownloadInternalsForTests.assertSafeRemoteUrl("http://media.example.test.evil.test/asset.png", lookupPublicToLocal()),
      );
      await assert.rejects(
        () => storeRemoteUrlStreamed(`http://media.example.test:${port}/redirect`, {
          prefix: "remote-test",
          fallbackMime: "image/png",
          fetchImpl: localFetch(),
          lookupImpl: lookupPublicToLocal(),
        }),
      );
    });
  });
});

test("IPv4-mapped IPv6 private and metadata addresses are rejected", () => {
  for (const address of [
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:172.16.0.1",
    "::ffff:172.31.255.255",
    "::ffff:192.168.0.1",
    "::ffff:169.254.169.254",
    "::ffff:100.64.0.1",
    "::ffff:100.127.255.255",
  ]) {
    assert.equal(remoteMediaDownloadInternalsForTests.isUnsafeIp(address), true, `${address} should be unsafe`);
  }
});

test("data URL and direct byte storage validate MIME and size before final writes", async () => {
  const uploadsDir = process.env.UPLOADS_DIR;
  assert(uploadsDir);
  const png = await storeDataUrl("data:image/png;base64,iVBORw0KGgo=", "data-image");
  assert.match(png.storedName, /^data-image-/);
  assert.equal(png.mimeType, "image/png");
  const mp4 = await storeDataUrl(`data:video/mp4;base64,${Buffer.from("0000ftyp").toString("base64")}`, "data-video");
  assert.equal(mp4.mimeType, "video/mp4");
  await assert.rejects(() => storeDataUrl("data:text/plain;base64,Zm9v", "data-image"));
  await assert.rejects(() => storeDataUrl("data:image/png;base64,####", "data-image"));
  await withEnv({ MEDIA_IMAGE_UPLOAD_LIMIT_MIB: "1" }, async () => {
    const tooLargeBase64 = "A".repeat(Math.ceil((1024 * 1024 + 1) / 3) * 4);
    assert(libraryStorageInternalsForTests.estimateBase64DecodedBytes(tooLargeBase64) > 1024 * 1024);
    const originalFrom = Buffer.from;
    let decoded = false;
    Buffer.from = ((...args: Parameters<typeof Buffer.from>) => {
      decoded = true;
      return originalFrom(...args);
    }) as typeof Buffer.from;
    try {
      await assert.rejects(() => storeDataUrl(`data:image/png;base64,${tooLargeBase64}`, "data-image"));
    } finally {
      Buffer.from = originalFrom;
    }
    assert.equal(decoded, false, "oversized data URL must be rejected before base64 decoding");
    await assert.rejects(() => storeBytes(Buffer.alloc(1024 * 1024 + 1), "image/png", "bytes-image"));
  });
  const leftovers = (await readdir(uploadsDir)).filter((name) => name.includes(".store-"));
  assert.deepEqual(leftovers, []);
});

test("uses isolated temporary uploads directory", async () => {
  assert(process.env.UPLOADS_DIR?.startsWith(join(tmpdir(), "")) || process.env.AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE === "1");
  const stats = await stat(process.env.UPLOADS_DIR || "");
  assert.equal(stats.isDirectory(), true);
});
