// source_models/draw.ts
export type DrawStatus = "OPEN" | "CLOSED";
export type Drawsource_mode = "ALL" | "SOLD_ONLY";

export class Draw {
  id?: number;
  draw_number: number;
  draw_date: Date;
  status: DrawStatus;
  source_mode: Drawsource_mode;

  win1_full?: string | null;
  win2_full?: string | null;
  win3_full?: string | null;
  win_last3?: string | null;
  win_last2?: string | null;

  unique_exact?: boolean; // <- เพิ่มชนิดให้ชัดเจน

  prize1_amount: number;
  prize2_amount: number;
  prize3_amount: number;
  last3_amount: number;
  last2_amount: number;

  createdAt: Date;
  closedAt?: Date | null;

  constructor(
    draw_number: number,
    draw_date: Date,
    status: DrawStatus = "OPEN",
    opts?: Partial<Draw>
  ) {
    this.id = opts?.id;
    this.draw_number = draw_number;
    this.draw_date = draw_date;
    this.status = status;

    this.source_mode = opts?.source_mode ?? "ALL";
    this.win1_full = opts?.win1_full ?? null;
    this.win2_full = opts?.win2_full ?? null;
    this.win3_full = opts?.win3_full ?? null;
    this.win_last3 = opts?.win_last3 ?? null;
    this.win_last2 = opts?.win_last2 ?? null;

    this.unique_exact = opts?.unique_exact ?? true;

    this.prize1_amount = opts?.prize1_amount ?? 0;
    this.prize2_amount = opts?.prize2_amount ?? 0;
    this.prize3_amount = opts?.prize3_amount ?? 0;
    this.last3_amount  = opts?.last3_amount  ?? 0;
    this.last2_amount  = opts?.last2_amount  ?? 0;

    this.createdAt = opts?.createdAt ?? new Date();
    this.closedAt  = opts?.closedAt  ?? null;
  }


  toInsertParams(statusOverride?: DrawStatus) {
    return [
      this.draw_number,
      this.draw_date,
      statusOverride ?? this.status,
      this.source_mode,
      this.win1_full,
      this.win2_full,
      this.win3_full,
      this.win_last3,
      this.win_last2,
      this.prize1_amount,
      this.prize2_amount,
      this.prize3_amount,
      this.last3_amount,
      this.last2_amount,
    ];
  }
  
}
