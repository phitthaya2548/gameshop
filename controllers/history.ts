import express from "express";
import { FieldPacket, RowDataPacket } from "mysql2";
import { conn } from "../db";
import { toAbsoluteUrl } from "./upload";

export const router = express.Router();

router.get("/wallet/ledger/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ ok: false, message: "Invalid user ID" });
  }

  try {
    const [urows]: [RowDataPacket[], FieldPacket[]] = await conn.query(
      `SELECT id, username, email, role, wallet_balance, avatar_url
         FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    if (!urows.length) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }
    const u = urows[0];

    const [transactions]: [RowDataPacket[], FieldPacket[]] = await conn.query(
      `SELECT id, type, amount, balance_after, note, created_at
         FROM wallet_ledger
         WHERE user_id = ?
         ORDER BY created_at DESC`,
      [userId]
    );

    return res.json({
      ok: true,
      user: {
        id: u.id,
        username: u.username,
        email: u.email,
        role: u.role,
        walletBalance: Number(u.wallet_balance ?? 0),
        avatarUrl: toAbsoluteUrl(req, u.avatar_url),
      },
      transactions,
    });
  } catch (e) {
    console.error("GET /wallet/ledger/:userId error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.get("/wallet/search", async (req, res) => {
  const raw = (req.query.searchQuery ?? "").toString().trim();

  // Validate the search query
  if (raw.length < 1) {
    return res.status(400).json({ ok: false, message: "Invalid search query" });
  }

  try {
    const like = `%${raw}%`;

    // Remove LIMIT 1 to return all users matching the query
    const [rows]: [RowDataPacket[], FieldPacket[]] = await conn.query(
      `
            SELECT id, username, email, role, wallet_balance, avatar_url
            FROM users
            WHERE username LIKE ? 
            ORDER BY username ASC
          `,
      [like]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }


    const users = rows.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      walletBalance: Number(user.wallet_balance ?? 0),
      avatarUrl: toAbsoluteUrl(req, user.avatar_url),
    }));

    return res.json({
      ok: true,
      users,
    });
  } catch (error) {
    console.error("Error searching user:", error);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.get("/wallet/users", async (req, res) => {
  try {

    const [users]: [RowDataPacket[], FieldPacket[]] = await conn.query(
      `SELECT id, username, email, role, wallet_balance, avatar_url 
           FROM users`
    );


    if (users.length === 0) {
      return res.status(404).json({ ok: false, message: "No users found" });
    }

    res.json({
      ok: true,
      users: users.map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        walletBalance: user.wallet_balance,
        avatarUrl: toAbsoluteUrl(req, user.avatar_url),
      })),
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});
