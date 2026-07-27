/**
 * D1 schema contract for draw records.
 * The executable migration lives in drizzle/0000_create_draw_records.sql.
 */
export type DrawRecord = {
  id: string;
  prize_id: string | null;
  prize_name: string;
  prize_emoji: string;
  draw_mode: "infinite" | "stock";
  draw_no: number;
  weight: number;
  stock_after: number;
  drawn_at: number;
  client_timezone: string;
  received_at: number;
};

export const drawRecordsTable = "draw_records" as const;
