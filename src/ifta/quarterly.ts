import {
  formatCurrency,
  formatNumber,
  type ReportSection,
  type ReportSectionRow,
  type SummaryMetric,
} from "./report";
import type { IftaRateMap } from "./rates";

// Fallback fleet fuel economy (mpg) when neither computed MPG (no fuel data)
// nor an org override is available. Conservative class-8 average.
export const DEFAULT_FLEET_MPG = 6.0;

export type IftaMilesInput = Iterable<{ jurisdiction: string; miles: number }>;

export type IftaFuelPurchase = {
  jurisdiction: string;
  gallons: number;
  totalCost: number;
};

export type IftaQuarterlyArgs = {
  /** Miles per jurisdiction, e.g. `attributeTrackToJurisdictions(...).byJurisdiction`. */
  miles: IftaMilesInput;
  /** Tax-paid fuel purchases for the quarter. */
  fuelRows: IftaFuelPurchase[];
  /** Fleet MPG override used only when there is no fuel data at all. */
  fallbackMpg?: number;
  rates?: IftaRateMap;
};

export type MpgSource =
  | "computed from fuel + miles"
  | "org default (no fuel data)"
  | "platform default (no fuel data)";

export type IftaJurisdictionLine = {
  jurisdiction: string;
  taxableMiles: number;
  taxableGallons: number;
  taxPaidGallons: number;
  netTaxableGallons: number;
  missingFuel: boolean;
  /** Undefined when no rates are loaded for the period at all. */
  ratePerGallon?: number;
  surchargeRatePerGallon?: number;
  /** Positive = tax due, negative = credit. Undefined when the rate is unknown. */
  netTax?: number;
  rateStatus: "no-rates-loaded" | "ok" | "rate-unavailable";
};

export type IftaQuarterlyResult = {
  fleetMpg: number;
  mpgSource: MpgSource;
  totalMiles: number;
  totalGallons: number;
  haveRates: boolean;
  lines: IftaJurisdictionLine[];
  /** Jurisdictions with miles but no fuel receipts. */
  incomplete: string[];
  /** Jurisdictions with activity but no rate on file. */
  missingRates: string[];
  /** Sum of the per-jurisdiction net tax that could be computed. */
  netTaxTotal: number;
  /** False when any jurisdiction's rate was missing (the total is partial). */
  netTaxComplete: boolean;
};

// IFTA quarterly worksheet using the standard fleet-MPG method: fleet MPG =
// total fleet miles ÷ total fleet gallons, then taxable gallons per
// jurisdiction = jurisdiction miles ÷ fleet MPG. Deterministic. Net tax is only
// computed when a quarterly rate matrix is supplied — rates change every
// quarter, so without one the worksheet reports gallons, never a fabricated
// dollar figure.
export function computeIftaQuarterly(args: IftaQuarterlyArgs): IftaQuarterlyResult {
  const milesByJurisdiction = new Map<string, number>();
  for (const state of args.miles) {
    const key = state.jurisdiction.trim().toUpperCase();
    milesByJurisdiction.set(
      key,
      (milesByJurisdiction.get(key) ?? 0) + state.miles,
    );
  }
  const gallonsByJurisdiction = new Map<string, number>();
  for (const fuel of args.fuelRows) {
    const key = fuel.jurisdiction.trim().toUpperCase();
    gallonsByJurisdiction.set(
      key,
      (gallonsByJurisdiction.get(key) ?? 0) + fuel.gallons,
    );
  }

  const totalMiles = [...milesByJurisdiction.values()].reduce(
    (sum, miles) => sum + miles,
    0,
  );
  const totalGallons = [...gallonsByJurisdiction.values()].reduce(
    (sum, gallons) => sum + gallons,
    0,
  );
  const fleetMpg =
    totalGallons > 0
      ? totalMiles / totalGallons
      : args.fallbackMpg && args.fallbackMpg > 0
        ? args.fallbackMpg
        : DEFAULT_FLEET_MPG;
  const mpgSource: MpgSource =
    totalGallons > 0
      ? "computed from fuel + miles"
      : args.fallbackMpg && args.fallbackMpg > 0
        ? "org default (no fuel data)"
        : "platform default (no fuel data)";

  const jurisdictions = Array.from(
    new Set([
      ...milesByJurisdiction.keys(),
      ...gallonsByJurisdiction.keys(),
    ]),
  ).sort();

  const rates = args.rates;
  const haveRates = rates != null && rates.size > 0;

  const incomplete: string[] = [];
  const missingRates: string[] = [];
  let netTaxTotal = 0;
  let netTaxComplete = haveRates;
  const lines: IftaJurisdictionLine[] = jurisdictions.map((jurisdiction) => {
    const miles = milesByJurisdiction.get(jurisdiction) ?? 0;
    const taxPaidGallons = gallonsByJurisdiction.get(jurisdiction) ?? 0;
    const taxableGallons = fleetMpg > 0 ? miles / fleetMpg : 0;
    const netTaxableGallons = taxableGallons - taxPaidGallons;
    const missingFuel = miles > 0 && taxPaidGallons === 0;
    if (missingFuel) incomplete.push(jurisdiction);

    const line: IftaJurisdictionLine = {
      jurisdiction,
      taxableMiles: miles,
      taxableGallons,
      taxPaidGallons,
      netTaxableGallons,
      missingFuel,
      rateStatus: "no-rates-loaded",
    };

    const rate = rates?.get(jurisdiction);
    if (haveRates) {
      if (rate) {
        // The surcharge (IN, KY, VA, …) is owed on every taxable gallon
        // consumed in the jurisdiction; fuel tax paid at the pump does not
        // offset it, so it applies to taxable — not net taxable — gallons.
        const netTax =
          netTaxableGallons * rate.ratePerGallon +
          taxableGallons * (rate.surchargeRatePerGallon ?? 0);
        netTaxTotal += netTax;
        line.ratePerGallon = rate.ratePerGallon;
        line.surchargeRatePerGallon = rate.surchargeRatePerGallon;
        line.netTax = netTax;
        line.rateStatus = "ok";
      } else {
        missingRates.push(jurisdiction);
        line.rateStatus = "rate-unavailable";
        netTaxComplete = false;
      }
    }
    return line;
  });

  return {
    fleetMpg,
    mpgSource,
    totalMiles,
    totalGallons,
    haveRates,
    lines,
    incomplete,
    missingRates,
    netTaxTotal,
    netTaxComplete,
  };
}

