/**
 * D1 schema contracts.
 * Executable migrations live in drizzle/*.sql.
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

export type LotterySettings = {
  id: 1;
  revision: number;
  updated_at: number;
};

export type LotteryPrize = {
  id: string;
  sort_order: number;
  name: string;
  emoji: string;
  image: string;
  weight: number;
  stock: number;
  initial_stock: number;
  updated_at: number;
};

export const drawRecordsTable = "draw_records" as const;
export const lotterySettingsTable = "lottery_settings" as const;
export const lotteryPrizesTable = "lottery_prizes" as const;
