import bcrypt from "bcryptjs";
import express from "express";
import type { RowDataPacket } from "mysql2";
import { conn } from "../db";
import { generateToken } from "../middlewares/jws";
import { toAbsoluteUrl } from "./upload";

export const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      return res
        .status(400)
        .json({ ok: false, message: "กรอกอีเมลและรหัสผ่าน" });
    }

    const [[user]] = await conn.query<RowDataPacket[]>(
      `
      SELECT
        id,
        username,
        email,
        password_hash AS passwordHash,
        role,
        avatar_url AS avatarUrl,
        wallet_balance AS walletBalance
      FROM users
      WHERE email = ?
      LIMIT 1
    `,
      [email.toLowerCase()]
    );


    if (!user) {
      return res
        .status(401)
        .json({ ok: false, message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    }


    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res
        .status(401)
        .json({ ok: false, message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    }


    const avatarUrl = toAbsoluteUrl(req, user.avatarUrl);


    const payload = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role as "user",
      avatarUrl,
      walletBalance: Number(user.walletBalance ?? 0),
    };

    const token = generateToken(payload);
    return res.json({ ok: true, token, user: payload });
  } catch (err) {
    console.error("LOGIN error:", err);
    return res
      .status(500)
      .json({ ok: false, message: "เกิดข้อผิดพลาด กรุณาลองใหม่" });
  }
});
