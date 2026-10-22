//! Offline jurisdiction mileage projections ported from the TypeScript
//! jurisdiction engine in this repository (`../src`).
//!
//! Final IFTA and reporting totals remain authoritative on the server; this
//! crate exists so a mobile client can show the same numbers offline.

mod attribution;
mod dataset;
mod geometry;
mod types;

pub use attribution::{attribute_track_to_jurisdictions, point_in_jurisdiction};
pub use dataset::{DatasetError, parse_geojson_dataset};
pub use geometry::{bbox_contains, haversine_miles, point_in_polygon, point_in_ring, polygon_bbox};
pub use types::{
    AttributionResult, BoundingBox, Jurisdiction, JurisdictionDataset, JurisdictionMiles, LngLat,
    TrackPoint,
};
