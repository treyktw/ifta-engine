//! Prints miles per jurisdiction for the bundled synthetic trace, from Rust.
//! Compare with `pnpm demo` — the numbers are identical.
//!
//! ```text
//! cargo run --manifest-path rust/Cargo.toml --example attribute_trace
//! ```

use std::{fs, path::PathBuf};

use jurisdiction_engine::{TrackPoint, attribute_track_to_jurisdictions, parse_geojson_dataset};
use serde::Deserialize;

#[derive(Deserialize)]
struct Trace {
    points: Vec<TrackPoint>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let geojson = serde_json::from_str(&fs::read_to_string(
        root.join("data/boundaries/us-ca-admin1.geojson"),
    )?)?;
    let dataset = parse_geojson_dataset(&geojson)?;
    let trace: Trace = serde_json::from_str(&fs::read_to_string(
        root.join("data/traces/dallas-to-cincinnati.json"),
    )?)?;

    let result = attribute_track_to_jurisdictions(&trace.points, &dataset);
    println!("{:<14}{:>12}", "Jurisdiction", "Miles");
    for row in &result.by_jurisdiction {
        println!("{:<14}{:>12.1}", row.jurisdiction, row.miles);
    }
    println!("{:<14}{:>12.1}", "Unattributed", result.unattributed_miles);
    println!("{:<14}{:>12.1}", "Total", result.total_miles);
    Ok(())
}
