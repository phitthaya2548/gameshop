"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
const upload_1 = require("./upload"); // <- import ฟังก์ชันใหม่
exports.router = express_1.default.Router();
exports.router.post("/user", async (req, res) => {
    try {
        const user = req.body;
        // ---- validate ----
        if (!user.phone_number?.trim() ||
            !user.password?.trim() ||
            !user.name?.trim()) {
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
        let profileUrl = null;
        if (user.profile_image && typeof user.profile_image === "string") {
            try {
                // ส่ง base64 เพียว ๆ เข้ามา พร้อมบอก ext เอง ("jpg" หรือ "png")
                profileUrl = (0, upload_1.saveImageFromBase64)(user.profile_image, "png");
            }
            catch (imgErr) {
                return res
                    .status(415)
                    .json({ message: imgErr?.message || "Invalid image" });
            }
        }
        // ---- เข้ารหัสรหัสผ่าน ----
        const hashedPassword = await bcryptjs_1.default.hash(user.password, 10);
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
        db_1.conn.query(sql, params, (err, result) => {
            if (err) {
                if (err.code === "ER_DUP_ENTRY") {
                    return res
                        .status(409)
                        .json({ message: "phone_number already exists" });
                }
                console.error("DB Error:", err);
                return res.status(500).json({ message: "DB Error" });
            }
            const r = result;
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
    }
    catch (e) {
        console.error("Unexpected Error:", e);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});
exports.router.post("/rider", async (req, res) => {
    try {
        const rider = req.body;
        // 1) validate เบื้องต้น
        if (!rider.phone_number?.trim() || !rider.password?.trim() || !rider.name?.trim()) {
            return res.status(400).json({ message: "phone_number, password, name are required" });
        }
        if (rider.password.length < 8) {
            return res.status(400).json({ message: "password must be at least 8 characters" });
        }
        let profileUrl = null;
        let vehicleUrl = null;
        try {
            if (typeof rider.profile_image === "string" && rider.profile_image.trim().length > 0) {
                // ถ้าอยากเดาเป็น jpg ให้ส่งพารามิเตอร์ "jpg" ได้ เช่น saveImageFromBase64(..., "jpg")
                profileUrl = (0, upload_1.saveImageFromBase64)(rider.profile_image, "png");
            }
            if (typeof rider.vehicle_image === "string" && rider.vehicle_image.trim().length > 0) {
                vehicleUrl = (0, upload_1.saveImageFromBase64)(rider.vehicle_image, "png");
            }
        }
        catch (imgErr) {
            return res.status(415).json({ message: imgErr?.message || "Invalid image" });
        }
        // 3) เข้ารหัสรหัสผ่าน
        const hashedPassword = await bcryptjs_1.default.hash(rider.password, 10);
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
        db_1.conn.query(sql, params, (err, result) => {
            if (err) {
                if (err.code === "ER_DUP_ENTRY") {
                    return res.status(409).json({ message: "phone_number already exists" });
                }
                console.error("DB Error:", err);
                return res.status(500).json({ message: "DB Error" });
            }
            const r = result;
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
    }
    catch (e) {
        console.error("Unexpected Error:", e);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});
