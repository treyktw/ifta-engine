import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildIftaQuarterlyPackSection,
  checkRateCoverage,
  computeIftaQuarterly,
  DEFAULT_FLEET_MPG,
  InMemoryIftaRateStore,
  parseIftaRateFile,
  periodKeyForTimestamp,
  quarterRange,
  rateMapFromFile,
} from "../src/index";

const rates = new Map([
  ["AA", { ratePerGallon: 0.5 }],
  ["BB", { ratePerGallon: 0.3, surchargeRatePerGallon: 0.1 }],
]);

describe("computeIftaQuarterly — fleet-MPG method", () => {
  it("computes fleet MPG, taxable/net gallons and net tax per jurisdiction", () => {
    // 600 + 400 = 1000 mi over 100 + 100 = 200 gal → 5 mpg.
    const result = computeIftaQuarterly({
      miles: [
        { jurisdiction: "AA", miles: 600 },
        { jurisdiction: "BB", miles: 400 },
      ],
      fuelRows: [
        { jurisdiction: "AA", gallons: 100, totalCost: 0 },
        { jurisdiction: "BB", gallons: 100, totalCost: 0 },
      ],
      rates,
    });

    expect(result.fleetMpg).toBe(5);
    expect(result.mpgSource).toBe("computed from fuel + miles");
    const [aa, bb] = result.lines;
    // AA: 600/5 = 120 taxable, 120 − 100 = 20 net → 20 × 0.50 = $10.00 due.
    expect(aa.taxableGallons).toBe(120);
    expect(aa.netTaxableGallons).toBe(20);
    expect(aa.netTax).toBeCloseTo(10, 10);
    // BB: 400/5 = 80 taxable, 80 − 100 = −20 net → −20 × 0.30 = −$6 credit,
    // plus the surcharge on all 80 taxable gallons: 80 × 0.10 = $8 → +$2.
    expect(bb.taxableGallons).toBe(80);
    expect(bb.netTaxableGallons).toBe(-20);
    expect(bb.netTax).toBeCloseTo(2, 10);
    expect(result.netTaxTotal).toBeCloseTo(12, 10);
    expect(result.netTaxComplete).toBe(true);
  });

  it("reports a credit when more tax-paid fuel was bought than consumed", () => {
    const result = computeIftaQuarterly({
      miles: [
        { jurisdiction: "AA", miles: 100 },
        { jurisdiction: "BB", miles: 900 },
      ],
      fuelRows: [{ jurisdiction: "AA", gallons: 200, totalCost: 0 }],
      rates,
    });
    const aa = result.lines.find((l) => l.jurisdiction === "AA")!;
    expect(aa.netTax).toBeLessThan(0);
  });

  it("flags jurisdictions with miles but no fuel receipts", () => {
    const result = computeIftaQuarterly({
      miles: [
        { jurisdiction: "AA", miles: 500 },
        { jurisdiction: "BB", miles: 500 },
      ],
      fuelRows: [{ jurisdiction: "AA", gallons: 200, totalCost: 0 }],
      rates,
    });
    expect(result.incomplete).toEqual(["BB"]);
    expect(result.lines.find((l) => l.jurisdiction === "BB")!.missingFuel).toBe(true);
  });

  it("falls back to the org MPG, then the platform default, when there is no fuel data", () => {
    const miles = [{ jurisdiction: "AA", miles: 700 }];
    const withOverride = computeIftaQuarterly({ miles, fuelRows: [], fallbackMpg: 7 });
    expect(withOverride.fleetMpg).toBe(7);
    expect(withOverride.mpgSource).toBe("org default (no fuel data)");
    expect(withOverride.lines[0].taxableGallons).toBe(100);

    const platform = computeIftaQuarterly({ miles, fuelRows: [], fallbackMpg: 0 });
    expect(platform.fleetMpg).toBe(DEFAULT_FLEET_MPG);
    expect(platform.mpgSource).toBe("platform default (no fuel data)");
  });

  it("never fabricates a dollar figure: no rates → gallons only, missing rate → partial", () => {
    const noRates = computeIftaQuarterly({
      miles: [{ jurisdiction: "AA", miles: 100 }],
      fuelRows: [{ jurisdiction: "AA", gallons: 10, totalCost: 0 }],
    });
    expect(noRates.haveRates).toBe(false);
    expect(noRates.lines[0].netTax).toBeUndefined();
    expect(noRates.lines[0].rateStatus).toBe("no-rates-loaded");

    const partial = computeIftaQuarterly({
      miles: [
        { jurisdiction: "AA", miles: 100 },
        { jurisdiction: "OR", miles: 100 },
      ],
      fuelRows: [{ jurisdiction: "AA", gallons: 40, totalCost: 0 }],
      rates,
    });
    expect(partial.missingRates).toEqual(["OR"]);
    expect(partial.netTaxComplete).toBe(false);
    expect(partial.lines.find((l) => l.jurisdiction === "OR")!.rateStatus).toBe("rate-unavailable");
  });

  it("normalises jurisdiction codes and merges duplicate rows", () => {
    const result = computeIftaQuarterly({
      miles: [
        { jurisdiction: " ga", miles: 100 },
        { jurisdiction: "GA", miles: 50 },
      ],
      fuelRows: [
        { jurisdiction: "ga ", gallons: 10, totalCost: 0 },
        { jurisdiction: "GA", gallons: 15, totalCost: 0 },
      ],
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ jurisdiction: "GA", taxableMiles: 150, taxPaidGallons: 25 });
  });
});

