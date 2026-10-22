# Boundary data

`us-ca-admin1.geojson` — US states, DC and Canadian provinces/territories (64
features), from **Natural Earth** 1:50m Admin-1 States/Provinces
(`ne_50m_admin_1_states_provinces`, via github.com/nvkelso/natural-earth-vector).
Natural Earth data is in the **public domain**.

Reduced for this repo: filtered to `iso_a2 ∈ {US, CA}`, properties trimmed to
`name`, `postal`, `iso_3166_2`, `iso_a2`, and coordinates rounded to 3 decimal
places (~110 m). That is fine for a demo; for filing-grade attribution use a
higher-resolution source such as the US Census cartographic boundary files
(`cb_*_us_state_500k`, key `STUSPS`) — the engine auto-detects either.
