// IFTA quarterly tax-rate matrix. Rates are GLOBAL (published per jurisdiction,
// same for every carrier, changing each quarter). In production they live in a
// table that only an internal seeding script may write — one tenant must not be
// able to corrupt rates for all — and the IFTA pack reads them directly. This
// module is the storage-agnostic part: parsing a rate file, the idempotent
// upsert rule, the period math, and the "rates are missing" reminder check.

export type IftaRateEntry = {
  jurisdiction: string;
  fuelType?: string;
  ratePerGallon: number;
  surchargeRatePerGallon?: number;
};

export type IftaRateFile = {
  periodKey: string;
  source?: string;
  rates: IftaRateEntry[];
};

export type StoredIftaRate = {
  periodKey: string;
  jurisdiction: string;
  fuelType: string;
  ratePerGallon: number;
  surchargeRatePerGallon?: number;
  currency: "USD";
  source?: string;
  updatedAt: number;
};

/** What the quarterly worksheet consumes: jurisdiction code → rate. */
export type IftaRateMap = ReadonlyMap<
  string,
  { ratePerGallon: number; surchargeRatePerGallon?: number }
>;

const PERIOD_KEY = /^(\d{4})-Q([1-4])$/;

function normJ(s: string) {
  return s.trim().toUpperCase();
}

