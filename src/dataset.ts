import { ringBbox } from "./geo";
import type { JurisdictionDataset, JurisdictionPolygon, LngLat } from "./types";

// Property keys we look at (in order) to find a jurisdiction's 2-letter code in
// a GeoJSON Feature. Census uses STUSPS; Natural Earth uses postal/iso_3166_2.
const DEFAULT_CODE_KEYS = [
  "STUSPS",
  "postal",
  "iso_3166_2",
  "abbr",
  "state_abbr",
  "STATE_ABBR",
  "code",
];

// Property keys that may hold a full jurisdiction NAME (many public GeoJSON
// files carry only the name). Mapped to a 2-letter code via NAME_TO_CODE.
const DEFAULT_NAME_KEYS = ["name", "NAME", "NAME_1", "state_name", "STATE_NAME"];

// US states + DC + Canadian provinces/territories. Deterministic lookup, not
// fabricated data — lets name-only boundary files resolve to IFTA codes.
const NAME_TO_CODE: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
  california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI",
  idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  alberta: "AB", "british columbia": "BC", manitoba: "MB",
  "new brunswick": "NB", "newfoundland and labrador": "NL",
  "nova scotia": "NS", "northwest territories": "NT", nunavut: "NU",
  ontario: "ON", "prince edward island": "PE", quebec: "QC",
  québec: "QC", saskatchewan: "SK", yukon: "YT",
};

type GeoGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

interface GeoFeature {
  type: "Feature";
  properties?: Record<string, unknown> | null;
  geometry?: GeoGeometry | null;
}

interface GeoFeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

function extractCode(
  props: Record<string, unknown> | null | undefined,
  codeKeys: string[],
  nameKeys: string[],
): string | null {
  if (!props) return null;
  for (const key of codeKeys) {
    const value = props[key];
    if (typeof value !== "string") continue;
    const v = value.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(v)) return v;
    // ISO 3166-2 form like "US-GA" / "CA-ON" → take the subdivision part.
    const iso = /^(?:US|CA)-([A-Z]{2})$/.exec(v);
    if (iso) return iso[1];
  }
  // Fallback: resolve a full jurisdiction name to its 2-letter code.
  for (const key of nameKeys) {
    const value = props[key];
    if (typeof value === "string") {
      const code = NAME_TO_CODE[value.trim().toLowerCase()];
      if (code) return code;
    }
  }
  return null;
}

function asLngLatRings(rings: number[][][]): LngLat[][] {
  return rings.map((ring) => ring.map((c) => [c[0], c[1]] as LngLat));
}

// Parse a standard GeoJSON FeatureCollection of jurisdiction boundaries into the
// engine's dataset shape (with precomputed bbox). Features without a resolvable
// code or geometry are skipped. Multiple features sharing a code merge.
export function parseGeoJsonDataset(
  fc: GeoFeatureCollection,
  options?: { codeKeys?: string[]; nameKeys?: string[] },
): JurisdictionDataset {
  const codeKeys = options?.codeKeys ?? DEFAULT_CODE_KEYS;
  const nameKeys = options?.nameKeys ?? DEFAULT_NAME_KEYS;
  const byCode = new Map<string, LngLat[][][]>();

  for (const feature of fc.features ?? []) {
    const code = extractCode(feature.properties, codeKeys, nameKeys);
    const geom = feature.geometry;
    if (!code || !geom) continue;

    const polygons: LngLat[][][] =
      geom.type === "Polygon"
        ? [asLngLatRings(geom.coordinates)]
        : geom.type === "MultiPolygon"
          ? geom.coordinates.map((poly) => asLngLatRings(poly))
          : [];
    if (polygons.length === 0) continue;

    const existing = byCode.get(code);
    if (existing) existing.push(...polygons);
    else byCode.set(code, polygons);
  }

  const dataset: JurisdictionDataset = [];
  for (const [code, polygons] of byCode) {
    dataset.push({
      code,
      polygons,
      bbox: ringBbox(polygons),
    } satisfies JurisdictionPolygon);
  }
  return dataset;
}
