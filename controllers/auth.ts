import bcrypt from "bcryptjs";
import express from "express";
import { conn } from "../db";
import { User } from "../models/user";

export const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const userInput: Partial<User> = req.body;
    const username = userInput.username?.trim();
    const password = userInput.password;
    if (!username || !password) {
      res.status(400).json({ message: "username and password are required" });
      return;
    }

    const sql = `
      SELECT id, username, full_name, phone, role, password_hash
      FROM users
      WHERE username = ?
      LIMIT 1
    `;

    conn.execute(sql, [username], async (err, results) => {
      if (err) {
        console.error(
          "DB Error:",
          (err as any).sqlMessage || err.message || err
        );
        res.status(500).json({ message: "Internal Server Error" });
        return;
      }

      const rows = results as any[];
      const user = rows?.[0];
      if (!user) {
        res.status(401).json({ message: "Invalid username or password" });
        return;
      }
      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        res.status(401).json({ message: "Invalid username or password" });
        return;
      }

      res.json({
        message: "login success",
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          phone: user.phone,
          role: user.role,
        },
      });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Internal Server Error" });
  }
});
