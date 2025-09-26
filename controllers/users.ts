// routes/profile.ts
import express from "express";
import { conn } from "../db";
import { User } from "../models/user";

export const router = express.Router();

/**
 * GET /profile/summary/:id
 * ส่งกลับ:
 * {
 *   success: true,
 *   user: { id, username, full_name, phone, role, created_at },
 *   wallet: { balance },
 *   tickets: {
 *     total: number,
 *     byStatus: { SOLD: n, REDEEMED: n, CANCELLED: n }  // มีเฉพาะที่ผู้ใช้เป็นเจ้าของ
 *   }
 * }
 */
router.get("/profile/:id", async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
       res.status(400).json({ success: false, message: "id:int required" });
    }

    // 1) ผู้ใช้
    const userSql = `
      SELECT id, username, full_name,email, phone, role, created_at
      FROM users
      WHERE id = ?
      LIMIT 1
    `;
    const [userRows] = await conn.promise().query(userSql, [userId]);
    const user = (userRows as any[])[0];
    if (!user) {
       res.status(404).json({ success: false, message: "User not found" });
    }

    // 2) กระเป๋าเงิน (ถ้าไม่มี wallet ให้ balance=0)
    const walletSql = `
      SELECT id, balance
      FROM wallets
      WHERE user_id = ?
      LIMIT 1
    `;
    const [walletRows] = await conn.promise().query(walletSql, [userId]);
    const wallet = (walletRows as any[])[0] ?? { id: null, balance: 0 };

    // 3) นับจำนวนตั๋วที่ผู้ใช้นี้เป็นคนซื้อ (อิง buyer_user_id)
    const ticketCountSql = `
      SELECT COUNT(*) AS total
      FROM tickets
      WHERE buyer_user_id = ?
    `;
    const [countRows] = await conn.promise().query(ticketCountSql, [userId]);
    const ticketsTotal = (countRows as any[])[0]?.total ?? 0;

   

     res.json({
      success: true,
      user,
      wallet: { balance: Number(wallet.balance || 0) },
      tickets: {
        total: Number(ticketsTotal)
      },
    });
  } catch (err) {
    console.error("GET /profile/summary error:", err);
     res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

router.put("/edit/:id", async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
       res.status(400).json({ success: false, message: "id:int required" });
    }

    const { full_name, email, phone } = req.body;

    const sql = `
      UPDATE users
      SET full_name = ?, email = ?, phone = ?
      WHERE id = ?
    `;
    await conn.promise().query(sql, [full_name, email, phone, userId]);

     res.json({ success: true, message: "User updated successfully" });
  } catch (err) {
    console.error("PUT /edit/:id error:", err);
     res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});
