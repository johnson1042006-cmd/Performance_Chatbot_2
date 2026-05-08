/**
 * Shared transcript export helpers used by /api/admin/export. Extracted
 * from the route handler so the CSV header/row shape is unit-testable.
 */

export const CSV_HEADER = [
  "session_id",
  "started_at",
  "closed_at",
  "status",
  "customer_email",
  "message_count",
  "ai_message_count",
  "intent",
  "topic_tags",
  "csat_rating",
  "agent_name",
] as const;

export interface ExportRow {
  session_id: string;
  started_at: string;
  closed_at: string | null;
  status: string;
  customer_email: string | null;
  message_count: number;
  ai_message_count: number;
  intent: string | null;
  topic_tags: string[] | null;
  csat_rating: string | null;
  agent_name: string | null;
}

/**
 * Per RFC 4180-ish CSV escaping. Wraps in double quotes when the value
 * contains a quote, comma, newline, or leading/trailing whitespace; doubles
 * any embedded quotes.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  if (/["\n\r,]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowToCsv(row: ExportRow): string {
  return [
    row.session_id,
    row.started_at ?? "",
    row.closed_at ?? "",
    row.status ?? "",
    row.customer_email ?? "",
    row.message_count,
    row.ai_message_count,
    row.intent ?? "",
    JSON.stringify(row.topic_tags ?? []),
    row.csat_rating ?? "",
    row.agent_name ?? "",
  ]
    .map(csvEscape)
    .join(",");
}

export function buildCsv(rows: ExportRow[]): string {
  const header = CSV_HEADER.join(",");
  const body = rows.map(rowToCsv).join("\n");
  return body ? `${header}\n${body}\n` : `${header}\n`;
}
