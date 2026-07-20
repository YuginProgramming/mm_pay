/**
 * S1: putKwigaProductEndDate — UTC payload, no timezone_id.
 * Run: npm test -- tests/kwiga/put-kwiga-product-end-date.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatKwigaEndAtForPut } from "../../kwiga/kwiga-product";

vi.mock("../../kwiga/kwiga-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../kwiga/kwiga-config")>();
  return {
    ...actual,
    requireKwigaCredentials: vi.fn(() => ({
      token: "test-token",
      cabinetHash: "test-cabinet",
    })),
    KWIGA_BASE_URL: "https://api.kwiga.com",
  };
});

import { putKwigaProductEndDate } from "../../kwiga/kwiga-api-client";

describe("formatKwigaEndAtForPut", () => {
  it("formats UTC as YYYY-MM-DD HH:mm:ss", () => {
    expect(formatKwigaEndAtForPut(new Date("2026-08-20T23:59:59.000Z"))).toBe(
      "2026-08-20 23:59:59",
    );
  });
});

describe("putKwigaProductEndDate (S1)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PUTs end_at only (no timezone_id) and returns data", async () => {
    const product = {
      id: 98251,
      title: "Multimasking",
      aggregated_subscription: { end_at: "2026-08-20T23:59:59.000000Z" },
    };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: product }),
      text: async () => JSON.stringify({ data: product }),
    });

    const endAt = new Date("2026-08-20T23:59:59.000Z");
    const result = await putKwigaProductEndDate({
      kwigaContactId: 2314024,
      productId: 98251,
      endAt,
    });

    expect(result).toEqual(product);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.kwiga.com/contacts/2314024/products/98251/end-date",
    );
    expect(init.method).toBe("PUT");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({ end_at: "2026-08-20 23:59:59" });
    expect(body).not.toHaveProperty("timezone_id");
    const headers = init.headers as Record<string, string>;
    expect(headers.Token).toBe("test-token");
    expect(headers["Cabinet-Hash"]).toBe("test-cabinet");
  });

  it("throws on non-OK response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({}),
      text: async () => '{"error":"invalid"}',
    });

    await expect(
      putKwigaProductEndDate({
        kwigaContactId: 1,
        productId: 2,
        endAt: new Date("2026-08-20T23:59:59.000Z"),
      }),
    ).rejects.toThrow(/PUT \/contacts\/1\/products\/2\/end-date 422/);
  });
});
