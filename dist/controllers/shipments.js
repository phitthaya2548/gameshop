"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
// routes/shipments.ts
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
exports.router = express_1.default.Router();
/* ----------------------- helpers ----------------------- */
// แปลง ?status=1,2 เป็น ["1","2"]
function parseStatusFilter(q) {
    const raw = q.status?.trim();
    if (!raw)
        return null;
    const allowed = new Set(["1", "2", "3", "4"]);
    const list = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => allowed.has(s));
    return list.length ? list : null;
}
// ต่อ URL ให้เป็น absolute เฉพาะฟิลด์ที่ระบุ
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
function absolutizeFields(rows, host) {
    // รองรับทั้งชื่อ photo_url (จาก SHIPMENT_SELECT) และ last_photo_url (จาก endpoint list/detail)
    return absolutize(rows, host, [
        "photo_url",
        "last_photo_url",
        "recv_avatar",
        "send_avatar",
    ]);
}
/** SELECT หลัก (รวมซับคิวรีรูปล่าสุด) — ใช้ใน /sent, /received, /:id */
const SHIPMENT_SELECT = `
  SELECT
    s.shipment_id, s.sender_id, s.receiver_id,
    s.pickup_address_id, s.delivery_address_id,
    s.item_name, s.item_description,
    s.status,
    CASE s.status
      WHEN '1' THEN 'รอไรเดอร์'
      WHEN '2' THEN 'ไรเดอร์รับงาน'
      WHEN '3' THEN 'กำลังส่ง'
      WHEN '4' THEN 'ส่งแล้ว'
      ELSE 'ไม่ทราบสถานะ'
    END AS status_text,
    s.created_at, s.updated_at,

    us.user_id       AS send_user_id,
    us.name          AS send_name,
    us.phone_number  AS send_phone,
    us.profile_image AS send_avatar,

    ur.user_id       AS recv_user_id,
    ur.name          AS recv_name,
    ur.phone_number  AS recv_phone,
    ur.profile_image AS recv_avatar,

    /* ที่อยู่ผู้รับ (delivery) */
    adr.address_id    AS recv_address_id,
    adr.name_address  AS recv_addr_label,
    adr.address_text  AS recv_address_text,
    adr.gps_lat       AS recv_gps_lat,
    adr.gps_lng       AS recv_gps_lng,

    /* ที่อยู่ผู้ส่ง (pickup) */
    adp.address_id    AS send_address_id,
    adp.name_address  AS send_addr_label,
    adp.address_text  AS send_address_text,
    adp.gps_lat       AS send_gps_lat,
    adp.gps_lng       AS send_gps_lng,

    /* รูปล่าสุดของ shipment (alias เป็น photo_url) */
    (
      SELECT sp.photo_url
      FROM Shipment_Photo sp
      WHERE sp.shipment_id = s.shipment_id
      ORDER BY sp.uploaded_at DESC
      LIMIT 1
    ) AS photo_url,

    r.rider_id, r.name AS rider_name, r.phone_number AS rider_phone, r.license_plate

  FROM Shipment s
  LEFT JOIN User us          ON us.user_id = s.sender_id
  LEFT JOIN User ur          ON ur.user_id = s.receiver_id
  LEFT JOIN User_Address adr ON adr.address_id = s.delivery_address_id
  LEFT JOIN User_Address adp ON adp.address_id = s.pickup_address_id
  LEFT JOIN Rider r          ON r.rider_id = s.rider_id
`;
/* ----------------------- middleware: คำนวณ host ครั้งเดียว ----------------------- */
/** ใส่ hostPrefix ไว้ใน req ทุก request */
exports.router.use((req, _res, next) => {
    const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
    const host = req.get("host");
    req.hostPrefix = `${proto}://${host}`;
    next();
});
/* ----------------------- Endpoints ----------------------- */
/** GET /shipments/sent?sender_id=10&status=1,2 */
exports.router.get("/sent", async (req, res) => {
    try {
        const senderId = Number(req.query.sender_id);
        if (!senderId)
            return res
                .status(400)
                .json({ success: false, message: "missing_sender_id" });
        const statusList = parseStatusFilter(req.query);
        const where = ["s.sender_id = ?"];
        const params = [senderId];
        if (statusList) {
            where.push(`s.status IN (${statusList.map(() => "?").join(",")})`);
            params.push(...statusList);
        }
        const sql = `${SHIPMENT_SELECT} WHERE ${where.join(" AND ")} ORDER BY s.created_at DESC`;
        const [rows] = await db_1.conn.promise().query(sql, params);
        const host = req.hostPrefix;
        const items = absolutizeFields(rows, host);
        return res.json({ success: true, total: items.length, items });
    }
    catch (e) {
        console.error("GET /shipments/sent error:", e);
        return res.status(500).json({ success: false, message: "server_error" });
    }
});
/** GET /shipments/received?user_id=9&status=3,4 */
exports.router.get("/received", async (req, res) => {
    try {
        const userId = Number(req.query.user_id);
        if (!userId)
            return res
                .status(400)
                .json({ success: false, message: "missing_user_id" });
        const statusList = parseStatusFilter(req.query);
        const where = ["s.receiver_id = ?"];
        const params = [userId];
        if (statusList) {
            where.push(`s.status IN (${statusList.map(() => "?").join(",")})`);
            params.push(...statusList);
        }
        const sql = `${SHIPMENT_SELECT} WHERE ${where.join(" AND ")} ORDER BY s.created_at DESC`;
        const [rows] = await db_1.conn.promise().query(sql, params);
        const host = req.hostPrefix;
        const items = absolutizeFields(rows, host);
        return res.json({ success: true, total: items.length, items });
    }
    catch (e) {
        console.error("GET /shipments/received error:", e);
        return res.status(500).json({ success: false, message: "server_error" });
    }
});
exports.router.get("/:id", async (req, res) => {
    try {
        // คำนวณ host (ถ้าไม่มี hostPrefix middleware)
        const host = req.hostPrefix ??
            `${req.headers["x-forwarded-proto"] ?? req.protocol}://${req.get("host")}`;
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ success: false, message: "invalid_id" });
        }
        // คิวรี: รูปล่าสุด + ที่อยู่ + ผู้ส่ง/ผู้รับ + avatar และไรเดอร์
        const [rows] = await db_1.conn.promise().query(`
      SELECT
        s.shipment_id, s.sender_id, s.receiver_id,
        s.pickup_address_id, s.delivery_address_id,
        s.rider_id, s.item_description, s.item_name,
        s.status, s.created_at, s.updated_at,

        /* รูปล่าสุดของ shipment */
        sp.photo_url   AS last_photo_url,
        sp.status      AS last_photo_status,
        sp.uploaded_at AS last_photo_time,

        /* ที่อยู่ผู้ส่ง (pickup) */
        adp.address_id   AS send_address_id,
        adp.name_address AS send_addr_label,
        adp.address_text AS send_address_text,
        adp.gps_lat      AS send_gps_lat,
        adp.gps_lng      AS send_gps_lng,

        /* ที่อยู่ผู้รับ (delivery) */
        adr.address_id   AS recv_address_id,
        adr.name_address AS recv_addr_label,
        adr.address_text AS recv_address_text,
        adr.gps_lat      AS recv_gps_lat,
        adr.gps_lng      AS recv_gps_lng,

        /* ผู้ส่ง/ผู้รับ + avatar */
        us.name          AS send_name,
        us.phone_number  AS send_phone,
        us.profile_image AS send_avatar,
        ur.name          AS recv_name,
        ur.phone_number  AS recv_phone,
        ur.profile_image AS recv_avatar,

        /* ไรเดอร์ */
        r.name           AS rider_name,
        r.phone_number   AS rider_phone,
        r.profile_image  AS rider_avatar,
        r.license_plate  AS license_plate

      FROM Shipment s

      /* รูปล่าสุดต่อ shipment */
      LEFT JOIN (
        SELECT sp1.* 
        FROM Shipment_Photo sp1
        JOIN (
          SELECT shipment_id, MAX(uploaded_at) AS max_up
          FROM Shipment_Photo
          GROUP BY shipment_id
        ) x ON sp1.shipment_id = x.shipment_id AND sp1.uploaded_at = x.max_up
      ) sp ON sp.shipment_id = s.shipment_id

      /* join ที่อยู่ต้นทาง/ปลายทาง */
      JOIN User_Address adp ON adp.address_id = s.pickup_address_id
      JOIN User_Address adr ON adr.address_id = s.delivery_address_id

      /* join ผู้ส่ง/ผู้รับ */
      LEFT JOIN User us ON us.user_id = s.sender_id
      LEFT JOIN User ur ON ur.user_id = s.receiver_id

      /* join ไรเดอร์ */
      LEFT JOIN Rider r ON r.rider_id = s.rider_id

      WHERE s.shipment_id = ?
      LIMIT 1
      `, [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "not_found" });
        }
        // ✅ ทำให้ URL เป็น absolute ด้วยฟังก์ชันเดิมของคุณ
        const fixed = absolutize(rows, host, [
            "last_photo_url",
            "send_avatar",
            "recv_avatar",
            "rider_avatar",
        ]);
        const r = fixed[0];
        const item = {
            shipment_id: r.shipment_id,
            status: r.status,
            item_name: r.item_name ?? "",
            item_description: r.item_description ?? "",
            created_at: r.created_at,
            updated_at: r.updated_at,
            last_photo: {
                url: r.last_photo_url || "", // absolute แล้ว
                status: r.last_photo_status ?? "",
                uploaded_at: r.last_photo_time ?? r.updated_at,
            },
            sender: {
                user_id: r.sender_id,
                name: r.send_name ?? "",
                phone: r.send_phone ?? "",
                avatar: r.send_avatar || "", // absolute แล้ว
                address: {
                    address_id: r.send_address_id,
                    label: r.send_addr_label ?? "",
                    address_text: r.send_address_text ?? "",
                    lat: r.send_gps_lat ?? "",
                    lng: r.send_gps_lng ?? "",
                },
            },
            receiver: {
                user_id: r.receiver_id,
                name: r.recv_name ?? "",
                phone: r.recv_phone ?? "",
                avatar: r.recv_avatar || "", // absolute แล้ว
                address: {
                    address_id: r.recv_address_id,
                    label: r.recv_addr_label ?? "",
                    address_text: r.recv_address_text ?? "",
                    lat: r.recv_gps_lat ?? "",
                    lng: r.recv_gps_lng ?? "",
                },
            },
            // ข้อมูลของไรเดอร์
            rider: {
                id: r.rider_id,
                name: r.rider_name ?? "",
                phone: r.rider_phone ?? "",
                avatar: r.rider_avatar || "",
                license_plate: r.license_plate ?? "",
            },
        };
        return res.json({ success: true, item });
    }
    catch (e) {
        console.error("GET /shipments/:id error:", e);
        return res.status(500).json({ success: false, message: "server_error" });
    }
});
/** GET /shipments — รายการ "ว่างรับได้": status=1 และ rider_id IS NULL */
exports.router.get("/", async (req, res) => {
    try {
        const host = req.hostPrefix;
        const [rows] = await db_1.conn.promise().query(`
        SELECT
          s.shipment_id, s.sender_id, s.receiver_id,
          s.pickup_address_id, s.delivery_address_id,
          s.rider_id, s.item_description, s.item_name,
          s.status, s.created_at, s.updated_at,
      
          /* รูปล่าสุดของ shipment (alias เป็น last_photo_url) */
          sp.photo_url   AS last_photo_url,
          sp.status      AS last_photo_status,
          sp.uploaded_at AS last_photo_time,
      
          /* ที่อยู่ผู้ส่ง (pickup) */
          adp.address_id   AS send_address_id,
          adp.name_address AS send_addr_label,
          adp.address_text AS send_address_text,
          adp.gps_lat      AS send_gps_lat,
          adp.gps_lng      AS send_gps_lng,
      
          /* ที่อยู่ผู้รับ (delivery) */
          adr.address_id   AS recv_address_id,
          adr.name_address AS recv_addr_label,
          adr.address_text AS recv_address_text,
          adr.gps_lat      AS recv_gps_lat,
          adr.gps_lng      AS recv_gps_lng,
      
          /* ชื่อ/เบอร์ของผู้ส่ง/ผู้รับ */
          us.name         AS send_name,
          us.phone_number AS send_phone,
          ur.name         AS recv_name,
          ur.phone_number AS recv_phone
      
        FROM Shipment s
        /* รูปล่าสุดต่อ shipment */
        LEFT JOIN (
          SELECT sp1.*
          FROM Shipment_Photo sp1
          JOIN (
            SELECT shipment_id, MAX(uploaded_at) AS max_up
            FROM Shipment_Photo
            GROUP BY shipment_id
          ) x ON sp1.shipment_id = x.shipment_id AND sp1.uploaded_at = x.max_up
        ) sp ON sp.shipment_id = s.shipment_id
      
        /* join ที่อยู่ต้นทาง/ปลายทาง */
        JOIN User_Address adp ON adp.address_id = s.pickup_address_id
        JOIN User_Address adr ON adr.address_id = s.delivery_address_id
      
        /* join ผู้ส่ง/ผู้รับ */
        LEFT JOIN User us ON us.user_id = s.sender_id
        LEFT JOIN User ur ON ur.user_id = s.receiver_id
      
        WHERE s.status = '1' AND s.rider_id IS NULL
        ORDER BY s.updated_at DESC, s.created_at DESC
      `);
        // absolutize ก่อน map
        const absRows = absolutizeFields(rows, host);
        const shipments = absRows.map((r) => ({
            shipment_id: r.shipment_id,
            status: r.status,
            item_name: r.item_name ?? null,
            item_description: r.item_description,
            created_at: r.created_at,
            updated_at: r.updated_at,
            last_photo: {
                url: r.last_photo_url ?? "", // ใช้ last_photo_url ที่ถูก absolutize แล้ว
                status: r.last_photo_status ?? "",
                uploaded_at: r.last_photo_time ?? r.updated_at,
            },
            sender: {
                user_id: r.sender_id,
                name: r.send_name ?? null,
                phone: r.send_phone ?? null,
                address: {
                    address_id: r.send_address_id,
                    label: r.send_addr_label,
                    address_text: r.send_address_text,
                    lat: r.send_gps_lat,
                    lng: r.send_gps_lng,
                },
            },
            receiver: {
                user_id: r.receiver_id,
                name: r.recv_name ?? null,
                phone: r.recv_phone ?? null,
                address: {
                    address_id: r.recv_address_id,
                    label: r.recv_addr_label,
                    address_text: r.recv_address_text,
                    lat: r.recv_gps_lat,
                    lng: r.recv_gps_lng,
                },
            },
        }));
        return res.json({ success: true, shipments });
    }
    catch (err) {
        console.error("GET /shipments error:", err);
        return res
            .status(500)
            .json({ success: false, message: "Internal Server Error" });
    }
});
exports.router.post("/accept", async (req, res) => {
    const { rider_id, shipment_id } = req.body;
    if (!rider_id || !shipment_id) {
        return res.status(400).json({ success: false, message: "missing_fields" });
    }
    try {
        // Check if the rider already has an accepted or in-progress shipment
        const [existingShipment] = await db_1.conn
            .promise()
            .query(`SELECT * FROM Shipment WHERE rider_id = ? AND status IN ('2', '3') LIMIT 1`, [rider_id]);
        // Check if the result has rows
        if (existingShipment.length > 0) {
            // Type casting to handle result as array
            return res.status(400).json({
                success: false,
                message: "rider_has_ongoing_shipment",
            });
        }
        // Proceed to accept the shipment if the rider has no ongoing shipment
        const [result] = await db_1.conn.promise().query(`UPDATE Shipment 
      SET status = '2', rider_id = ? 
      WHERE shipment_id = ? AND status = '1'`, [rider_id, shipment_id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "shipment_not_found_or_already_taken",
            });
        }
        return res.json({ success: true, message: "shipment_accepted" });
    }
    catch (e) {
        console.error("Error accepting shipment:", e);
        return res.status(500).json({ success: false, message: "server_error" });
    }
});
