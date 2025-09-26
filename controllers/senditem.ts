import express from "express";
import { conn } from "../db";
import { ShipmentRow } from "../models/Shipment";
import { saveImageFromBase64 } from "./upload";

export const router = express.Router();

router.get("/search", async (req, res) => {
  try {
    const senderPhone = String(req.query.sender_phone || "").trim();
    const receiverPhone = String(req.query.receiver_phone || "").trim();

    if (!senderPhone || !receiverPhone) {
      return res
        .status(400)
        .json({ success: false, message: "missing_required_phone" });
    }

    const sql = `
      SELECT u.user_id, u.phone_number, u.name, u.profile_image,
             a.address_id, a.name_address, a.address_text,
             a.gps_lat, a.gps_lng, a.is_default
      FROM User u
      LEFT JOIN User_Address a 
        ON u.user_id = a.user_id AND a.is_default = TRUE
      WHERE u.phone_number = ?
      LIMIT 1
    `;

    const [senderRows] = await conn.promise().query(sql, [senderPhone]);
    const [receiverRows] = await conn.promise().query(sql, [receiverPhone]);

    if ((senderRows as any[]).length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "sender_not_found" });
    }
    if ((receiverRows as any[]).length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "receiver_not_found" });
    }

    const sender = (senderRows as any[])[0];
    const receiver = (receiverRows as any[])[0];

    return res.json({
      success: true,
      sender: {
        user_id: sender.user_id,
        phone_number: sender.phone_number,
        name: sender.name,
        profile_image: sender.profile_image,
        address: sender.address_id
          ? {
              address_id: sender.address_id,
              name_address: sender.name_address,
              address_text: sender.address_text,
              gps_lat: sender.gps_lat,
              gps_lng: sender.gps_lng,
              is_default: sender.is_default,
            }
          : null,
      },
      receiver: {
        user_id: receiver.user_id,
        phone_number: receiver.phone_number,
        name: receiver.name,
        profile_image: receiver.profile_image,
        address: receiver.address_id
          ? {
              address_id: receiver.address_id,
              name_address: receiver.name_address,
              address_text: receiver.address_text,
              gps_lat: receiver.gps_lat,
              gps_lng: receiver.gps_lng,
              is_default: receiver.is_default,
            }
          : null,
      },
    });
  } catch (e) {
    console.error("Unexpected Error:", e);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
});


router.post("/create", async (req, res) => {
  try {
    const {
      sender_id, receiver_id, pickup_address_id, delivery_address_id,
      item_name, item_description,
      photo_base64, // optional
      photo_url,    // optional
    } = req.body || {};

    if (!sender_id || !receiver_id || !pickup_address_id || !delivery_address_id || !item_name || !item_description) {
      return res.status(400).json({ success: false, message: "missing_required_fields" });
    }

    const cx = await conn.promise().getConnection();
    try {
      await cx.beginTransaction();

      const [result]: any = await cx.query(
        `INSERT INTO Shipment (
          sender_id, receiver_id, pickup_address_id, delivery_address_id,
          item_name, item_description, status
        ) VALUES (?, ?, ?, ?, ?, ?, '1')`,
        [sender_id, receiver_id, pickup_address_id, delivery_address_id, item_name, item_description]
      );

      const shipmentId = result.insertId;

      // รูป (ถ้ามี)
      let finalUrl: string | null = null;
      if (typeof photo_url === "string" && photo_url.trim() !== "") {
        finalUrl = photo_url.trim();
      } else if (typeof photo_base64 === "string" && photo_base64.trim() !== "") {
        finalUrl = saveImageFromBase64(photo_base64);
      }

      if (finalUrl) {
        await cx.query(
          `INSERT INTO Shipment_Photo (shipment_id, rider_id, status, photo_url, uploaded_at)
           VALUES (?, NULL, '1', ?, NOW())`,
          [shipmentId, finalUrl]
        );
      }

      await cx.commit();
      return res.json({ success: true, shipment_id: shipmentId });
    } catch (e) {
      await cx.rollback();
      console.error("create shipment error:", e);
      return res.status(500).json({ success: false, message: "server_error" });
    } finally {
      cx.release();
    }
  } catch (e) {
    console.error("create shipment error:", e);
    return res.status(500).json({ success: false, message: "server_error" });
  }
});
router.post("/create-batch", async (req, res) => {
  const { sender_id, pickup_address_id, items } = req.body || {};

  if (!sender_id || !pickup_address_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: "missing_required_fields" });
  }

  const cx = await conn.promise().getConnection();
  try {
    await cx.beginTransaction();

    const createdIds: number[] = [];
    const sqlInsertShipment = `
      INSERT INTO Shipment (
        sender_id, receiver_id, pickup_address_id, delivery_address_id,
        item_name, item_description, status
      ) VALUES (?, ?, ?, ?, ?, ?, '1')
    `;
    const sqlInsertPhoto = `
      INSERT INTO Shipment_Photo (shipment_id, rider_id, status, photo_url, uploaded_at)
      VALUES (?, NULL, '1', ?, NOW())
    `;

    for (const rawItem of items) {
      const {
        receiver_id, delivery_address_id, item_name, item_description,
        photo_url, photo_base64,
      } = rawItem || {};

      if (!receiver_id || !delivery_address_id || !item_name || !item_description) {
        throw new Error("missing_item_fields");
      }

      const [result]: any = await cx.query(sqlInsertShipment, [
        sender_id, receiver_id, pickup_address_id, delivery_address_id, item_name, item_description,
      ]);

      const shipmentId = result.insertId;
      createdIds.push(shipmentId);

      let finalUrl: string | null = null;
      if (typeof photo_url === "string" && photo_url.trim() !== "") {
        finalUrl = photo_url.trim();
      } else if (typeof photo_base64 === "string" && photo_base64.trim() !== "") {
        finalUrl = saveImageFromBase64(photo_base64);
      }

      if (finalUrl) {
        await cx.query(sqlInsertPhoto, [shipmentId, finalUrl]);
      }
    }

    await cx.commit();
    return res.json({ success: true, shipment_ids: createdIds });
  } catch (e) {
    await cx.rollback();
    console.error("create-batch error:", e);
    return res.status(500).json({ success: false, message: "server_error" });
  } finally {
    cx.release();
  }
});
