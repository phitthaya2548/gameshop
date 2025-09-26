import type { RequestHandler } from "express";
import express from "express";
import { conn } from "../db";

export const router = express.Router();

router.get("/check", async (req, res) => {
  const drawId = Number(req.query.drawId);
  const number = String(req.query.number ?? "").trim();

  if (!Number.isInteger(drawId) || !/^\d{6}$/.test(number)) {
    res.status(400).json({
      success: false,
      message: "drawId:int & number:6 digits required",
    });
  }

  const [rows] = await conn
    .promise()
    .query(
      `SELECT status FROM tickets WHERE draw_id=? AND ticket_number=? LIMIT 1`,
      [drawId, number]
    );

  const found = (rows as any[])[0];

  res.json({
    success: true,
    drawId,
    ticketNumber: number,
    canBuy: !found, // ไม่มีแถว = ยังไม่ถูกซื้อ = ซื้อได้
    currentStatus: found?.status ?? null,
  });
});

const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const getTicketsByBuyer: RequestHandler = async (req, res) => {
  const drawNumber = Number(req.query.drawNumber ?? req.query.draw_number);
  const buyerId = Number(req.query.buyerUserId ?? req.query.buyer_user_id);

  if (!Number.isInteger(drawNumber) || !Number.isInteger(buyerId)) {
    res.status(400).json({
      success: false,
      message: "drawNumber:int & buyerUserId:int required",
    });
    return;
  }

  const [rows] = await conn.promise().query(
    `SELECT t.ticket_number, t.status
       FROM tickets t
       INNER JOIN draws d ON t.draw_id = d.id
       WHERE d.draw_number = ? AND t.buyer_user_id = ?`,
    [drawNumber, buyerId]
  );

  const tickets = rows as Array<{ ticket_number: string; status: string }>;

  res.json({
    success: true,
    drawNumber,
    buyerUserId: buyerId,
    count: tickets.length,
    tickets,
  });
};

router.get("/by-buyer-and-draw", asyncHandler(getTicketsByBuyer));

router.post("/buy-number", async (req, res) => {
  const drawId = Number(req.body?.drawId);
  const userId = Number(req.body?.userId);
  const number = String(req.body?.number ?? "").trim();
  const price = 100;

  if (
    !Number.isInteger(drawId) ||
    !Number.isInteger(userId) ||
    !/^\d{6}$/.test(number) ||
    !(price > 0)
  ) {
    res.status(400).json({
      success: false,
      message: "drawId:int, userId:int, number:6 digits, price>0 required",
    });
  } else {
    const tx = await conn.promise().getConnection();
    try {
      await tx.beginTransaction();

      // 1) ล็อกงวด
      const [drows] = await tx.query(
        `SELECT id, status FROM draws WHERE id=? OR draw_number=? LIMIT 1 FOR UPDATE`,
        [drawId, drawId]
      );
      const draw = (drows as any[])[0];

      if (!draw) {
        await tx.rollback();
        tx.release();
        res.status(404).json({ success: false, message: "draw not found" });
      } else if (draw.status !== "OPEN") {
        await tx.rollback();
        tx.release();
        res.status(409).json({ success: false, message: "draw is not OPEN" });
      } else {
        const realDrawId = Number(draw.id);

        // 2) ล็อก/สร้าง wallet (lazy-create)
        const [wrows] = await tx.query(
          `SELECT id, balance FROM wallets WHERE user_id=? FOR UPDATE`,
          [userId]
        );
        let wallet = (wrows as any[])[0];

        if (!wallet) {
          const [insw] = await tx.execute(
            `INSERT INTO wallets (user_id, balance, created_at) VALUES (?, 0, NOW())`,
            [userId]
          );
          const wid = (insw as any).insertId;
          wallet = { id: wid, balance: 0 };
        }

        // 3) จองตั๋ว (กันชนด้วย unique)
        let insertedId: number | undefined;
        try {
          const [ins] = await tx.execute(
            `INSERT INTO tickets (draw_id, ticket_number, price, status, buyer_user_id, sold_at)
               VALUES (?, ?, ?, 'SOLD', ?, NOW())`,
            [realDrawId, number, price, userId]
          );
          insertedId = (ins as any).insertId;
        } catch (e: any) {
          if (e?.code === "ER_DUP_ENTRY" || e?.errno === 1062) {
            await tx.rollback();
            tx.release();
            res
              .status(409)
              .json({
                success: false,
                message: "This number has been sold already",
              });
          } else {
            throw e;
          }
          return; // กันไหลไปบล็อก success
        }

        // 4) หักเงินแบบ atomic (หักได้เฉพาะกรณีเงินพอ)
        const [upd]: any = await tx.execute(
          `UPDATE wallets SET balance = balance - ?
               WHERE id=? AND balance >= ?`,
          [price, wallet.id, price]
        );

        if (upd.affectedRows !== 1) {
          // เงินไม่พอ → ยกเลิกดีล และลบตั๋วที่เพิ่งจอง
          await tx.execute(`DELETE FROM tickets WHERE id=?`, [insertedId]);
          await tx.rollback();
          tx.release();
          res
            .status(400)
            .json({ success: false, message: "Insufficient balance" });
        } else {
          // 5) log ประวัติ
          await tx.execute(
            `INSERT INTO wallet_transactions (wallet_id, tx_type, amount, ref_type, ref_id, note)
                 VALUES (?, 'PURCHASE', ?, 'TICKET', ?, ?)`,
            [
              wallet.id,
              -price,
              insertedId!,
              `Buy number ${number} for draw ${realDrawId}`,
            ]
          );

          await tx.commit();
          tx.release();

          res.json({
            success: true,
            message: "Ticket purchased",
            ticket: {
              id: insertedId,
              drawId: realDrawId,
              ticketNumber: number,
              price,
              status: "SOLD",
              buyerUserId: userId,
            },
          });
        }
      }
    } catch (err: any) {
      try {
        await tx.rollback();
      } catch {}
      try {
        tx.release();
      } catch {}
      console.error(
        "buy-number error:",
        err?.sqlMessage || err?.message || err
      );
      res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  }
});
