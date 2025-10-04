"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
const upload_1 = require("./upload");
exports.router = express_1.default.Router();
exports.router.post("/", async (req, res) => {
    try {
        const { username, email, password, avatarBase64 } = req.body || {};
        if (!username || !email || !password) {
            return res.status(400).json({ ok: false, message: "กรอกข้อมูลให้ครบ" });
        }
        // avatar (optional, มินิมอล)
        let avatar_url = null;
        if (typeof avatarBase64 === "string" && avatarBase64.trim()) {
            try {
                const m = avatarBase64.match(/^data:(.+?);base64,(.+)$/i);
                const mime = m ? m[1] : "image/png";
                const pure = m ? m[2] : avatarBase64;
                // map mime -> ext ให้ตรงกับ helper (ตอนนี้รองรับแค่ 'jpg' | 'png')
                let ext = "png";
                if (/jpe?g/i.test(mime))
                    ext = "jpg";
                else if (/png/i.test(mime))
                    ext = "png";
                else {
                    // ถ้าเป็น webp/อื่น ๆ ยังไม่รองรับใน helper เดิม → แปลงเป็น png ชั่วคราว
                    // (ถ้าจะรองรับจริง แนะนำขยาย helper ให้รับ 'webp' ด้วย)
                    ext = "png";
                }
                avatar_url = (0, upload_1.saveImageFromBase64)(pure, ext);
            }
            catch {
                avatar_url = null; // รูปพังไม่เป็นไร ให้ไปต่อ
            }
        }
        const password_hash = await bcryptjs_1.default.hash(String(password), 10);
        // ใช้ promise pool ตรง ๆ (ห้าม .promise())
        const pool = db_1.conn;
        const [result] = await pool.query(`INSERT INTO users (username, email, password_hash, avatar_url)
       VALUES (?, ?, ?, ?)`, [
            String(username).trim(),
            String(email).trim().toLowerCase(),
            password_hash,
            avatar_url,
        ]);
        return res.status(201).json({
            ok: true,
            message: "สมัครสมาชิกสำเร็จ",
            data: {
                id: result.insertId,
                username,
                email,
                avatar_url,
                role: "user",
                wallet_balance: 0,
            },
        });
    }
    catch (err) {
        if (err?.code === "ER_DUP_ENTRY") {
            return res
                .status(409)
                .json({ ok: false, message: "ชื่อผู้ใช้หรืออีเมลถูกใช้แล้ว" });
        }
        console.error("register error:", err);
        return res
            .status(500)
            .json({ ok: false, message: "เกิดข้อผิดพลาดภายในระบบ" });
    }
});
exports.default = exports.router;
