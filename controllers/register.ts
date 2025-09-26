import bcrypt from "bcryptjs";
import express from "express";
import mysql from "mysql2";
import { conn } from "../db";
import { User } from "../models/user";

export const router = express.Router();

router.get("/", (_req, res) => {
  res.send("registeดฟดฟดฟr");
});

router.post("/", async (req, res) => {
  try {
    const user: User = req.body;
    const money = Number(req.body?.money ?? 0);

    if (!user?.username?.trim() || !user?.email?.trim() || !user?.password) {
      res.status(400).json({
        message: "username, email, password are required",
      });
    }
    if (user.password.length < 8) {
      res
        .status(400)
        .json({ message: "password must be at least 8 characters" });
    }

    const hashedPassword = await bcrypt.hash(user.password, 10);

    const sqlUser = `
      INSERT INTO users
      (username, email, password_hash, full_name, phone, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'MEMBER',
        CONVERT_TZ(NOW(), '+00:00', '+07:00'),
        CONVERT_TZ(NOW(), '+00:00', '+07:00'))
    `;

    const paramsUser = [
      user.username.trim(),
      user.email.trim(),
      hashedPassword,
      user.full_name?.trim() || null,
      user.phone?.trim() || null,
    ];

    conn.execute(sqlUser, paramsUser, (err, results) => {
      if (err) {
        if ((err as any).code === "ER_DUP_ENTRY") {
          res.status(409).json({ message: "username or email already exists" });
        }
        console.error(
          "DB Error:",
          (err as any).sqlMessage || err.message || err
        );
        res.status(500).json({ message: "DB Error" });
      }

      const r = results as mysql.ResultSetHeader;
      if (r.affectedRows === 1) {
        const userId = r.insertId;

        // ✅ สร้าง wallet หลังจาก user insert สำเร็จ
        const sqlWallet = `
          INSERT INTO wallets (user_id, balance, created_at, updated_at)
          VALUES (?, ?, CONVERT_TZ(NOW(), '+00:00', '+07:00'),
                        CONVERT_TZ(NOW(), '+00:00', '+07:00'))
          ON DUPLICATE KEY UPDATE
            balance = VALUES(balance),
            updated_at = VALUES(updated_at)
        `;
        const paramsWallet = [userId, money];

        conn.execute(sqlWallet, paramsWallet, (err2) => {
          if (err2) {
            console.error("Wallet DB Error:", (err2 as any).sqlMessage || err2);
            // ยังถือว่าสมัคร user ได้ แต่สร้าง wallet fail
            res.status(201).json({
              success: true,
              message: "User registered, but wallet creation failed",
              user: {
                id: userId,
                username: user.username.trim(),
                email: user.email.trim(),
                full_name: user.full_name?.trim() || null,
                phone: user.phone ?? null,
                role: "MEMBER",
              },
              wallet: null,
            });
          }

          // สำเร็จทั้ง user + wallet
          res.status(201).json({
            success: true,
            message: "User registered successfully",
            user: {
              id: userId,
              username: user.username.trim(),
              email: user.email.trim(),
              full_name: user.full_name?.trim() || null,
              phone: user.phone ?? null,
              role: "MEMBER",
            },
            wallet: {
              balance: money,
            },
          });
        });
      } else {
        res
          .status(500)
          .json({ success: false, message: "Failed to register user" });
      }
    });
  } catch (e) {
    console.error("Unexpected Error:", e);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

export default router;
