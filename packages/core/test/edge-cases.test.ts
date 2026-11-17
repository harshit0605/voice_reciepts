import { describe, it, expect } from "vitest";
import {
  demoState,
  quote,
  round,
  integer,
  D,
  indiaDate,
  fiscalYear,
  invoiceNumber,
  rupees,
  parseExpiry,
  expiryRows,
  sumCostValue,
  neverSent,
  withinLeaseWindow,
  LEASE_SKEW_MS,
  type State,
} from "../src";

const NOW = "2026-09-23T09:00:00.000Z";

/** Small deterministic PRNG so the sweeps are reproducible. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const GST = [0, 500, 1200, 1800, 2800];

describe("money: rounding primitives", () => {
  it("rounds half away from zero, including negatives", () => {
    expect(round("2.5")).toBe(3);
    expect(round("-0.5")).toBe(-1);
    expect(round("-1.5")).toBe(-2);
    expect(round("0.49999999999999999999")).toBe(0);
  });
  it("throws on non-numbers and non-finite values rather than returning NaN", () => {
    expect(() => round("abc")).toThrow();
    expect(() => round("NaN")).toThrow();
    expect(() => round("Infinity")).toThrow();
  });
  it("integer refuses fractions and unsafe magnitudes", () => {
    expect(() => integer("1.5")).toThrow("Unsafe money value");
    expect(() => integer(String(Number.MAX_SAFE_INTEGER) + "0")).toThrow();
    expect(integer("100")).toBe(100);
  });
  // Regression (fixed 2026-11-17): round() of a small negative (-0.4) returns IEEE negative zero, because Decimal keeps the
  // sign and integer() returns d.toNumber() (money.ts:9). It prints as "0" in JSON but
  // rupees(-0) renders "-₹0.00" (money.ts rupees via Intl), a stray minus on a zero amount.
  it("round() never returns negative zero", () => {
    expect(Object.is(round("-0.4"), -0)).toBe(false);
  });
  it("rupees renders zero without a minus sign", () => {
    expect(rupees(round("-0.4"))).toBe("₹0.00");
  });
  it("rupees uses Indian digit grouping and two decimals", () => {
    expect(rupees(0)).toBe("₹0.00");
    expect(rupees(5)).toBe("₹0.05");
    expect(rupees(123456789)).toBe("₹12,34,567.89");
    expect(rupees(10000000)).toBe("₹1,00,000.00");
    expect(rupees(-5)).toMatch(/^-₹0\.05$/);
  });
});

describe("fiscal year and India date boundaries", () => {
  it("starts the fiscal year on 1 April IST, not UTC", () => {
    expect(fiscalYear("2026-03-31T18:29:59.999Z")).toBe("2526");
    expect(fiscalYear("2026-03-31T18:30:00.000Z")).toBe("2627");
    expect(fiscalYear("2026-04-01T00:00:00+05:30")).toBe("2627");
    expect(fiscalYear("2026-03-31T23:59:59+05:30")).toBe("2526");
  });
  it("keeps 1 January and 31 December in the same fiscal year across the calendar boundary", () => {
    expect(fiscalYear("2026-12-31T18:29:59Z")).toBe("2627");
    expect(fiscalYear("2026-12-31T18:30:00Z")).toBe("2627"); // already 1 Jan 2027 IST
    expect(fiscalYear("2027-01-01T00:00:00+05:30")).toBe("2627");
  });
  it("is correct on leap days", () => {
    expect(indiaDate("2028-02-28T18:30:00Z")).toBe("2028-02-29");
    expect(indiaDate("2028-02-29T18:30:00Z")).toBe("2028-03-01");
    expect(indiaDate("2027-02-28T18:30:00Z")).toBe("2027-03-01");
  });
  it("accepts offsets other than Z", () => {
    expect(indiaDate("2026-09-23T00:00:00+05:30")).toBe("2026-09-23");
    expect(indiaDate("2026-09-22T20:00:00-05:00")).toBe("2026-09-23");
  });
  it("throws a RangeError for text that is not a date", () => {
    expect(() => indiaDate("garbage")).toThrow(RangeError);
    expect(() => fiscalYear("")).toThrow(RangeError);
  });
  it("numbers invoices as FY-series-sequence, padded to six digits", () => {
    expect(invoiceNumber("2026-04-01T00:00:00+05:30", "A", 7)).toBe(
      "2627-A-000007",
    );
    expect(invoiceNumber("2026-03-31T23:00:00+05:30", "A", 1)).toBe(
      "2526-A-000001",
    );
    expect(invoiceNumber("2026-09-23T09:00:00Z", "S2", 1234567)).toBe(
      "2627-S2-1234567",
    );
  });
});

describe("parseExpiry: more printed forms", () => {
  it("reads single-digit months and mixed separators", () => {
    expect(parseExpiry("1/27")).toBe("2027-01-31");
    expect(parseExpiry("04 / 27")).toBe("2027-04-30");
    expect(parseExpiry("1.1.27")).toBe("2027-01-01");
    expect(parseExpiry("31-12-26")).toBe("2026-12-31");
    expect(parseExpiry("may'27")).toBe("2027-05-31");
    expect(parseExpiry("aug27")).toBe("2027-08-31");
    expect(parseExpiry("exp04/27")).toBe("2027-04-30");
  });
  it("knows leap years including the 2100 exception", () => {
    expect(parseExpiry("29/02/2000")).toBe("2000-02-29");
    expect(parseExpiry("29/02/2100")).toBeNull();
    expect(parseExpiry("02/2100")).toBe("2100-02-28");
    expect(parseExpiry("2028-02-29")).toBe("2028-02-29");
    expect(parseExpiry("2027-02-29")).toBeNull();
  });
  it("rejects day/month zero, US-ordered dates, non-padded ISO and look-alike digits", () => {
    for (const bad of [
      "00/00/2027",
      "0/27",
      "12/31/2027",
      "2027-4-5",
      "2027/04/30",
      "04/2027x",
      "४/27",
      "０４/２７",
      "mar",
      "",
    ])
      expect(parseExpiry(bad), JSON.stringify(bad)).toBeNull();
  });
  it("always returns YYYY-MM-DD or null, never throws, on junk", () => {
    for (const junk of [
      "!!",
      "--",
      "99/99",
      "1/1/1",
      "9999-99-99",
      "a".repeat(500),
      "/",
      "//",
      "00/00",
    ])
      expect(() => parseExpiry(junk), junk).not.toThrow();
  });
  // Regression (fixed 2026-11-17): the "EXP" prefix is stripped without an optional colon, so the very common
  // pack wording "EXP: 04/27" or "Exp: 04/2027" is rejected. opening.ts:30 `.replace(/^exp\.?\s*/, "")`.
  it("reads 'EXP: 04/27' as printed on a pack", () => {
    expect(parseExpiry("EXP: 04/27")).toBe("2027-04-30");
  });
  // Regression (fixed 2026-11-17): a trailing full stop, typical of OCR output ("04/27."), makes the date unreadable.
  it("ignores a trailing full stop after the date", () => {
    expect(parseExpiry("04/27.")).toBe("2027-04-30");
  });
});

describe("quote: invariants over a random sweep", () => {
  function shop(
    rand: () => number,
    n: number,
  ): {
    state: State;
    lines: {
      batchId: string;
      quantity: string;
      unit: string;
      confirmed: boolean;
    }[];
  } {
    const state = demoState(undefined, undefined, undefined, NOW);
    const base = state.products.dolo;
    const baseBatch = state.batches["dolo-b1"];
    const lines = [];
    for (let i = 0; i < n; i++) {
      const price = 1 + Math.floor(rand() * 5000);
      const id = `sweep${i}`;
      state.products[id] = {
        ...base,
        id,
        baseUnit: "tablet",
        units: { tablet: "1", strip: String(1 + Math.floor(rand() * 15)) },
        taxBps: GST[Math.floor(rand() * GST.length)],
      };
      state.batches[`${id}-b`] = {
        ...baseBatch,
        id: `${id}-b`,
        productId: id,
        code: id.toUpperCase(),
        expiry: "2030-01-01",
        quantity: "100000",
        pricePaise: price,
        mrpPaise: price + Math.floor(rand() * 100),
      };
      lines.push({
        batchId: `${id}-b`,
        quantity: String(1 + Math.floor(rand() * 40)),
        unit: rand() < 0.5 ? "tablet" : "strip",
        confirmed: true,
      });
    }
    return { state, lines };
  }
  it("never loses or invents a paisa across 400 random baskets and discounts", () => {
    const rand = prng(20261117);
    for (let round_ = 0; round_ < 400; round_++) {
      const { state, lines } = shop(rand, 1 + Math.floor(rand() * 6));
      const gross = quote(state, lines, NOW).reduce(
        (n, l) => n + l.grossPaise,
        0,
      );
      const discount = rand() < 0.2 ? 0 : Math.floor(rand() * (gross + 1));
      const out = quote(state, lines, NOW, discount);
      expect(out.reduce((n, l) => n + l.discountPaise, 0)).toBe(discount);
      expect(out.reduce((n, l) => n + l.netPaise, 0)).toBe(gross - discount);
      for (const l of out) {
        expect(l.discountPaise).toBeGreaterThanOrEqual(0);
        expect(l.discountPaise).toBeLessThanOrEqual(l.grossPaise);
        expect(l.netPaise).toBe(l.grossPaise - l.discountPaise);
        expect(l.cgstPaise + l.sgstPaise).toBe(l.taxPaise);
        expect(l.sgstPaise - l.cgstPaise).toBeGreaterThanOrEqual(0);
        expect(l.sgstPaise - l.cgstPaise).toBeLessThanOrEqual(1);
        expect(l.taxPaise).toBeGreaterThanOrEqual(0);
        expect(l.taxPaise).toBeLessThanOrEqual(l.netPaise);
        // tax is the inclusive share, within half a paisa of the exact fraction
        const exact = (l.netPaise * l.taxBps) / (10000 + l.taxBps);
        expect(Math.abs(l.taxPaise - exact)).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
  });
  it("a discount equal to the whole sale leaves every line at zero", () => {
    const rand = prng(7);
    const { state, lines } = shop(rand, 4);
    const gross = quote(state, lines, NOW).reduce(
      (n, l) => n + l.grossPaise,
      0,
    );
    const out = quote(state, lines, NOW, gross);
    expect(out.every((l) => l.netPaise === 0 && l.taxPaise === 0)).toBe(true);
  });
  it("is deterministic and does not mutate the state it reads", () => {
    const rand = prng(99);
    const { state, lines } = shop(rand, 3);
    const before = JSON.stringify(state);
    const a = quote(state, lines, NOW, 17);
    const b = quote(state, lines, NOW, 17);
    expect(a).toEqual(b);
    expect(JSON.stringify(state)).toBe(before);
  });
  it("a discount applied to an empty basket is refused unless it is zero", () => {
    const state = demoState(undefined, undefined, undefined, NOW);
    expect(quote(state, [], NOW, 0)).toEqual([]);
    expect(() => quote(state, [], NOW, 1)).toThrow("Discount exceeds");
  });
  it("applies a price/tax override per line and checks the override against MRP", () => {
    const rand = prng(3);
    const { state, lines } = shop(rand, 2);
    const [a] = quote(state, lines, NOW, 0, [
      { pricePaise: 100, taxBps: 0 },
      { pricePaise: 100, taxBps: 0 },
    ]);
    expect(a.pricePaise).toBe(100);
    expect(a.taxPaise).toBe(0);
    const mrp = state.batches[lines[0].batchId].mrpPaise;
    expect(() =>
      quote(state, lines, NOW, 0, [{ pricePaise: mrp + 1, taxBps: 0 }]),
    ).toThrow("exceeds MRP");
  });
  // Regression (fixed 2026-11-17): quote() does not reject a negative discount. The
  // contract schema (contracts.ts:8 `money.min(0)`) stops it at the API, but quote is exported and
  // a negative value yields net > gross. money.ts:44 only compares `discountPaise > total`.
  it("refuses a negative discount", () => {
    const rand = prng(5);
    const { state, lines } = shop(rand, 2);
    expect(() => quote(state, lines, NOW, -10)).toThrow();
  });
});

describe("expiryRows: month ends, leap days, year boundaries", () => {
  function shopWith(batches: Record<string, string>): State {
    const s = demoState(undefined, undefined, undefined, NOW);
    const base = s.batches["dolo-b1"];
    for (const b of Object.values(s.batches)) b.quantity = "0";
    for (const [id, expiry] of Object.entries(batches))
      s.batches[id] = { ...base, id, code: id, expiry, quantity: "1" };
    return s;
  }
  const days = (today: string, batches: Record<string, string>) =>
    Object.fromEntries(
      expiryRows(shopWith(batches), today).map((r) => [
        r.batch.id,
        [r.group, r.daysLeft],
      ]),
    );
  it("counts days across a leap February and a year end", () => {
    expect(days("2028-02-28", { a: "2028-02-29", b: "2028-03-01" })).toEqual({
      a: ["within30", 1],
      b: ["within30", 2],
    });
    expect(days("2027-02-28", { a: "2027-03-01" })).toEqual({
      a: ["within30", 1],
    });
    expect(
      days("2026-12-31", { a: "2027-01-01", b: "2026-12-31", c: "2026-12-30" }),
    ).toEqual({
      a: ["within30", 1],
      b: ["within30", 0],
      c: ["expired", -1],
    });
  });
  it("puts the 30/31 and 90/91 day edges in the right group across month lengths", () => {
    // 31 January + 30 days = 2 March (non-leap): still within30; +31 days = 3 March
    expect(
      days("2027-01-31", {
        a: "2027-03-02",
        b: "2027-03-03",
        c: "2027-05-01",
        d: "2027-05-02",
      }),
    ).toEqual({
      a: ["within30", 30],
      b: ["within90", 31],
      c: ["within90", 90],
    });
  });
  it("is not thrown off by the day on which clocks never change (no DST in the shop's date maths)", () => {
    for (const today of ["2026-03-29", "2026-10-25", "2026-11-01"]) {
      const out = days(today, { x: today });
      expect(out.x).toEqual(["within30", 0]);
    }
  });
  it("sorts by expiry, then product name, then batch code", () => {
    const s = shopWith({
      b2: "2026-10-01",
      b1: "2026-10-01",
      early: "2026-09-30",
    });
    expect(expiryRows(s, "2026-09-23").map((r) => r.batch.id)).toEqual([
      "early",
      "b1",
      "b2",
    ]);
  });
  it("sums cost only over batches that have one", () => {
    const s = shopWith({ c1: "2026-10-01", c2: "2026-10-02" });
    s.batches.c1.costPaise = 250;
    s.batches.c1.quantity = "4";
    delete s.batches.c2.costPaise;
    const rows = expiryRows(s, "2026-09-23");
    expect(sumCostValue(rows)).toBe(1000);
  });
  it("ignores a batch whose product no longer exists", () => {
    const s = shopWith({ orphan: "2026-10-01" });
    s.batches.orphan.productId = "missing";
    expect(expiryRows(s, "2026-09-23")).toEqual([]);
  });
});

describe("withinLeaseWindow: clock drift", () => {
  const issued = "2026-09-23T09:00:00.000Z";
  const expires = "2026-09-24T09:00:00.000Z";
  const shift = (base: string, ms: number) =>
    new Date(Date.parse(base) + ms).toISOString();
  it("allows exactly the skew at either end and nothing beyond it", () => {
    expect(
      withinLeaseWindow(shift(issued, -LEASE_SKEW_MS), issued, expires),
    ).toBe(true);
    expect(
      withinLeaseWindow(shift(issued, -LEASE_SKEW_MS - 1), issued, expires),
    ).toBe(false);
    expect(
      withinLeaseWindow(shift(expires, LEASE_SKEW_MS), issued, expires),
    ).toBe(true);
    expect(
      withinLeaseWindow(shift(expires, LEASE_SKEW_MS + 1), issued, expires),
    ).toBe(false);
  });
  it("compares instants, so an equivalent time in another UTC offset gives the same answer", () => {
    expect(
      withinLeaseWindow("2026-09-23T14:30:00+05:30", issued, expires),
    ).toBe(true);
    expect(
      withinLeaseWindow("2026-09-23T14:24:59+05:30", issued, expires),
    ).toBe(false);
    expect(
      withinLeaseWindow("2026-09-24T14:35:00+05:30", issued, expires),
    ).toBe(true);
    expect(
      withinLeaseWindow("2026-09-24T14:35:01+05:30", issued, expires),
    ).toBe(false);
  });
  it("is false for unparseable input in any of the three arguments", () => {
    expect(withinLeaseWindow("", issued, expires)).toBe(false);
    expect(withinLeaseWindow(issued, "garbage", expires)).toBe(false);
    expect(withinLeaseWindow(issued, issued, "garbage")).toBe(false);
    expect(withinLeaseWindow(issued, "", "")).toBe(false);
  });
  it("is false for an inverted window longer than twice the skew, true when they overlap", () => {
    // issuedAt after expiresAt: the two skew allowances overlap only if the gap <= 2 * skew
    expect(withinLeaseWindow(issued, expires, issued)).toBe(false);
    const closeIssued = "2026-09-23T09:04:00.000Z";
    expect(withinLeaseWindow(issued, closeIssued, issued)).toBe(true);
  });
  it("accepts a zero-length lease at its own instant", () => {
    expect(withinLeaseWindow(issued, issued, issued)).toBe(true);
  });
});

describe("neverSent: more failure shapes", () => {
  it("reads plain strings and objects that only carry a message", () => {
    expect(neverSent("ECONNREFUSED 127.0.0.1:4100")).toBe(true);
    expect(neverSent({ message: "connect ENETUNREACH 10.0.0.1:443" })).toBe(
      true,
    );
    expect(neverSent("Network is unreachable")).toBe(true);
    expect(neverSent(new Error("getaddrinfo EAI_AGAIN"))).toBe(false);
  });
  it("is case-insensitive", () => {
    expect(neverSent(new Error("FAILED TO CONNECT TO /10.0.2.2:4100"))).toBe(
      true,
    );
    expect(
      neverSent(new Error("the internet connection APPEARS TO BE OFFLINE")),
    ).toBe(true);
  });
  it("does not call anything that may have reached the server 'never sent'", () => {
    for (const e of [
      "ECONNRESET",
      "read ECONNRESET",
      "socket hang up",
      "Network request failed",
      "HTTP 502 Bad Gateway",
      "AbortError: This operation was aborted",
      "Failed to parse response",
    ])
      expect(neverSent(new Error(e)), e).toBe(false);
  });
  it("is false for empty, null and non-error values", () => {
    for (const v of [undefined, null, "", 0, {}, [], false])
      expect(neverSent(v), String(v)).toBe(false);
  });
});
