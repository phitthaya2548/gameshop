import bcrypt from "bcryptjs";
import express from "express";
import mysql from "mysql2";
import { conn } from "../db";
import { User } from "../models/user";
import { saveImageFromBase64 } from "./upload"; // <- import ฟังก์ชันใหม่
import { Rider } from "../models/rider";

export const router = express.Router();

router.post("/user", async (req, res) => {
  try {
    const user: User = req.body;

    // ---- validate ----
    if (
      !user.phone_number?.trim() ||
      !user.password?.trim() ||
      !user.name?.trim()
    ) {
      return res
        .status(400)
        .json({ message: "phone_number, password, name are required" });
    }
    if (user.password.length < 8) {
      return res
        .status(400)
        .json({ message: "password must be at least 8 characters" });
    }

    // ---- จัดการรูป ----
    let profileUrl: string | null = null;
    if (user.profile_image && typeof user.profile_image === "string") {
      try {
        // ส่ง base64 เพียว ๆ เข้ามา พร้อมบอก ext เอง ("jpg" หรือ "png")
        profileUrl = saveImageFromBase64(user.profile_image, "png");
      } catch (imgErr: any) {
        return res
          .status(415)
          .json({ message: imgErr?.message || "Invalid image" });
      }
    }

    // ---- เข้ารหัสรหัสผ่าน ----
    const hashedPassword = await bcrypt.hash(user.password, 10);

    // ---- SQL Insert ----
    const sql = `
      INSERT INTO User (phone_number, password, name, profile_image)
      VALUES (?, ?, ?, ?)
    `;
    const params = [
      user.phone_number.trim(),
      hashedPassword,
      user.name.trim(),
      profileUrl,
    ];

    conn.query(sql, params, (err, result) => {
      if (err) {
        if ((err as any).code === "ER_DUP_ENTRY") {
          return res
            .status(409)
            .json({ message: "phone_number already exists" });
        }
        console.error("DB Error:", err);
        return res.status(500).json({ message: "DB Error" });
      }

      const r = result as mysql.ResultSetHeader;
      return res.status(201).json({
        success: true,
        message: "User registered successfully",
        user: {
          id: r.insertId,
          phone_number: user.phone_number,
          name: user.name,
          profile_image: profileUrl,
        },
      });
    });
  } catch (e) {
    console.error("Unexpected Error:", e);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

router.post("/rider", async (req, res) => {
  try {
    const rider: Rider = req.body;

    // 1) validate เบื้องต้น
    if (!rider.phone_number?.trim() || !rider.password?.trim() || !rider.name?.trim()) {
      return res.status(400).json({ message: "phone_number, password, name are required" });
    }
    if (rider.password.length < 8) {
      return res.status(400).json({ message: "password must be at least 8 characters" });
    }

    let profileUrl: string | null = null;
    let vehicleUrl: string | null = null;

    try {
      if (typeof rider.profile_image === "string" && rider.profile_image.trim().length > 0) {
        // ถ้าอยากเดาเป็น jpg ให้ส่งพารามิเตอร์ "jpg" ได้ เช่น saveImageFromBase64(..., "jpg")
        profileUrl = saveImageFromBase64(rider.profile_image, "png");
      }
      if (typeof rider.vehicle_image === "string" && rider.vehicle_image.trim().length > 0) {
        vehicleUrl = saveImageFromBase64(rider.vehicle_image, "png");
      }
    } catch (imgErr: any) {
      return res.status(415).json({ message: imgErr?.message || "Invalid image" });
    }

    // 3) เข้ารหัสรหัสผ่าน
    const hashedPassword = await bcrypt.hash(rider.password, 10);

    // 4) SQL Insert (ชื่อตารางตรงกับสคีมาของคุณ: Rider ตัว R ใหญ่)
    const sql = `
      INSERT INTO Rider (phone_number, password, name, profile_image, vehicle_image, license_plate)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const params = [
      rider.phone_number.trim(),
      hashedPassword,
      rider.name.trim(),
      profileUrl,
      vehicleUrl,
      rider.license_plate?.trim() || null,
    ];

    conn.query(sql, params, (err, result) => {
      if (err) {
        if ((err as any).code === "ER_DUP_ENTRY") {
          return res.status(409).json({ message: "phone_number already exists" });
        }
        console.error("DB Error:", err);
        return res.status(500).json({ message: "DB Error" });
      }

      const r = result as mysql.ResultSetHeader;
      return res.status(201).json({
        success: true,
        message: "Rider registered successfully",
        rider: {
          rider_id: r.insertId,
          phone_number: rider.phone_number,
          name: rider.name,
          profile_image: profileUrl,
          vehicle_image: vehicleUrl,
          license_plate: rider.license_plate ?? null,
        },
      });
    });
  } catch (e) {
    console.error("Unexpected Error:", e);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});
