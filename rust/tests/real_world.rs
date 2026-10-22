//! Real-boundary parity test: the bundled Natural Earth admin-1 file and the
//! synthetic I-20/I-75 trace must produce the miles pinned by the TypeScript
//! engine in `fixtures/attribution-boundaries-v1.json`.

use std::{fs, path::PathBuf};

use jurisdiction_engine::{
    TrackPoint, attribute_track_to_jurisdictions, parse_geojson_dataset, point_in_jurisdiction,
};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RealFixture {
    boundary_path: String,
    trace_path: String,
    miles_tolerance: f64,
    dataset_codes: Vec<String>,
    expected: Expected,
    probes: Vec<Probe>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expected {
    total_miles: f64,
    unattributed_miles: f64,
    by_jurisdiction: Vec<ExpectedRow>,
}

#[derive(Debug, Deserialize)]
struct ExpectedRow {
    jurisdiction: String,
    miles: f64,
}

#[derive(Debug, Deserialize)]
struct Probe {
    name: String,
    lat: f64,
    lng: f64,
    expected: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Trace {
    points: Vec<TrackPoint>,
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn read_json<T: for<'de> Deserialize<'de>>(relative: &str) -> T {
    let contents = fs::read_to_string(repo_root().join(relative))
        .unwrap_or_else(|error| panic!("{relative} should be readable: {error}"));
    serde_json::from_str(&contents).unwrap_or_else(|error| panic!("{relative} invalid: {error}"))
}

#[test]
fn real_boundaries_match_typescript_engine() {
    let fixture: RealFixture = read_json("fixtures/attribution-boundaries-v1.json");
    let geojson: Value = read_json(&fixture.boundary_path);
    let dataset = parse_geojson_dataset(&geojson).expect("bundled GeoJSON should parse");

    let mut codes: Vec<_> = dataset.iter().map(|j| j.code.clone()).collect();
    codes.sort();
    assert_eq!(codes, fixture.dataset_codes);

    let trace: Trace = read_json(&fixture.trace_path);
    let result = attribute_track_to_jurisdictions(&trace.points, &dataset);

    let mut actual = result.by_jurisdiction.clone();
    actual.sort_by(|left, right| left.jurisdiction.cmp(&right.jurisdiction));
    assert_eq!(
        actual
            .iter()
            .map(|r| r.jurisdiction.as_str())
            .collect::<Vec<_>>(),
        fixture
            .expected
            .by_jurisdiction
            .iter()
            .map(|r| r.jurisdiction.as_str())
            .collect::<Vec<_>>()
    );
    for (row, expected) in actual.iter().zip(&fixture.expected.by_jurisdiction) {
        assert!(
            (row.miles - expected.miles).abs() < fixture.miles_tolerance,
            "{}: rust {} vs ts {}",
            row.jurisdiction,
            row.miles,
            expected.miles
        );
    }
    assert!((result.total_miles - fixture.expected.total_miles).abs() < fixture.miles_tolerance);
    assert!(
        (result.unattributed_miles - fixture.expected.unattributed_miles).abs()
            < fixture.miles_tolerance
    );

    for probe in &fixture.probes {
        assert_eq!(
            point_in_jurisdiction(probe.lat, probe.lng, &dataset),
            probe.expected.as_deref(),
            "{}",
            probe.name
        );
    }
}
