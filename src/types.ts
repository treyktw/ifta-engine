// GeoJSON coordinate order is [longitude, latitude].
export type LngLat = [number, number];

// A jurisdiction (US state / Canadian province) as one or more polygons.
// polygons: MultiPolygon — array of polygons; each polygon is an array of
// linear rings (ring 0 = outer boundary, rings 1+ = holes); each ring is a
// closed list of [lng, lat] coordinates.
export interface JurisdictionPolygon {
  code: string; // e.g. "GA", "ON"
  polygons: LngLat[][][];
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
}

export type JurisdictionDataset = JurisdictionPolygon[];

export interface TrackPoint {
  lat: number;
  lng: number;
  recordedAt: number; // epoch ms
}

export interface JurisdictionMiles {
  jurisdiction: string;
  miles: number;
}

export interface AttributionResult {
  byJurisdiction: JurisdictionMiles[];
  // Miles whose midpoint fell outside every jurisdiction (offshore, gaps in
  // coverage, bad fixes). Surfaced so callers can flag low-confidence tracks.
  unattributedMiles: number;
  totalMiles: number;
}
