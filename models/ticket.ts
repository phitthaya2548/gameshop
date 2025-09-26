// source_models/ticket.ts

export type TicketStatus = "AVAILABLE" | "SOLD" | "REDEEMED" | "CANCELLED";

export class Ticket {
  id?: number;
  draw_id: number;
  ticket_number: string;   // 6 หลัก
  price: number;
  status: TicketStatus;
  buyer_user_id?: number | null;
  sold_at?: Date | null;
  created_at?: Date;

  constructor(
    draw_id: number,
    ticket_number: string,
    price: number = 100.0,
    status: TicketStatus = "AVAILABLE",
    opts?: Partial<Ticket>
  ) {
    this.id = opts?.id;
    this.draw_id = draw_id;
    this.ticket_number = ticket_number;
    this.price = price;
    this.status = status;
    this.buyer_user_id = opts?.buyer_user_id ?? null;
    this.sold_at = opts?.sold_at ?? null;
    this.created_at = opts?.created_at ?? new Date();
  }

  /** ใช้เวลา INSERT */
  toInsertParams() {
    return [
      this.draw_id,
      this.ticket_number,
      this.price,
      this.status,
      this.buyer_user_id,
    ];
  }

  /** ใช้เวลาส่ง API response */
  toJSON() {
    return {
      id: this.id,
      drawId: this.draw_id,
      ticketNumber: this.ticket_number,
      price: this.price,
      status: this.status,
      buyerUserId: this.buyer_user_id,
      soldAt: this.sold_at,
      createdAt: this.created_at,
    };
  }

  /** static helper แปลงจาก row DB -> Ticket */
  static fromRow(row: any): Ticket {
    return new Ticket(
      row.draw_id,
      row.ticket_number,
      Number(row.price),
      row.status as TicketStatus,
      {
        id: row.id,
        buyer_user_id: row.buyer_user_id,
        sold_at: row.sold_at ? new Date(row.sold_at) : null,
        created_at: row.created_at ? new Date(row.created_at) : undefined,
      }
    );
  }
}
