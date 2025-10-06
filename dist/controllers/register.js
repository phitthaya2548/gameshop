"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
// src/routes/register.ts
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
const upload_1 = require("./upload");
exports.router = express_1.default.Router();
exports.router.post("/", upload_1.upload.single("avatar"), async (req, res) => {
    try {
        const { username, email, password } = req.body || {};
        if (!username || !email || !password) {
            return res.status(400).json({ ok: false, message: "กรอกข้อมูลให้ครบ" });
        }
        let avatar_url = null;
        if (req.file) {
            avatar_url = (0, upload_1.saveImageBufferToUploads)(req.file.buffer, req.file.mimetype);
        }
        const password_hash = await bcryptjs_1.default.hash(String(password), 10);
        const pool = db_1.conn;
        const [result] = await pool.query(`INSERT INTO users (username, email, password_hash, avatar_url)
       VALUES (?, ?, ?, ?)`, [
            String(username).trim(),
            String(email).trim().toLowerCase(),
            password_hash,
            avatar_url,
        ]);
        const base = `${req.protocol}://${req.get("host")}`;
        return res.status(201).json({
            ok: true,
            message: "สมัครสมาชิกสำเร็จ",
            data: {
                id: result.insertId,
                username,
                email,
                role: "user",
                wallet_balance: 0,
                // ส่งกลับ absolute ให้ฝั่ง UI ใช้แสดงผล
                avatarUrl: avatar_url ? `${base}${avatar_url}` : null,
            },
        });
    }
    catch (err) {
        if (err?.code === "ER_DUP_ENTRY") {
            return res
                .status(409)
                .json({ ok: false, message: "ชื่อผู้ใช้หรืออีเมลถูกใช้แล้ว" });
        }
        console.error("POST /register error:", err);
        return res
            .status(500)
            .json({ ok: false, message: "เกิดข้อผิดพลาดภายในระบบ" });
    }
});
exports.default = exports.router;
