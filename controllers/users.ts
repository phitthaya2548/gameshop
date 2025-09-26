// routes/profile.ts
import express from "express";
import { conn } from "../db";
import { UserAddress } from "../models/user_addresses";

export const router = express.Router();

router.get("/:id/profile", async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "id:int required" });
    }

    // 1) ผู้ใช้
    const userSql = `
      SELECT user_id, phone_number, name, profile_image
      FROM User
      WHERE user_id = ?
      LIMIT 1
    `;
    const [userRows] = await conn.promise().query(userSql, [userId]);
    const user = (userRows as any[])[0];
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const host = `${req.protocol}://${req.get("host")}`;
    if (user.profile_image) {
      user.profile_image = `${host}${user.profile_image}`;
    }

    const addrSql = `
      SELECT 
        address_id,
        user_id,
        name_address,
        address_text,
        gps_lat,
        gps_lng,
        is_default
      FROM User_Address
      WHERE user_id = ?
      ORDER BY is_default DESC, address_id DESC
    `;
    const [addrRows] = await conn.promise().query(addrSql, [userId]);
    const addresses = addrRows as any[];

    // 3) ที่อยู่หลัก (ถ้ามี)
    const defaultAddress = addresses.find((a) => !!a.is_default) || null;

    return res.json({
      success: true,
      user,
      addresses,
      defaultAddress,
    });
  } catch (err) {
    console.error("GET /users/:id/profile error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
});


router.post("/:id/addresses", async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ success: false, message: "id:int required" });
  }

  // ✅ ใช้ model
  const userAddress = new UserAddress(req.body, userId);

  if (!userAddress.address_text) {
    return res
      .status(400)
      .json({ success: false, message: "address_text required" });
  }

  const cx = await conn.promise().getConnection();
  try {
    await cx.beginTransaction();

    if (userAddress.is_default) {
      await cx.query(
        `UPDATE User_Address SET is_default = FALSE WHERE user_id = ?`,
        [userAddress.user_id]
      );
    }

    const sql = `
      INSERT INTO User_Address (user_id, name_address, address_text, gps_lat, gps_lng, is_default)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const [result] = await cx.query(sql, [
      userAddress.user_id,
      userAddress.name_address,
      userAddress.address_text,
      userAddress.gps_lat,
      userAddress.gps_lng,
      userAddress.is_default,
    ]);

    await cx.commit();
    return res.status(201).json({
      success: true,
      address_id: (result as any).insertId,
    });
  } catch (err) {
    await cx.rollback();
    console.error("POST /users/:id/addresses error:", err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  } finally {
    cx.release();
  }
});
router.put("/:id/addresses/:addressId", async (req, res) => {
  const userId = Number(req.params.id);
  const addressId = Number(req.params.addressId);
  const { name_address, address_text, gps_lat, gps_lng, is_default } = req.body;

  try {
    if (is_default) {
      await conn
        .promise()
        .query(`UPDATE User_Address SET is_default = FALSE WHERE user_id = ?`, [
          userId,
        ]);
    }

    const sql = `
      UPDATE User_Address
      SET name_address = ?, address_text = ?, gps_lat = ?, gps_lng = ?, is_default = ?
      WHERE address_id = ? AND user_id = ?
    `;
    await conn
      .promise()
      .query(sql, [
        name_address ?? "บ้าน",
        address_text,
        gps_lat ?? null,
        gps_lng ?? null,
        is_default ?? false,
        addressId,
        userId,
      ]);

    return res.json({ success: true, message: "Address updated successfully" });
  } catch (err) {
    console.error("PUT /:id/addresses/:addressId error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
});
router.delete("/:id/addresses/:addressId", async (req, res) => {
  const userId = Number(req.params.id);
  const addressId = Number(req.params.addressId);

  try {
    const sql = `DELETE FROM User_Address WHERE address_id = ? AND user_id = ?`;
    await conn.promise().query(sql, [addressId, userId]);
    return res.json({ success: true, message: "Address deleted successfully" });
  } catch (err) {
    console.error("DELETE /:id/addresses/:addressId error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
});
router.get("/:id/addresses", async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ success: false, message: "id:int required" });
  }

  try {
    const sql = `
      SELECT address_id, user_id, name_address, address_text, gps_lat, gps_lng, is_default
      FROM User_Address
      WHERE user_id = ?
      ORDER BY is_default DESC, address_id DESC
    `;
    const [rows] = await conn.promise().query(sql, [userId]);
    return res.json({ success: true, addresses: rows });
  } catch (err) {
    console.error("GET /users/:id/addresses error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
});
