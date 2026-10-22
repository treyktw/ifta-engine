/**
 * End-to-end demo: public boundaries + synthetic GPS trace + synthetic fuel log
 * → miles per jurisdiction → IFTA quarterly worksheet with tax due / credit.
 *
 *   pnpm demo
 *   pnpm demo -- --trace path/to/trace.json --fuel path/to/fuel.json --rates path/to/2026-Q3.json
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  attributeTrackToJurisdictions,
  buildIftaQuarterlyPackSection,
  parseGeoJsonDataset,
  parseIftaRateFile,
  rateMapFromFile,
  type ReportSection,
  type TrackPoint,
} from "../src/index";

const root = resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  // `pnpm <script> -- --flag` forwards the literal "--"; drop it.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    boundaries: { type: "string", default: "data/boundaries/us-ca-admin1.geojson" },
    trace: { type: "string", default: "data/traces/dallas-to-cincinnati.json" },
    fuel: { type: "string", default: "data/fuel/synthetic-fuel-log.json" },
    rates: { type: "string", default: "data/ifta-rates/2026-Q2.json" },
  },
});

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(root, path), "utf8")) as T;
}

const TEXT_COLUMNS = new Set(["Jurisdiction", "Status"]);

function printTable(columns: string[], rows: Array<Record<string, unknown>>) {
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) =>
        TEXT_COLUMNS.has(columns[i]) ? cell.padEnd(widths[i]) : cell.padStart(widths[i]),
      )
      .join("  ")
      .trimEnd();
  console.log(line(columns));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(columns.map((c) => String(row[c] ?? ""))));
}

function printSection(section: ReportSection) {
  console.log(`\n${section.title}`);
  console.log("=".repeat(section.title.length));
  for (const metric of section.summary ?? []) console.log(`${metric.label.padEnd(32)} ${metric.value}`);
  console.log();
  printTable(section.columns, section.rows);
  if (section.description) console.log(`\n${section.description}`);
}

const started = performance.now();
const dataset = parseGeoJsonDataset(readJson(values.boundaries!));
const trace = readJson<{ points: TrackPoint[] }>(values.trace!);
const fuel = readJson<{
  purchases: Array<{ purchasedAt: string; jurisdiction: string; gallons: number; totalCost: number }>;
}>(values.fuel!);
const rateFile = parseIftaRateFile(readJson(values.rates!));

const attribution = attributeTrackToJurisdictions(trace.points, dataset);
const elapsedMs = performance.now() - started;

console.log(`Boundaries: ${values.boundaries} (${dataset.length} jurisdictions)`);
console.log(`Trace:      ${values.trace} (${trace.points.length} GPS fixes)`);
console.log(`Fuel log:   ${values.fuel} (${fuel.purchases.length} receipts)`);
console.log(`Rates:      ${values.rates} (${rateFile.periodKey}, ${rateFile.rates.length} jurisdictions)`);
console.log(`Parsed + attributed in ${elapsedMs.toFixed(0)} ms`);

console.log("\nMiles by jurisdiction");
console.log("=====================");
printTable(
  ["Jurisdiction", "Miles", "Share"],
  [
    ...attribution.byJurisdiction.map((row) => ({
      Jurisdiction: row.jurisdiction,
      Miles: row.miles.toFixed(1),
      Share: `${((row.miles / attribution.totalMiles) * 100).toFixed(1)}%`,
    })),
    { Jurisdiction: "(unattributed)", Miles: attribution.unattributedMiles.toFixed(1), Share: "" },
    { Jurisdiction: "Total", Miles: attribution.totalMiles.toFixed(1), Share: "" },
  ],
);

printSection(
  buildIftaQuarterlyPackSection({
    miles: attribution.byJurisdiction,
    fuelRows: fuel.purchases,
    rates: rateMapFromFile(rateFile),
  }),
);
