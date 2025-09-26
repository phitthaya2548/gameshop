import express from "express";
import { conn } from "../db";

export const router = express.Router();

router.get("/transactions", async (req, res) => {
  try {
    const userId = Number(req.query.userId);
    const limit = Math.min(Number(req.query.limit ?? 50), 200);

    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({ success: false, message: "userId:int required" });
    }
    const [wrs] = await conn
      .promise()
      .query(`SELECT id FROM wallets WHERE user_id=? LIMIT 1`, [userId]);
    const walletId = (wrs as any[])[0]?.id;
    if (!walletId) {
      res.json({
        success: true,
        summary: { in: 0, out: 0, net: 0 },
        items: [],
      });
    }

    const [srs] = await conn.promise().query(
      `SELECT
           COALESCE(SUM(CASE WHEN amount > 0 THEN amount END),0) AS total_in,
           COALESCE(SUM(CASE WHEN amount < 0 THEN -amount END),0) AS total_out,
           COALESCE(SUM(amount),0) AS net
         FROM wallet_transactions
         WHERE wallet_id=?`,
      [walletId]
    );

    const [rows] = await conn.promise().query(
      `SELECT id, tx_type, amount, ref_type, ref_id, note, created_at
         FROM wallet_transactions
         WHERE wallet_id=?
         ORDER BY created_at DESC
         LIMIT ?`,
      [walletId, limit]
    );
    res.json({ success: true, items: rows });
  } catch (err: any) {
    console.error(
      "transactions error:",
      err?.sqlMessage || err?.message || err
    );
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

router.get("/balance", async (req, res) => {
  const userId = Number(req.query.userId);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ success: false, message: "userId:int required" });
  }

  const [wr] = await conn
    .promise()
    .query(`SELECT id, balance FROM wallets WHERE user_id=? LIMIT 1`, [userId]);
  const w = (wr as any[])[0];

  res.json({
    success: true,
    wallet: { id: w?.id ?? null, balance: Number(w?.balance ?? 0) },
  });
});
