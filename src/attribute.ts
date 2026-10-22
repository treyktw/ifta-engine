import { bboxContains, haversineMiles, pointInPolygon } from "./geo";
import type {
  AttributionResult,
  JurisdictionDataset,
  TrackPoint,
} from "./types";

// Which jurisdiction contains a point, or null if none. bbox prefilter then
// precise point-in-polygon. First match wins (datasets shouldn't overlap).
export function pointInJurisdiction(
  lat: number,
  lng: number,
  dataset: JurisdictionDataset,
): string | null {
  for (const j of dataset) {
    if (!bboxContains(j.bbox, lng, lat)) continue;
    for (const polygon of j.polygons) {
      if (pointInPolygon(lng, lat, polygon)) return j.code;
    }
  }
  return null;
}

// Attribute a GPS track's distance to jurisdictions. For each consecutive pair
// of points, the segment's miles are credited to the jurisdiction of its
// MIDPOINT (good enough at typical sampling; upgrade to boundary-split later).
// Points are sorted by recordedAt; out-of-order/duplicate timestamps tolerated.
export function attributeTrackToJurisdictions(
  points: TrackPoint[],
  dataset: JurisdictionDataset,
): AttributionResult {
  const sorted = [...points].sort((a, b) => a.recordedAt - b.recordedAt);
  const byJurisdiction = new Map<string, number>();
  let unattributedMiles = 0;
  let totalMiles = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const miles = haversineMiles(prev.lat, prev.lng, cur.lat, cur.lng);
    if (miles <= 0) continue;
    totalMiles += miles;

    const midLat = (prev.lat + cur.lat) / 2;
    const midLng = (prev.lng + cur.lng) / 2;
    const code = pointInJurisdiction(midLat, midLng, dataset);
    if (code) {
      byJurisdiction.set(code, (byJurisdiction.get(code) ?? 0) + miles);
    } else {
      unattributedMiles += miles;
    }
  }

  return {
    byJurisdiction: Array.from(byJurisdiction.entries())
      .map(([jurisdiction, miles]) => ({ jurisdiction, miles }))
      .sort((a, b) => b.miles - a.miles),
    unattributedMiles,
    totalMiles,
  };
}
