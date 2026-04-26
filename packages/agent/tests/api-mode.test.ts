import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { detectApiMode } from "../src/api-mode.ts";

// Each test uses a unique baseUrl. detectApiMode caches per-baseUrl in a
// module-level Map; reusing URLs would leak state between tests.
let counter = 0;
function freshUrl(prefix = "https://example.test") {
  counter += 1;
  return `${prefix}/v${counter}-${Date.now()}-${Math.random()}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("detectApiMode", () => {
  test("returns 'chat' when /responses returns 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const url = freshUrl();
    const mode = await detectApiMode({ baseUrl: url, apiKey: "k" });

    expect(mode).toBe("chat");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = fetchMock.mock.calls[0][0];
    expect(callUrl).toBe(`${url}/responses`);
  });

  test("returns 'responses' when /responses returns 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    const mode = await detectApiMode({ baseUrl: freshUrl(), apiKey: "k" });
    expect(mode).toBe("responses");
  });

  test("returns 'responses' for any non-404 status (e.g. 400, 401, 500)", async () => {
    for (const status of [400, 401, 500]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
      const mode = await detectApiMode({ baseUrl: freshUrl(), apiKey: "k" });
      expect(mode).toBe("responses");
      vi.restoreAllMocks();
    }
  });

  test("falls back to 'chat' when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const mode = await detectApiMode({ baseUrl: freshUrl(), apiKey: "k" });
    expect(mode).toBe("chat");
  });

  test("caches the detected mode per baseUrl (single fetch on repeat)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const url = freshUrl();
    const a = await detectApiMode({ baseUrl: url, apiKey: "k" });
    const b = await detectApiMode({ baseUrl: url, apiKey: "different-key" });

    expect(a).toBe("responses");
    expect(b).toBe("responses");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("strips a trailing slash from baseUrl when probing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const base = freshUrl();
    await detectApiMode({ baseUrl: `${base}/`, apiKey: "k" });

    expect(fetchMock.mock.calls[0][0]).toBe(`${base}/responses`);
  });

  test("sends a POST with empty JSON body and bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await detectApiMode({ baseUrl: freshUrl(), apiKey: "secret" });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer secret");
  });

  test("uses an empty bearer when apiKey is undefined", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await detectApiMode({ baseUrl: freshUrl(), apiKey: undefined });

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ");
  });

  test("caches the fallback 'chat' mode after a fetch failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("fetch", fetchMock);

    const url = freshUrl();
    const a = await detectApiMode({ baseUrl: url, apiKey: "k" });
    const b = await detectApiMode({ baseUrl: url, apiKey: "k" });

    expect(a).toBe("chat");
    expect(b).toBe("chat");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
