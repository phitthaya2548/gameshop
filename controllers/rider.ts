import express from "express";
import { conn } from "../db";

export const router = express.Router();

// GET /riders/:id — ดึงไรเดอร์รายคนตาม id
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: "Invalid rider id" });
    }

    const sql = `
      SELECT rider_id, phone_number, name, profile_image, vehicle_image, license_plate
      FROM Rider
      WHERE rider_id = ?
      LIMIT 1
    `;
    const [rows] = await conn.promise().query(sql, [id]);

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ success: false, message: "Rider not found" });
    }

    const host = `${req.protocol}://${req.get("host")}`;
    const toAbsolute = (p?: any) => {
      if (!p) return null;
      const s = String(p);
      if (/^https?:\/\//i.test(s)) return s;
      return `${host}${s.startsWith("/") ? "" : "/"}${s}`;
    };

    const r: any = rows[0];
    const rider = {
      rider_id: r.rider_id,
      phone_number: r.phone_number,
      name: r.name,
      license_plate: r.license_plate ?? null,
      profile_image: toAbsolute(r.profile_image),
      vehicle_image: toAbsolute(r.vehicle_image),
    };

    return res.json({ success: true, rider });
  } catch (err) {
    console.error("GET /riders/:id error:", err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});