function normFuel(s: string | undefined) {
  return (s ?? "diesel").toLowerCase();
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Validate a rate file (the shape in `data/ifta-rates/*.json`). Throws with a
 * message naming the bad entry — a silently skipped rate would surface later as
 * "rate unavailable" on someone's filing worksheet, far from the cause.
 */
export function parseIftaRateFile(input: unknown): IftaRateFile {
  if (!input || typeof input !== "object") {
    throw new Error("IFTA rate file must be a JSON object");
  }
  const record = input as Record<string, unknown>;
  const periodKey = record.periodKey;
  if (typeof periodKey !== "string" || !PERIOD_KEY.test(periodKey)) {
    throw new Error(`IFTA rate file has an invalid periodKey: ${String(periodKey)}`);
  }
  if (!Array.isArray(record.rates)) {
    throw new Error("IFTA rate file must have a `rates` array");
  }
  const rates = record.rates.map((raw, index): IftaRateEntry => {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const jurisdiction = typeof entry.jurisdiction === "string" ? normJ(entry.jurisdiction) : "";
    if (!/^[A-Z]{2}$/.test(jurisdiction)) {
      throw new Error(`rates[${index}]: jurisdiction must be a 2-letter code`);
    }
    if (!isNonNegativeNumber(entry.ratePerGallon)) {
      throw new Error(`rates[${index}] (${jurisdiction}): ratePerGallon must be a non-negative number`);
    }
    if (
      entry.surchargeRatePerGallon !== undefined &&
      !isNonNegativeNumber(entry.surchargeRatePerGallon)
    ) {
      throw new Error(`rates[${index}] (${jurisdiction}): surchargeRatePerGallon must be a non-negative number`);
    }
    return {
      jurisdiction,
      fuelType: normFuel(typeof entry.fuelType === "string" ? entry.fuelType : undefined),
      ratePerGallon: entry.ratePerGallon,
      surchargeRatePerGallon: entry.surchargeRatePerGallon as number | undefined,
    };
  });
  return {
    periodKey,
    source: typeof record.source === "string" ? record.source : undefined,
    rates,
  };
}

/** Build the worksheet's rate map for one fuel type (diesel by default). */
export function rateMapFromFile(file: IftaRateFile, fuelType = "diesel"): IftaRateMap {
  const wanted = normFuel(fuelType);
  const map = new Map<string, { ratePerGallon: number; surchargeRatePerGallon?: number }>();
  for (const r of file.rates) {
    if (normFuel(r.fuelType) !== wanted) continue;
    map.set(normJ(r.jurisdiction), {
      ratePerGallon: r.ratePerGallon,
      surchargeRatePerGallon: r.surchargeRatePerGallon,
    });
  }
  return map;
}

/**
 * In-memory rate store with the production upsert semantics. Idempotent on
 * (periodKey, jurisdiction, fuelType): rerunning a seed corrects a rate rather
 * than duplicating it. Swap for a real table behind the same three methods.
 */
export class InMemoryIftaRateStore {
  private readonly rows = new Map<string, StoredIftaRate>();

  private static key(periodKey: string, jurisdiction: string, fuelType: string) {
    return `${periodKey}|${jurisdiction}|${fuelType}`;
  }

  upsertRates(args: { periodKey: string; source?: string; rates: IftaRateEntry[] }, now = Date.now()) {
    let upserted = 0;
    for (const r of args.rates) {
      const jurisdiction = normJ(r.jurisdiction);
      const fuelType = normFuel(r.fuelType);
      this.rows.set(InMemoryIftaRateStore.key(args.periodKey, jurisdiction, fuelType), {
        periodKey: args.periodKey,
        jurisdiction,
        fuelType,
        ratePerGallon: r.ratePerGallon,
        surchargeRatePerGallon: r.surchargeRatePerGallon,
        currency: "USD",
        source: args.source,
        updatedAt: now,
      });
      upserted += 1;
    }
    return { upserted };
  }

  countRatesForPeriod(periodKey: string): number {
    let count = 0;
    for (const row of this.rows.values()) if (row.periodKey === periodKey) count += 1;
    return count;
  }

  // Dashboard read: which rates exist for a period (so users see coverage).
  listRates(periodKey: string) {
    return [...this.rows.values()]
      .filter((r) => r.periodKey === periodKey)
      .map((r) => ({
        jurisdiction: r.jurisdiction,
        fuelType: r.fuelType,
        ratePerGallon: r.ratePerGallon,
        surchargeRatePerGallon: r.surchargeRatePerGallon,
      }))
      .sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
  }

  rateMap(periodKey: string, fuelType = "diesel"): IftaRateMap {
    const wanted = normFuel(fuelType);
    const map = new Map<string, { ratePerGallon: number; surchargeRatePerGallon?: number }>();
    for (const r of this.rows.values()) {
      if (r.periodKey !== periodKey || r.fuelType !== wanted) continue;
      map.set(r.jurisdiction, {
        ratePerGallon: r.ratePerGallon,
        surchargeRatePerGallon: r.surchargeRatePerGallon,
      });
    }
    return map;
  }
}

/** `2026-Q2` for any UTC timestamp in April–June 2026. */
export function periodKeyForTimestamp(timestampMs: number): string {
  const d = new Date(timestampMs);
  const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${quarter}`;
}

/** Inclusive UTC millisecond range of a period key. */
export function quarterRange(periodKey: string): { startMs: number; endMs: number } {
  const match = PERIOD_KEY.exec(periodKey);
  if (!match) throw new Error(`invalid IFTA period key: ${periodKey}`);
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  return {
    startMs: Date.UTC(year, (quarter - 1) * 3, 1),
    endMs: Date.UTC(year, quarter * 3, 0, 23, 59, 59, 999),
  };
}

export type RateCoverageStatus =
  | { status: "not_in_window"; periodKey: string; daysLeft: number }
  | { status: "covered"; periodKey: string; daysLeft: number }
  | { status: "missing"; periodKey: string; daysLeft: number };

// REMINDER-ONLY rate coverage check. The official matrix has no stable feed,
// so a human seeds rates each quarter. Production runs this weekly and emails
// a platform ops address on `missing`: the current quarter's rates aren't
// loaded and the quarter is within ~3 weeks of ending (when the IFTA pack will
// need them). The short window + weekly cadence keeps it to a few nudges with
// no dedupe table.
export function checkRateCoverage(
  now: number,
  countRatesForPeriod: (periodKey: string) => number,
  windowDays = 21,
): RateCoverageStatus {
  const periodKey = periodKeyForTimestamp(now);
  const { endMs } = quarterRange(periodKey);
  const daysLeft = Math.ceil((endMs - now) / 86_400_000);
  if (daysLeft > windowDays) return { status: "not_in_window", periodKey, daysLeft };
  if (countRatesForPeriod(periodKey) > 0) return { status: "covered", periodKey, daysLeft };
  return { status: "missing", periodKey, daysLeft };
}
