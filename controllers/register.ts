// src/routes/register.ts
import bcrypt from "bcryptjs";
import express from "express";
import type { Pool, ResultSetHeader } from "mysql2/promise";
import { conn } from "../db";
import { saveImageBufferToUploads, upload } from "./upload";

export const router = express.Router();

router.post("/", upload.single("avatar"), async (req, res) => {
  
  try {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) {
      return res.status(400).json({ ok: false, message: "กรอกข้อมูลให้ครบ" });
    }

    let avatar_url: string | null = null;
    if (req.file) {
      avatar_url = saveImageBufferToUploads(req.file.buffer, req.file.mimetype);
    }

    const password_hash = await bcrypt.hash(String(password), 10);

    const pool = conn as Pool;
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO users (username, email, password_hash, avatar_url)
       VALUES (?, ?, ?, ?)`,
      [
        String(username).trim(),
        String(email).trim().toLowerCase(),
        password_hash,
        avatar_url,
      ]
    );

    const base = `${req.protocol}://${req.get("host")}`;
    return res.status(201).json({
      ok: true,
      message: "สมัครสมาชิกสำเร็จ",
      data: {
        id: result.insertId,
        username,
        email,
        role: "user",
        wallet_balance: 0,
        // ส่งกลับ absolute ให้ฝั่ง UI ใช้แสดงผล
        avatarUrl: avatar_url ? `${base}${avatar_url}` : null,
      },
    });
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") {
      return res
        .status(409)
        .json({ ok: false, message: "ชื่อผู้ใช้หรืออีเมลถูกใช้แล้ว" });
    }
    console.error("POST /register error:", err);
    return res
      .status(500)
      .json({ ok: false, message: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

export default router;
