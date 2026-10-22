// Minimal report-section shape the IFTA worksheet renders into. In production
// the same shape feeds both the CSV and the PDF serializers; here the demo
// prints it as a table.

export type SummaryMetric = { label: string; value: string };
export type ReportSectionRow = Record<string, string | number | null>;
export type ReportSection = {
  title: string;
  description?: string;
  columns: string[];
  rows: ReportSectionRow[];
  summary?: SummaryMetric[];
};

export function formatCurrency(value: number | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

export function formatNumber(value: number | undefined, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value ?? 0);
}
