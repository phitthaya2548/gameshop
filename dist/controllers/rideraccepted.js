"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
const upload_1 = require("./upload");
exports.router = express_1.default.Router();
// Helper function to make URLs absolute
function absolutize(rows, host, fields) {
    const fix = (obj) => {
        for (const f of fields) {
            const v = obj[f];
            if (typeof v === "string" && v && !/^https?:\/\//i.test(v)) {
                obj[f] = `${host}${v.startsWith("/") ? "" : "/"}${v}`;
            }
        }
        return obj;
    };
    return Array.isArray(rows) ? rows.map(fix) : fix(rows);
}
exports.router.get("/accepted", async (req, res) => {
    const riderId = Number(req.query.rider_id);
    // validate rider_id
    if (!riderId || Number.isNaN(riderId)) {
        return res
            .status(400)
            .json({ success: false, message: "missing_or_invalid_rider_id" });
    }
    try {
        // NOTE:
        // - เลือกฟิลด์ให้ครบ และใส่ r.profile_image AS rider_avatar (โค้ดฝั่งแอปอ้างใช้)
        // - รูปสินค้า: ใช้ซับคิวรี sp1 ดึงรูป "ล่าสุด" ของ status='1' ด้วย MAX(uploaded_at)
        const sql = `
      SELECT
        s.shipment_id,
        s.item_name,
        s.item_description,
        s.status,
        s.created_at,
        s.updated_at,

        s.sender_id,
        s.receiver_id,
        s.pickup_address_id,
        s.delivery_address_id,

        r.name           AS rider_name,
        r.phone_number   AS rider_phone,
        r.license_plate,
        r.profile_image  AS rider_avatar,

        us.name          AS sender_name,
        us.phone_number  AS sender_phone,
        us.profile_image AS sender_avatar,

        ur.name          AS receiver_name,
        ur.phone_number  AS receiver_phone,
        ur.profile_image AS receiver_avatar,

        adp.address_id   AS send_address_id,
        adp.address_text AS send_address_text,

        adr.address_id   AS recv_address_id,
        adr.address_text AS recv_address_text,

        -- รูปสินค้าหลัก: รูปล่าสุดที่ถ่ายตอนสถานะ 1 (รอไรเดอร์)
        sp1.photo_url    AS item_photo_url

      FROM Shipment s
      LEFT JOIN Rider r       ON r.rider_id = s.rider_id
      LEFT JOIN User  us      ON us.user_id = s.sender_id
      LEFT JOIN User  ur      ON ur.user_id = s.receiver_id
      LEFT JOIN User_Address adp ON adp.address_id = s.pickup_address_id
      LEFT JOIN User_Address adr ON adr.address_id = s.delivery_address_id

      -- รูปสินค้า: จาก Shipment_Photo ที่ status='1' (ล่าสุดด้วย uploaded_at)
      LEFT JOIN (
        SELECT p.shipment_id, p.photo_url
        FROM Shipment_Photo p
        INNER JOIN (
          SELECT shipment_id, MAX(uploaded_at) AS max_uploaded
          FROM Shipment_Photo
          WHERE status = '1'
          GROUP BY shipment_id
        ) last ON last.shipment_id = p.shipment_id
             AND last.max_uploaded = p.uploaded_at
        WHERE p.status = '1'
      ) sp1 ON sp1.shipment_id = s.shipment_id

      WHERE s.rider_id = ?
        AND s.status IN ('2','3','4')
      ORDER BY s.updated_at DESC
    `;
        const [rows] = await db_1.conn.promise().query(sql, [riderId]);
        const host = `${req.protocol}://${req.get("host")}`;
        const shipments = absolutize(rows, host, [
            "rider_avatar",
            "sender_avatar",
            "receiver_avatar",
            "item_photo_url",
        ]);
        const transformedShipments = shipments.map((s) => ({
            shipment_id: s.shipment_id,
            item_photo_url: s.item_photo_url || null,
            item_name: s.item_name,
            item_description: s.item_description,
            status: s.status,
            created_at: s.created_at,
            updated_at: s.updated_at,
            rider: {
                rider_name: s.rider_name,
                rider_phone: s.rider_phone,
                rider_license_plate: s.license_plate,
                rider_avatar: s.rider_avatar || null,
            },
            sender: {
                sender_name: s.sender_name,
                sender_phone: s.sender_phone,
                sender_avatar: s.sender_avatar || null,
                sender_address: {
                    send_address_id: s.send_address_id,
                    send_address_text: s.send_address_text,
                },
            },
            receiver: {
                receiver_name: s.receiver_name,
                receiver_phone: s.receiver_phone,
                receiver_avatar: s.receiver_avatar || null,
                receiver_address: {
                    recv_address_id: s.recv_address_id,
                    recv_address_text: s.recv_address_text,
                },
            },
        }));
        return res.json({ success: true, shipments: transformedShipments });
    }
    catch (err) {
        console.error("Error fetching accepted shipments:", err);
        return res.status(500).json({ success: false, message: "server_error" });
    }
});
exports.router.get("/location", async (req, res) => {
    const riderId = Number(req.query.rider_id);
    if (!Number.isInteger(riderId) || riderId <= 0) {
        return res
            .status(400)
            .json({ success: false, message: "Invalid rider_id" });
    }
    try {
        // SQL Query to get sender and receiver location data along with address and profile image
        const sql = `
        SELECT 
          s.shipment_id,
          us.name AS sender_name, us.phone_number AS sender_phone, 
          us.profile_image AS sender_profile_image,  -- เพิ่มการดึงข้อมูลโปรไฟล์รูปผู้ส่ง
          us_address.gps_lat AS sender_lat, us_address.gps_lng AS sender_lng, 
          us_address.name_address AS sender_address_name, us_address.address_text AS sender_address_text,
          ur.name AS receiver_name, ur.phone_number AS receiver_phone, 
          ur.profile_image AS receiver_profile_image,  -- เพิ่มการดึงข้อมูลโปรไฟล์รูปผู้รับ
          ur_address.gps_lat AS receiver_lat, ur_address.gps_lng AS receiver_lng,
          ur_address.name_address AS receiver_address_name, ur_address.address_text AS receiver_address_text
        FROM Shipment s
        LEFT JOIN Rider r ON r.rider_id = s.rider_id
        LEFT JOIN User us ON us.user_id = s.sender_id
        LEFT JOIN User ur ON ur.user_id = s.receiver_id
        LEFT JOIN User_Address us_address ON us_address.address_id = s.pickup_address_id
        LEFT JOIN User_Address ur_address ON ur_address.address_id = s.delivery_address_id
        WHERE s.rider_id = ? AND s.status IN ('2', '3', '4')
      `;
        // Execute the query to get shipment location details
        const [rows] = await db_1.conn.promise().query(sql, [riderId]);
        // Cast rows to an array of objects (QueryResult is not an array by default)
        const shipments = rows;
        if (shipments.length === 0) {
            return res
                .status(404)
                .json({ success: false, message: "no_accepted_shipments_found" });
        }
        const shipment = shipments[0]; // Safely access the first row
        // Return the sender and receiver details along with their locations, addresses, and profile images
        return res.json({
            success: true,
            shipment_id: shipment.shipment_id,
            sender: {
                name: shipment.sender_name,
                phone: shipment.sender_phone,
                profile_image: shipment.sender_profile_image, // เพิ่มโปรไฟล์รูปภาพผู้ส่ง
                lat: shipment.sender_lat,
                lng: shipment.sender_lng,
                address_name: shipment.sender_address_name, // ที่อยู่ของผู้ส่ง
                address_text: shipment.sender_address_text, // รายละเอียดที่อยู่ของผู้ส่ง
            },
            receiver: {
                name: shipment.receiver_name,
                phone: shipment.receiver_phone,
                profile_image: shipment.receiver_profile_image, // เพิ่มโปรไฟล์รูปภาพผู้รับ
                lat: shipment.receiver_lat,
                lng: shipment.receiver_lng,
                address_name: shipment.receiver_address_name, // ที่อยู่ของผู้รับ
                address_text: shipment.receiver_address_text, // รายละเอียดที่อยู่ของผู้รับ
            },
        });
    }
    catch (err) {
        console.error("Error fetching location data:", err);
        return res.status(500).json({ success: false, message: "server_error" });
    }
});
// helpers เดิมใช้ต่อได้
function toNumStatus(v) {
    const n = Number(String(v));
    return [1, 2, 3, 4].includes(n) ? n : null;
}
function nextOf(curr) {
    if (curr === 1)
        return 2;
    if (curr === 2)
        return 3;
    if (curr === 3)
        return 4;
    return null;
}
function normalizeBase64(s) {
    const t = s.trim();
    const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(t);
    if (m) {
        const ext = m[1].toLowerCase().startsWith("png") ? "png" : "jpg";
        return { b64: m[2], ext };
    }
    return { b64: t, ext: "png" };
}
function getBaseUrl(req) {
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    return `${proto}://${host}`;
}
exports.router.post("/:shipmentId/advance", async (req, res) => {
    const shipmentId = Number(req.params.shipmentId);
    const riderId = Number(req.body?.rider_id);
    const photoBase64 = req.body?.photo_base64; // รูปเดียว
    if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
        return res
            .status(400)
            .json({ success: false, message: "invalid_shipment_id" });
    }
    if (!Number.isInteger(riderId) || riderId <= 0) {
        return res
            .status(400)
            .json({ success: false, message: "invalid_rider_id" });
    }
    try {
        // 1) อ่านสถานะปัจจุบัน
        const [rows] = await db_1.conn
            .promise()
            .query(`SELECT status, rider_id FROM Shipment WHERE shipment_id = ?`, [
            shipmentId,
        ]);
        if (!rows || rows.length === 0) {
            return res
                .status(404)
                .json({ success: false, message: "shipment_not_found" });
        }
        const current = toNumStatus(rows[0].status);
        const assignedRider = rows[0].rider_id;
        if (assignedRider && assignedRider !== riderId) {
            return res
                .status(403)
                .json({ success: false, message: "not_assigned_to_this_rider" });
        }
        const next = nextOf(current);
        if (!next) {
            return res
                .status(409)
                .json({ success: false, message: "no_next_status" });
        }
        // 2) อัปเดตสถานะแบบ optimistic
        const [updResult] = await db_1.conn.promise().query(`UPDATE Shipment
          SET status = ?,
              updated_at = NOW(),
              rider_id = CASE
                WHEN ? = 1 AND ? = 2 AND rider_id IS NULL THEN ?
                ELSE rider_id
              END
        WHERE shipment_id = ?
          AND status = ?
          AND (rider_id IS NULL OR rider_id = ?)`, [
            String(next),
            current,
            next,
            riderId,
            shipmentId,
            String(current),
            riderId,
        ]);
        if (!updResult || !updResult.affectedRows) {
            return res.status(409).json({
                success: false,
                message: "concurrent_or_invalid_transition",
                detail: { from_status: current, tried_to: next },
            });
        }
        const baseUrl = getBaseUrl(req);
        let absoluteUrl = null;
        if (photoBase64 && photoBase64.trim()) {
            try {
                const { b64, ext } = normalizeBase64(photoBase64); // รองรับทั้ง raw / data URI
                const publicPath = (0, upload_1.saveImageFromBase64)(b64, ext); // e.g. "/uploads/2025/10/abc.jpg"
                await db_1.conn.promise().query(`INSERT INTO Shipment_Photo (shipment_id, rider_id, status, photo_url, uploaded_at)
           VALUES (?, ?, ?, ?, NOW())`, [shipmentId, riderId, String(next), publicPath]);
                absoluteUrl = `${baseUrl}${publicPath}`;
            }
            catch (e) {
                console.error("save photo error:", e);
                // ไม่ rollback สถานะ
            }
        }
        // 4) ยืนยันสถานะล่าสุด
        const [afterRows] = await db_1.conn
            .promise()
            .query(`SELECT status FROM Shipment WHERE shipment_id = ?`, [shipmentId]);
        const newStatus = toNumStatus(afterRows[0].status);
        return res.json({
            success: true,
            shipment_id: shipmentId,
            from_status: current,
            new_status: newStatus,
            photo: absoluteUrl, // URL เดียว (อาจเป็น null ถ้าไม่แนบรูป)
        });
    }
    catch (err) {
        console.error("advance status error:", err);
        return res.status(500).json({ success: false, message: "server_error" });
    }
});
