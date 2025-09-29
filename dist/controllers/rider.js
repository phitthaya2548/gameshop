"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
exports.router = express_1.default.Router();
// GET /riders/:id — ดึงไรเดอร์รายคนตาม id
exports.router.get("/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res
                .status(400)
                .json({ success: false, message: "Invalid rider id" });
        }
        const sql = `
      SELECT rider_id, phone_number, name, profile_image, vehicle_image, license_plate
      FROM Rider
      WHERE rider_id = ?
      LIMIT 1
    `;
        const [rows] = await db_1.conn.promise().query(sql, [id]);
        if (!Array.isArray(rows) || rows.length === 0) {
            return res
                .status(404)
                .json({ success: false, message: "Rider not found" });
        }
        const host = `${req.protocol}://${req.get("host")}`;
        const toAbsolute = (p) => {
            if (!p)
                return null;
            const s = String(p);
            if (/^https?:\/\//i.test(s))
                return s;
            return `${host}${s.startsWith("/") ? "" : "/"}${s}`;
        };
        const r = rows[0];
        const rider = {
            rider_id: r.rider_id,
            phone_number: r.phone_number,
            name: r.name,
            license_plate: r.license_plate ?? null,
            profile_image: toAbsolute(r.profile_image),
            vehicle_image: toAbsolute(r.vehicle_image),
        };
        return res.json({ success: true, rider });
    }
    catch (err) {
        console.error("GET /riders/:id error:", err);
        return res
            .status(500)
            .json({ success: false, message: "Internal Server Error" });
    }
});
exports.router.get("/location/:id", async (req, res) => {
    try {
        const riderId = Number(req.params.id);
        if (!Number.isInteger(riderId) || riderId <= 0) {
            return res
                .status(400)
                .json({ success: false, message: "Invalid rider id" });
        }
        const [rows] = await db_1.conn.promise().query(`SELECT location_id, rider_id, gps_lat, gps_lng, updated_at
         FROM Rider_Location
        WHERE rider_id = ?`, [riderId]);
        if (!rows.length)
            return res.status(204).end();
        return res.json({ success: true, location: rows[0] });
    }
    catch (err) {
        console.error("GET /location/:id error:", err);
        return res
            .status(500)
            .json({ success: false, message: "Internal Server Error" });
    }
});
exports.router.post("/location", async (req, res) => {
    try {
        const riderId = Number(req.body.rider_id);
        const lat = Number(req.body.gps_lat);
        const lng = Number(req.body.gps_lng);
        if (!Number.isInteger(riderId) || riderId <= 0) {
            return res
                .status(400)
                .json({ success: false, message: "Invalid rider_id" });
        }
        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            return res
                .status(400)
                .json({ success: false, message: "gps_lat/gps_lng required" });
        }
        await db_1.conn.promise().query(`INSERT INTO rider_location (rider_id, gps_lat, gps_lng)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         gps_lat = VALUES(gps_lat),
         gps_lng = VALUES(gps_lng),
         updated_at = CURRENT_TIMESTAMP`, [riderId, lat, lng]);
        const [rows] = await db_1.conn.promise().query(`SELECT location_id, rider_id, gps_lat, gps_lng, updated_at
         FROM Rider_Location
        WHERE rider_id = ?`, [riderId]);
        return res.status(201).json({ success: true, location: rows[0] });
    }
    catch (err) {
        console.error("POST /location error:", err);
        return res
            .status(500)
            .json({ success: false, message: "Internal Server Error" });
    }
});
