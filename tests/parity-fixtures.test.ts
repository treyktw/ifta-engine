import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { attributeTrackToJurisdictions, pointInJurisdiction } from "../src/attribute";
import { parseGeoJsonDataset } from "../src/dataset";
import type {
  JurisdictionDataset,
  TrackPoint,
} from "../src/types";

type Fixture = {
  dataset: JurisdictionDataset;
  cases: Array<{
    name: string;
    points: TrackPoint[];
    expectedJurisdictions: string[];
    unattributed: boolean;
  }>;
};

const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../fixtures/attribution-v1.json",
    ),
    "utf8",
  ),
) as Fixture;

describe("shared TS/Rust jurisdiction fixtures (synthetic squares)", () => {
  it.each(fixture.cases)("$name", (testCase) => {
    const result = attributeTrackToJurisdictions(
      testCase.points,
      fixture.dataset,
    );
    expect(
      result.byJurisdiction
        .map((row) => row.jurisdiction)
        .sort(),
    ).toEqual(testCase.expectedJurisdictions);
    expect(result.unattributedMiles > 0).toBe(testCase.unattributed);
  });
});

type RealFixture = {
  boundaryPath: string;
  tracePath: string;
  milesTolerance: number;
  datasetCodes: string[];
  expected: {
    totalMiles: number;
    unattributedMiles: number;
    byJurisdiction: Array<{ jurisdiction: string; miles: number }>;
  };
  probes: Array<{ name: string; lat: number; lng: number; expected: string | null }>;
};

const repoRoot = resolve(__dirname, "..");
const realFixture = JSON.parse(
  readFileSync(resolve(repoRoot, "fixtures/attribution-boundaries-v1.json"), "utf8"),
) as RealFixture;

// Same file the Rust test reads (rust/tests/fixtures.rs). If this passes in
// both languages, both engines produce the same miles from the same inputs.
describe("shared TS/Rust jurisdiction fixtures (Natural Earth + synthetic I-20/I-75 trace)", () => {
  const dataset = parseGeoJsonDataset(
    JSON.parse(readFileSync(resolve(repoRoot, realFixture.boundaryPath), "utf8")),
  );
  const trace = JSON.parse(
    readFileSync(resolve(repoRoot, realFixture.tracePath), "utf8"),
  ) as { points: TrackPoint[] };

  it("auto-detects every US state, DC and Canadian province from the bundled file", () => {
    expect(dataset.map((j) => j.code).sort()).toEqual(realFixture.datasetCodes);
    expect(realFixture.datasetCodes).toHaveLength(64);
  });

  it("attributes the trace to the pinned per-jurisdiction miles", () => {
    const result = attributeTrackToJurisdictions(trace.points, dataset);
    const actual = [...result.byJurisdiction].sort((a, b) =>
      a.jurisdiction.localeCompare(b.jurisdiction),
    );
    expect(actual.map((r) => r.jurisdiction)).toEqual(
      realFixture.expected.byJurisdiction.map((r) => r.jurisdiction),
    );
    actual.forEach((row, index) => {
      expect(
        Math.abs(row.miles - realFixture.expected.byJurisdiction[index].miles),
      ).toBeLessThan(realFixture.milesTolerance);
    });
    expect(
      Math.abs(result.totalMiles - realFixture.expected.totalMiles),
    ).toBeLessThan(realFixture.milesTolerance);
    expect(result.unattributedMiles).toBeCloseTo(
      realFixture.expected.unattributedMiles,
      6,
    );
  });

  it.each(realFixture.probes)("locates $name", (probe) => {
    expect(pointInJurisdiction(probe.lat, probe.lng, dataset)).toBe(probe.expected);
  });
});