// The production report section: same math, rendered for the CSV/PDF pack.
export function buildIftaQuarterlyPackSection(args: IftaQuarterlyArgs): ReportSection {
  const result = computeIftaQuarterly(args);
  const { haveRates, incomplete, missingRates } = result;

  const rows: ReportSectionRow[] = result.lines.map((line) => {
    const row: ReportSectionRow = {
      Jurisdiction: line.jurisdiction,
      "Taxable Miles": formatNumber(line.taxableMiles, 0),
      "Taxable Gallons": formatNumber(line.taxableGallons, 1),
      "Tax-Paid Gallons": formatNumber(line.taxPaidGallons, 1),
      "Net Taxable Gallons": formatNumber(line.netTaxableGallons, 1),
      Status: line.missingFuel ? "Missing fuel receipts" : "OK",
    };
    if (haveRates) {
      row["Rate $/gal"] =
        line.ratePerGallon !== undefined ? formatCurrency(line.ratePerGallon) : "—";
      row["Net Tax"] =
        line.netTax !== undefined ? formatCurrency(line.netTax) : "rate unavailable";
    }
    return row;
  });

  const description =
    "ESTIMATE — review with your accountant before filing. Net taxable gallons = jurisdiction miles ÷ fleet MPG − tax-paid gallons." +
    (haveRates
      ? " Net tax = net taxable gallons × jurisdiction rate (+ surcharge). Rates are the loaded quarterly matrix; verify before filing."
      : " Per-jurisdiction tax rates are not loaded for this period — net tax is left to the filer.") +
    (incomplete.length > 0
      ? ` Incomplete jurisdictions with miles but no fuel receipts: ${incomplete.join(", ")}.`
      : "") +
    (missingRates.length > 0
      ? ` No rate on file for: ${missingRates.join(", ")}.`
      : "");

  const summary: SummaryMetric[] = [
    { label: "Fleet MPG", value: `${formatNumber(result.fleetMpg, 2)} (${result.mpgSource})` },
    { label: "Total miles", value: formatNumber(result.totalMiles, 0) },
    { label: "Total gallons purchased", value: formatNumber(result.totalGallons, 1) },
    { label: "Jurisdictions", value: String(result.lines.length) },
    { label: "Incomplete jurisdictions", value: String(incomplete.length) },
  ];
  if (haveRates) {
    summary.push({
      label: result.netTaxComplete
        ? "Estimated net tax due/(refund)"
        : "Estimated net tax (partial)",
      value: formatCurrency(result.netTaxTotal),
    });
  }

  const columns = [
    "Jurisdiction",
    "Taxable Miles",
    "Taxable Gallons",
    "Tax-Paid Gallons",
    "Net Taxable Gallons",
    ...(haveRates ? ["Rate $/gal", "Net Tax"] : []),
    "Status",
  ];

  return { title: "IFTA Quarterly Worksheet", description, summary, columns, rows };
}
