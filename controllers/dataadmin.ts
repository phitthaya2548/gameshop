import express from "express";
import { conn } from "../db";

export const router = express.Router();

router.get("/selled", async (req, res) => {
  try {
    const sql = `
        SELECT 
          COALESCE(COUNT(*), 0) AS count
        FROM tickets
      `;
    const [rows] = await conn.promise().query(sql);
    const count = (rows as any[])[0]?.count ?? 0;

    res.json({ success: true, soldTickets: count });
  } catch (err: any) {
    console.error("DB Error:", err.sqlMessage || err.message || err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});
router.get("/users", async (req, res) => {
  try {
    const sql = `
        SELECT 
          COALESCE(COUNT(*), 0) AS count
        FROM users
      `;
    const [rows] = await conn.promise().query(sql);
    const count = (rows as any[])[0]?.count ?? 0;

    res.json({ success: true, users: count });
  } catch (err: any) {
    console.error("DB Error:", err.sqlMessage || err.message || err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});
router.get("/income", async (req, res) => {
  try {
    const sql = `
        SELECT 
          COALESCE(SUM(draw_id) * 100, 0) AS income
        FROM tickets
      `;

    const [rows] = await conn.promise().query(sql);
    const income = (rows as any[])[0]?.income ?? 0;

    res.json({ success: true, income });
  } catch (err: any) {
    console.error("DB Error:", err.sqlMessage || err.message || err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

router.get("/resetall", async (req, res) => {
  const db = conn.promise();
  try {
    await db.query("DELETE FROM tickets");
    await db.query("DELETE FROM draws");
    res.json({ success: true, message: "Deleted tickets and draws" });
  } catch (err: any) {
    console.error("DB Error:", err.sqlMessage || err.message || err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});
