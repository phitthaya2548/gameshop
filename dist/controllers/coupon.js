"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
exports.router = express_1.default.Router();
exports.router.post("/create/discount", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    const { code, type, value, totalQuota } = req.body;
    if (!code || !type || !value || !totalQuota) {
        return res
            .status(400)
            .json({ ok: false, message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
    }
    try {
        const [[existingCode]] = await db_1.conn.query("SELECT id FROM discount_codes WHERE code = ?", [code]);
        if (existingCode) {
            return res
                .status(400)
                .json({ ok: false, message: "โค้ดส่วนลดนี้มีอยู่แล้ว" });
        }
        await db_1.conn.query("INSERT INTO discount_codes (code, type, value, total_quota, used_count, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())", [code, type, value, totalQuota, 0, 1]);
        return res.json({ ok: true, message: "สร้างโค้ดส่วนลดสำเร็จ" });
    }
    catch (error) {
        console.error("Error creating discount code:", error);
        return res
            .status(500)
            .json({ ok: false, message: "เกิดข้อผิดพลาดในการสร้างโค้ดส่วนลด" });
    }
});
exports.router.post("/apply/discount", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    const { userId, discountCode } = req.body;
    if (!userId || !discountCode) {
        return res
            .status(400)
            .json({ ok: false, message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
    }
    try {
        const [[discount]] = await db_1.conn.query("SELECT * FROM discount_codes WHERE code = ? AND is_active = 1", [discountCode]);
        if (!discount) {
            return res
                .status(400)
                .json({ ok: false, message: "โค้ดส่วนลดไม่ถูกต้องหรือหมดอายุ" });
        }
        if (discount.used_count >= discount.total_quota) {
            return res.status(400).json({ ok: false, message: "โค้ดส่วนลดหมดแล้ว" });
        }
        const [[existingUsage]] = await db_1.conn.query("SELECT * FROM orders WHERE user_id = ? AND discount_code_id = ?", [userId, discount.id]);
        if (existingUsage) {
            return res
                .status(400)
                .json({ ok: false, message: "โค้ดส่วนลดนี้ถูกใช้แล้วในบัญชีของคุณ" });
        }
        return res.json({ ok: true, discount: discount });
    }
    catch (error) {
        console.error("Error applying discount code:", error);
        return res
            .status(500)
            .json({ ok: false, message: "เกิดข้อผิดพลาดในการใช้โค้ดส่วนลด" });
    }
});
exports.router.patch("/update/discount/:id", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    const { id } = req.params;
    const { code, type, value, totalQuota } = req.body;
    if (!code || !type || !value || !totalQuota) {
        return res
            .status(400)
            .json({ ok: false, message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
    }
    try {
        const [[discount]] = await db_1.conn.query("SELECT id FROM discount_codes WHERE id = ?", [id]);
        if (!discount) {
            return res.status(404).json({ ok: false, message: "ไม่พบโค้ดส่วนลด" });
        }
        await db_1.conn.query("UPDATE discount_codes SET code = ?, type = ?, value = ?, total_quota = ?, updated_at = NOW() WHERE id = ?", [code, type, value, totalQuota, id]);
        return res.json({ ok: true, message: "แก้ไขโค้ดส่วนลดสำเร็จ" });
    }
    catch (error) {
        console.error("Error updating discount code:", error);
        return res
            .status(500)
            .json({ ok: false, message: "เกิดข้อผิดพลาดในการแก้ไขโค้ดส่วนลด" });
    }
});
exports.router.delete("/delete/discount/:id", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    const { id } = req.params;
    try {
        const [[discount]] = await db_1.conn.query("SELECT id FROM discount_codes WHERE id = ?", [id]);
        if (!discount) {
            return res.status(404).json({ ok: false, message: "ไม่พบโค้ดส่วนลด" });
        }
        await db_1.conn.query("DELETE FROM discount_codes WHERE id = ?", [id]);
        return res.json({ ok: true, message: "ลบโค้ดส่วนลดสำเร็จ" });
    }
    catch (error) {
        console.error("Error deleting discount code:", error);
        return res
            .status(500)
            .json({ ok: false, message: "เกิดข้อผิดพลาดในการลบโค้ดส่วนลด" });
    }
});
exports.router.get("/list/discount", async (req, res) => {
    const auth = req.auth;
    try {
        const [rows] = await db_1.conn.query("SELECT * FROM discount_codes WHERE is_active = 1");
        if (rows.length === 0) {
            return res
                .status(404)
                .json({ ok: false, message: "No active discount codes found." });
        }
        return res.json({
            ok: true,
            message: "Discount codes retrieved successfully",
            discountCodes: rows,
        });
    }
    catch (error) {
        console.error("Error fetching discount codes:", error);
        return res.status(500).json({
            ok: false,
            message: "Error occurred while fetching discount codes.",
        });
    }
});
exports.router.get("/list/discount/:id", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ ok: false, message: "Invalid discount ID" });
    }
    try {
        const [rows] = await db_1.conn.query("SELECT * FROM discount_codes WHERE is_active = 1 AND id = ?", [id]);
        if (rows.length === 0) {
            return res
                .status(404)
                .json({ ok: false, message: "Discount code not found." });
        }
        return res.json({
            ok: true,
            message: "Discount code retrieved successfully",
            discountCode: rows[0],
        });
    }
    catch (error) {
        console.error("Error fetching discount code:", error);
        return res.status(500).json({
            ok: false,
            message: "Error occurred while fetching discount code.",
        });
    }
});
