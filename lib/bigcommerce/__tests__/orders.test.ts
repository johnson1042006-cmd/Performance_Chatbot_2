/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getOrderByEmailAndOrderId,
  getOrderShipments,
  BC_ORDER_STATUS,
} from "@/lib/bigcommerce/client";

// The BC client lazy-reads BIGCOMMERCE_STORE_HASH and BIGCOMMERCE_ACCESS_TOKEN
// from env at fetch time, so we set them once for the whole suite.
const ORIGINAL_ENV = { ...process.env };

describe("BigCommerce v2 orders client", () => {
  beforeEach(() => {
    process.env.BIGCOMMERCE_STORE_HASH = "teststore";
    process.env.BIGCOMMERCE_ACCESS_TOKEN = "test-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it("getOrderByEmailAndOrderId returns the order when BC returns a populated array", async () => {
    const order = {
      id: 12345,
      status: "Shipped",
      status_id: 2,
      date_created: "Mon, 12 Jan 2026 09:14:25 +0000",
      total_inc_tax: "234.50",
      currency_code: "USD",
      items_total: 3,
      items_shipped: 3,
      payment_method: "Credit Card",
      customer_id: 99,
      billing_address: { first_name: "Jane", last_name: "Doe", email: "j@e.co" },
    };

    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify([order]), { status: 200 })
      );

    const result = await getOrderByEmailAndOrderId("j@e.co", 12345);

    expect(result).toEqual(order);
    // Verify the URL hit the v2 endpoint with the right params.
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/stores/teststore/v2/orders");
    expect(calledUrl).toContain("email=j%40e.co");
    expect(calledUrl).toContain("min_id=12345");
    expect(calledUrl).toContain("max_id=12345");
  });

  it("getOrderByEmailAndOrderId returns null when BC returns an empty array", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("[]", { status: 200 })
    );

    const result = await getOrderByEmailAndOrderId("nope@nope.com", 99999);

    expect(result).toBeNull();
  });

  it("getOrderByEmailAndOrderId returns null when BC returns a 503", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("Service Unavailable", { status: 503 })
    );

    const result = await getOrderByEmailAndOrderId("j@e.co", 12345);

    expect(result).toBeNull();
  });

  it("getOrderByEmailAndOrderId is silent on a thrown fetch error (network failure)", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("ECONNRESET"));

    const result = await getOrderByEmailAndOrderId("j@e.co", 12345);

    expect(result).toBeNull();
  });

  it("getOrderShipments returns shipments array on 200", async () => {
    const shipments = [
      {
        id: 1,
        order_id: 12345,
        tracking_number: "1Z999AA10123456784",
        tracking_carrier: "ups",
        date_created: "Mon, 12 Jan 2026 09:14:25 +0000",
        shipping_method: "UPS Ground",
      },
    ];

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(shipments), { status: 200 })
    );

    const result = await getOrderShipments(12345);
    expect(result).toEqual(shipments);
  });

  it("getOrderShipments returns [] on a 204 No Content (no shipments yet)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 204 })
    );

    const result = await getOrderShipments(12345);
    expect(result).toEqual([]);
  });

  it("getOrderShipments returns [] on BC error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("err", { status: 500 })
    );

    const result = await getOrderShipments(12345);
    expect(result).toEqual([]);
  });

  it("BC_ORDER_STATUS map covers the documented status_id values", () => {
    // Spot-check the values customers will most often see in summaries.
    expect(BC_ORDER_STATUS[2]).toBe("Shipped");
    expect(BC_ORDER_STATUS[7]).toBe("Awaiting Payment");
    expect(BC_ORDER_STATUS[10]).toBe("Completed");
    expect(BC_ORDER_STATUS[11]).toBe("Awaiting Fulfillment");
    expect(BC_ORDER_STATUS[5]).toBe("Cancelled");
    expect(BC_ORDER_STATUS[4]).toBe("Refunded");
    expect(BC_ORDER_STATUS[1]).toBe("Pending");
  });
});