describe("buildIftaQuarterlyPackSection", () => {
  it("renders the production worksheet columns, rows and summary", () => {
    const section = buildIftaQuarterlyPackSection({
      miles: [
        { jurisdiction: "AA", miles: 600 },
        { jurisdiction: "OR", miles: 400 },
      ],
      fuelRows: [{ jurisdiction: "AA", gallons: 200, totalCost: 0 }],
      rates,
    });
    expect(section.title).toBe("IFTA Quarterly Worksheet");
    expect(section.columns).toEqual([
      "Jurisdiction",
      "Taxable Miles",
      "Taxable Gallons",
      "Tax-Paid Gallons",
      "Net Taxable Gallons",
      "Rate $/gal",
      "Net Tax",
      "Status",
    ]);
    const orRow = section.rows.find((r) => r.Jurisdiction === "OR")!;
    expect(orRow["Net Tax"]).toBe("rate unavailable");
    expect(orRow.Status).toBe("Missing fuel receipts");
    expect(section.description).toContain("No rate on file for: OR.");
    expect(section.summary?.at(-1)?.label).toBe("Estimated net tax (partial)");
  });

  it("omits the money columns entirely when no rates are loaded", () => {
    const section = buildIftaQuarterlyPackSection({
      miles: [{ jurisdiction: "AA", miles: 600 }],
      fuelRows: [],
    });
    expect(section.columns).not.toContain("Net Tax");
    expect(section.description).toContain("net tax is left to the filer");
  });
});

describe("IFTA rate matrix", () => {
  const file = parseIftaRateFile(
    JSON.parse(readFileSync(resolve(__dirname, "../data/ifta-rates/2026-Q2.json"), "utf8")),
  );

  it("parses the bundled 2026-Q2 matrix with surcharges for IN, KY and VA", () => {
    expect(file.periodKey).toBe("2026-Q2");
    const map = rateMapFromFile(file);
    expect(map.size).toBe(47); // 48 contiguous states minus OR (weight-mile tax)
    expect(map.has("OR")).toBe(false);
    for (const code of ["IN", "KY", "VA"]) {
      expect(map.get(code)?.surchargeRatePerGallon).toBeGreaterThan(0);
    }
  });

  it("rejects malformed rate files loudly", () => {
    expect(() => parseIftaRateFile({ periodKey: "2026-Q5", rates: [] })).toThrow(/periodKey/);
    expect(() =>
      parseIftaRateFile({ periodKey: "2026-Q2", rates: [{ jurisdiction: "Georgia", ratePerGallon: 0.3 }] }),
    ).toThrow(/2-letter/);
    expect(() =>
      parseIftaRateFile({ periodKey: "2026-Q2", rates: [{ jurisdiction: "GA", ratePerGallon: -1 }] }),
    ).toThrow(/ratePerGallon/);
  });

  it("upserts idempotently on (period, jurisdiction, fuel type)", () => {
    const store = new InMemoryIftaRateStore();
    store.upsertRates(file);
    store.upsertRates(file);
    expect(store.countRatesForPeriod("2026-Q2")).toBe(file.rates.length);

    store.upsertRates({ periodKey: "2026-Q2", rates: [{ jurisdiction: "ga", ratePerGallon: 0.4 }] });
    expect(store.countRatesForPeriod("2026-Q2")).toBe(file.rates.length);
    expect(store.rateMap("2026-Q2").get("GA")?.ratePerGallon).toBe(0.4);
    expect(store.listRates("2026-Q2")[0].jurisdiction).toBe("AL");
  });

  it("derives period keys and quarter ranges in UTC", () => {
    expect(periodKeyForTimestamp(Date.UTC(2026, 3, 1))).toBe("2026-Q2");
    expect(periodKeyForTimestamp(Date.UTC(2026, 5, 30, 23, 59))).toBe("2026-Q2");
    expect(periodKeyForTimestamp(Date.UTC(2026, 6, 1))).toBe("2026-Q3");
    const { startMs, endMs } = quarterRange("2026-Q2");
    expect(new Date(startMs).toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(new Date(endMs).toISOString()).toBe("2026-06-30T23:59:59.999Z");
  });

  it("only nags about missing rates in the last three weeks of a quarter", () => {
    const early = Date.UTC(2026, 3, 15);
    const late = Date.UTC(2026, 5, 20);
    expect(checkRateCoverage(early, () => 0).status).toBe("not_in_window");
    expect(checkRateCoverage(late, () => 0)).toMatchObject({ status: "missing", periodKey: "2026-Q2" });
    expect(checkRateCoverage(late, () => 47).status).toBe("covered");
  });
});
