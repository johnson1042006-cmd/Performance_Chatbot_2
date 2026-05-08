import { describe, it, expect } from "vitest";
import {
  CSV_HEADER,
  ExportRow,
  buildCsv,
  csvEscape,
  rowToCsv,
} from "@/lib/export/transcripts";

const SAMPLE_ROW: ExportRow = {
  session_id: "00000000-0000-0000-0000-000000000001",
  started_at: "2026-05-01T10:00:00Z",
  closed_at: "2026-05-01T10:14:00Z",
  status: "closed",
  customer_email: "test@example.com",
  message_count: 12,
  ai_message_count: 7,
  intent: "order_status",
  topic_tags: ["order-12345", "shipping"],
  csat_rating: "up",
  agent_name: "Casey Agent",
};

describe("csvEscape", () => {
  it("returns empty string for null/undefined", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("leaves simple strings unquoted", () => {
    expect(csvEscape("hello")).toBe("hello");
  });

  it("quotes values with commas/newlines/quotes", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("buildCsv", () => {
  it("emits the documented header in the documented order", () => {
    const csv = buildCsv([]);
    expect(csv.split("\n")[0]).toBe(
      "session_id,started_at,closed_at,status,customer_email,message_count,ai_message_count,intent,topic_tags,csat_rating,agent_name"
    );
    // Sanity check: explicit list also matches header constant
    expect(CSV_HEADER.join(",")).toBe(
      "session_id,started_at,closed_at,status,customer_email,message_count,ai_message_count,intent,topic_tags,csat_rating,agent_name"
    );
  });

  it("serializes one row matching the documented column shape", () => {
    const csv = buildCsv([SAMPLE_ROW]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(2);
    const cells = parseCsvLine(lines[1]);
    expect(cells).toEqual([
      SAMPLE_ROW.session_id,
      SAMPLE_ROW.started_at,
      SAMPLE_ROW.closed_at,
      SAMPLE_ROW.status,
      SAMPLE_ROW.customer_email,
      String(SAMPLE_ROW.message_count),
      String(SAMPLE_ROW.ai_message_count),
      SAMPLE_ROW.intent,
      JSON.stringify(SAMPLE_ROW.topic_tags),
      SAMPLE_ROW.csat_rating,
      SAMPLE_ROW.agent_name,
    ]);
  });

  it("encodes topic_tags as JSON inside the cell", () => {
    const csv = rowToCsv(SAMPLE_ROW);
    const cells = parseCsvLine(csv);
    const topicCell = cells[8];
    expect(JSON.parse(topicCell)).toEqual(["order-12345", "shipping"]);
  });

  it("handles empty topic_tags as []", () => {
    const csv = rowToCsv({ ...SAMPLE_ROW, topic_tags: [] });
    const cells = parseCsvLine(csv);
    expect(cells[8]).toBe("[]");
  });

  it("emits empty strings for nullable columns", () => {
    const minimal: ExportRow = {
      ...SAMPLE_ROW,
      closed_at: null,
      customer_email: null,
      intent: null,
      topic_tags: null,
      csat_rating: null,
      agent_name: null,
    };
    const cells = parseCsvLine(rowToCsv(minimal));
    expect(cells[2]).toBe("");
    expect(cells[4]).toBe("");
    expect(cells[7]).toBe("");
    expect(cells[8]).toBe("[]");
    expect(cells[9]).toBe("");
    expect(cells[10]).toBe("");
  });
});

// Tiny RFC4180-ish CSV line parser for assertions.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  out.push(cur);
  return out;
}
