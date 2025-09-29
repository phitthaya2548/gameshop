"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
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
// Route to get accepted shipments
exports.router.get("/accepted", async (req, res) => {
    const riderId = Number(req.query.rider_id);
    // Check if rider_id is valid
    if (!riderId || isNaN(riderId)) {
        return res
            .status(400)
            .json({ success: false, message: "missing_or_invalid_rider_id" });
    }
    try {
        // Query to fetch accepted shipments
        const sql = `
      SELECT
        s.shipment_id, s.item_name, s.item_description, s.status, s.created_at, s.updated_at,
        s.sender_id, s.receiver_id, s.pickup_address_id, s.delivery_address_id,
        r.name AS rider_name, r.phone_number AS rider_phone, r.license_plate,
        us.name AS sender_name, us.phone_number AS sender_phone, us.profile_image AS sender_avatar,
        ur.name AS receiver_name, ur.phone_number AS receiver_phone, ur.profile_image AS receiver_avatar,
        adp.address_id AS send_address_id, adp.address_text AS send_address_text,
        adr.address_id AS recv_address_id, adr.address_text AS recv_address_text
      FROM Shipment s
      LEFT JOIN Rider r ON r.rider_id = s.rider_id
      LEFT JOIN User us ON us.user_id = s.sender_id
      LEFT JOIN User ur ON ur.user_id = s.receiver_id
      LEFT JOIN User_Address adp ON adp.address_id = s.pickup_address_id
      LEFT JOIN User_Address adr ON adr.address_id = s.delivery_address_id
      WHERE s.rider_id = ? AND s.status IN ('2', '3', '4')
      ORDER BY s.updated_at DESC
    `;
        // Execute the query
        const [rows] = await db_1.conn.promise().query(sql, [riderId]);
        if (rows.length === 0) {
            return res
                .status(404)
                .json({ success: false, message: "no_accepted_shipments_found" });
        }
        // Get host URL for absolute URLs
        const host = `${req.protocol}://${req.get("host")}`;
        // Make URLs absolute for photo_url and profile_image
        const shipments = absolutize(rows, host, [
            "sender_avatar",
            "receiver_avatar",
        ]);
        // Transform the data to return sender and receiver as separate objects
        const transformedShipments = shipments.map((shipment) => ({
            shipment_id: shipment.shipment_id,
            item_name: shipment.item_name,
            item_description: shipment.item_description,
            status: shipment.status,
            created_at: shipment.created_at,
            updated_at: shipment.updated_at,
            rider: {
                rider_name: shipment.rider_name,
                rider_phone: shipment.rider_phone,
                rider_avatar: shipment.rider_avatar, // Add rider avatar if needed
                rider_license_plate: shipment.license_plate,
            },
            sender: {
                sender_name: shipment.sender_name,
                sender_phone: shipment.sender_phone,
                sender_avatar: shipment.sender_avatar, // Avatar for sender
                sender_address: {
                    send_address_id: shipment.send_address_id,
                    send_address_text: shipment.send_address_text,
                },
            },
            receiver: {
                receiver_name: shipment.receiver_name,
                receiver_phone: shipment.receiver_phone,
                receiver_avatar: shipment.receiver_avatar, // Avatar for receiver
                receiver_address: {
                    recv_address_id: shipment.recv_address_id,
                    recv_address_text: shipment.recv_address_text,
                },
            },
        }));
        // Return the transformed response
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
