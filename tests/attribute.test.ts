import { describe, expect, it } from "vitest";
import {
  attributeTrackToJurisdictions,
  haversineMiles,
  parseGeoJsonDataset,
  pointInJurisdiction,
  ringBbox,
} from "../src/index";
import type { JurisdictionPolygon, LngLat } from "../src/index";

// Two adjacent unit squares sharing the lng=1 edge.
// AA: lng [0,1], BB: lng [1,2]; both lat [0,1].
function square(
  code: string,
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
): JurisdictionPolygon {
  const ring: LngLat[] = [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat],
  ];
  const polygons = [[ring]];
  return { code, polygons, bbox: ringBbox(polygons) };
}

const DATASET = [
  square("AA", 0, 0, 1, 1),
  square("BB", 1, 0, 2, 1),
];

describe("pointInJurisdiction", () => {
  it("locates a point inside a jurisdiction (lat, lng order)", () => {
    expect(pointInJurisdiction(0.5, 0.5, DATASET)).toBe("AA");
    expect(pointInJurisdiction(0.5, 1.5, DATASET)).toBe("BB");
  });

  it("returns null outside all jurisdictions", () => {
    expect(pointInJurisdiction(5, 5, DATASET)).toBeNull();
    expect(pointInJurisdiction(-1, -1, DATASET)).toBeNull();
  });
});

describe("haversineMiles", () => {
  it("≈69 miles per degree of latitude", () => {
    const d = haversineMiles(0, 0, 1, 0);
    expect(d).toBeGreaterThan(68);
    expect(d).toBeLessThan(70);
  });

  it("is zero for identical points", () => {
    expect(haversineMiles(40, -90, 40, -90)).toBe(0);
  });
});

describe("attributeTrackToJurisdictions", () => {
  it("splits a crossing track across jurisdictions by segment midpoint", () => {
    // seg1 midpoint lng .725 → AA; seg2 midpoint lng 1.225 → BB.
    const result = attributeTrackToJurisdictions(
      [
        { lat: 0.5, lng: 0.5, recordedAt: 1 },
        { lat: 0.5, lng: 0.95, recordedAt: 2 },
        { lat: 0.5, lng: 1.5, recordedAt: 3 },
      ],
      DATASET,
    );
    const codes = result.byJurisdiction.map((b) => b.jurisdiction).sort();
    expect(codes).toEqual(["AA", "BB"]);
    expect(result.unattributedMiles).toBe(0);
    for (const b of result.byJurisdiction) expect(b.miles).toBeGreaterThan(0);
    expect(result.totalMiles).toBeCloseTo(
      result.byJurisdiction.reduce((s, b) => s + b.miles, 0),
      6,
    );
  });

  it("sorts out-of-order points by recordedAt", () => {
    const ordered = attributeTrackToJurisdictions(
      [
        { lat: 0.5, lng: 0.2, recordedAt: 1 },
        { lat: 0.5, lng: 0.8, recordedAt: 2 },
      ],
      DATASET,
    );
    const shuffled = attributeTrackToJurisdictions(
      [
        { lat: 0.5, lng: 0.8, recordedAt: 2 },
        { lat: 0.5, lng: 0.2, recordedAt: 1 },
      ],
      DATASET,
    );
    expect(shuffled.totalMiles).toBeCloseTo(ordered.totalMiles, 9);
    expect(shuffled.byJurisdiction).toEqual(ordered.byJurisdiction);
  });

  it("counts miles outside coverage as unattributed", () => {
    const result = attributeTrackToJurisdictions(
      [
        { lat: 10, lng: 10, recordedAt: 1 },
        { lat: 10, lng: 10.5, recordedAt: 2 },
      ],
      DATASET,
    );
    expect(result.byJurisdiction).toHaveLength(0);
    expect(result.unattributedMiles).toBeGreaterThan(0);
    expect(result.unattributedMiles).toBeCloseTo(result.totalMiles, 9);
  });

  it("ignores zero-distance duplicate fixes", () => {
    const result = attributeTrackToJurisdictions(
      [
        { lat: 0.5, lng: 0.5, recordedAt: 1 },
        { lat: 0.5, lng: 0.5, recordedAt: 2 },
      ],
      DATASET,
    );
    expect(result.totalMiles).toBe(0);
    expect(result.byJurisdiction).toHaveLength(0);
  });
});

describe("parseGeoJsonDataset", () => {
  it("parses a FeatureCollection and resolves codes", () => {
    const dataset = parseGeoJsonDataset({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { STUSPS: "ZZ" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
                [0, 0],
              ],
            ],
          },
        },
      ],
    });
    expect(dataset).toHaveLength(1);
    expect(dataset[0].code).toBe("ZZ");
    expect(pointInJurisdiction(0.5, 0.5, dataset)).toBe("ZZ");
  });

  it("computes a finite bbox (regression: max must init to -Infinity)", () => {
    const dataset = parseGeoJsonDataset({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { STUSPS: "GA" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-85, 30],
                [-81, 30],
                [-81, 35],
                [-85, 35],
                [-85, 30],
              ],
            ],
          },
        },
      ],
    });
    expect(dataset[0].bbox).toEqual([-85, 30, -81, 35]);
    expect(dataset[0].bbox.every((n) => Number.isFinite(n))).toBe(true);
  });

  it("resolves full state names and ISO 3166-2 codes", () => {
    const ds = parseGeoJsonDataset({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Georgia" },
          geometry: {
            type: "Polygon",
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
          },
        },
        {
          type: "Feature",
          properties: { iso_3166_2: "CA-ON" },
          geometry: {
            type: "Polygon",
            coordinates: [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]],
          },
        },
      ],
    });
    const codes = ds.map((d) => d.code).sort();
    expect(codes).toEqual(["GA", "ON"]);
  });

  it("merges MultiPolygon and skips features without a code", () => {
    const dataset = parseGeoJsonDataset({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { postal: "MP" },
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            ],
          },
        },
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [5, 5],
                [6, 5],
                [6, 6],
                [5, 6],
                [5, 5],
              ],
            ],
          },
        },
      ],
    });
    expect(dataset).toHaveLength(1);
    expect(dataset[0].code).toBe("MP");
  });
});
