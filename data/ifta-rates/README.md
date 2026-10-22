# IFTA quarterly tax-rate matrix

Per-jurisdiction diesel fuel-tax rates that feed the worksheet's net-tax
estimate. Without a rate file for the period, the worksheet shows gallons only
(no $).

## Where the rates come from
The official **IFTA, Inc. quarterly tax rate matrix** (published ~6 weeks before
each quarter ends) at https://www.iftach.org/ — "Tax Rates" → the quarter's
matrix (PDF/Excel). Use the **Diesel / Special Diesel** column. A few states
(IN, KY, VA, …) also carry a **surcharge** — put it in
`surchargeRatePerGallon`.

`2026-Q2.json` covers the 48 contiguous states except Oregon (weight-mile tax,
no IFTA diesel rate — the worksheet shows "rate unavailable" for OR). It was
compiled from publicly listed IFTA quarterly rates, not transcribed from the
official matrix, so verify it against the official IFTA, Inc. rate matrix
before relying on it for a filing.

## Adding a period
1. Copy `TEMPLATE.json` to `<period>.json` (e.g. `2026-Q3.json`).
2. Fill `ratePerGallon` (USD/gal) per jurisdiction; add
   `surchargeRatePerGallon` where applicable.
3. `pnpm demo -- --rates data/ifta-rates/2026-Q3.json`

`parseIftaRateFile` validates the file and throws on a bad period key, a
non-2-letter jurisdiction or a negative rate.

## Net-tax math
`taxable gallons = jurisdiction miles ÷ fleet MPG`
`net taxable gallons = taxable gallons − tax-paid gallons`
`net tax = net taxable gallons × ratePerGallon + taxable gallons × surcharge`
A negative total = estimated **credit/refund**. Jurisdictions with no rate on
file show "rate unavailable" — never a fabricated figure.

## Future work
Automate: a quarterly script that pulls + parses the IFTA matrix instead of
manual transcription. Real rate names/columns vary by year, so parse defensively.
