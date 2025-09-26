import bcrypt from "bcryptjs";
import express from "express";
import { conn } from "../db";

export const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { phone_number, password } = req.body as {
      phone_number?: string;
      password?: string;
    };

    if (!phone_number?.trim() || !password?.trim()) {
      return res
        .status(400)
        .json({ message: "phone_number and password are required" });
    }

    const p = conn.promise();
    const phone = phone_number.trim();

    // --- 1) หาในตาราง User ---
    const [urows] = await p.query(
      `SELECT user_id, phone_number, password, name, profile_image
       FROM User
       WHERE phone_number = ? LIMIT 1`,
      [phone]
    );

    if ((urows as any[]).length > 0) {
      const u: any = (urows as any[])[0];
      const ok = await bcrypt.compare(password, String(u.password));
      if (!ok) return res.status(401).json({ message: "Invalid credentials" });

      return res.json({
        success: true,
        role: "USER",
        profile: {
          id: u.user_id,
          phone_number: u.phone_number,
          name: u.name,
          profile_image: u.profile_image,
        },
      });
    }

    // --- 2) ไม่เจอใน User -> หาใน Rider ---
    const [rrows] = await p.query(
      `SELECT rider_id, phone_number, password, name, profile_image, vehicle_image, license_plate
       FROM Rider
       WHERE phone_number = ? LIMIT 1`,
      [phone]
    );

    if ((rrows as any[]).length > 0) {
      const r: any = (rrows as any[])[0];
      const ok = await bcrypt.compare(password, String(r.password));
      if (!ok) return res.status(401).json({ message: "Invalid credentials" });

      return res.json({
        success: true,
        role: "RIDER",
        profile: {
          id: r.rider_id,
          phone_number: r.phone_number,
          name: r.name,
          profile_image: r.profile_image,
          vehicle_image: r.vehicle_image,
          license_plate: r.license_plate,
        },
      });
    }

    // --- 3) ไม่พบทั้งคู่ ---
    return res.status(401).json({ message: "Invalid credentials" });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});
