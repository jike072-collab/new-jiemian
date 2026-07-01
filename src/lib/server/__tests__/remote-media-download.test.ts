import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import { test } from "node:test";

import { storeRemoteUrlStreamed } from "../remote-media-download";

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
    if (hostname === "mock-provider.test") return [{ address: "93.184.216.34", family: 4 as const }];
    if (hostname === "loopback.test") return [{ address: "127.0.0.1", family: 4 as const }];
    if (hostname === "private.test") return [{ address: "192.168.1.10", family: 4 as const }];
    if (hostname === "metadata.test") return [{ address: "169.254.169.254", family: 4 as const }];
    return [{ address: "93.184.216.34", family: 4 as const }];
  };
  return lookup as unknown as TestLookup;
}

function localFetch() {
  return (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(input instanceof URL ? input.toString() : String(input));
    if (url.hostname === "mock-provider.test") {
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
      /Remote media|不能超过/,
    );
  });
  await assert.rejects(
    () => storeRemoteUrlStreamed("http://mock-provider.test/false-length", {
      prefix: "remote-test",
      fallbackMime: "image/png",
      fetchImpl: fakeSmallContentLengthFetch(),
      lookupImpl: lookupPublicToLocal(),
    }),
    /Remote media|不能超过/,
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
    /protocol/,
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
        /private|local/,
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
      /redirect limit/,
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
      /type/,
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

test("uses isolated temporary uploads directory", async () => {
  assert(process.env.UPLOADS_DIR?.startsWith(join(tmpdir(), "")) || process.env.AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE === "1");
  const stats = await stat(process.env.UPLOADS_DIR || "");
  assert.equal(stats.isDirectory(), true);
});
