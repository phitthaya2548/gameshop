"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
exports.router = express_1.default.Router();
exports.router.post("/", async (req, res) => {
    try {
        const { phone_number, password } = req.body;
        if (!phone_number?.trim() || !password?.trim()) {
            return res
                .status(400)
                .json({ message: "phone_number and password are required" });
        }
        const p = db_1.conn.promise();
        const phone = phone_number.trim();
        // --- 1) หาในตาราง User ---
        const [urows] = await p.query(`SELECT user_id, phone_number, password, name, profile_image
       FROM User
       WHERE phone_number = ? LIMIT 1`, [phone]);
        if (urows.length > 0) {
            const u = urows[0];
            const ok = await bcryptjs_1.default.compare(password, String(u.password));
            if (!ok)
                return res.status(401).json({ message: "Invalid credentials" });
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
        const [rrows] = await p.query(`SELECT rider_id, phone_number, password, name, profile_image, vehicle_image, license_plate
       FROM Rider
       WHERE phone_number = ? LIMIT 1`, [phone]);
        if (rrows.length > 0) {
            const r = rrows[0];
            const ok = await bcryptjs_1.default.compare(password, String(r.password));
            if (!ok)
                return res.status(401).json({ message: "Invalid credentials" });
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
    }
    catch (err) {
        console.error("Login error:", err);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});
