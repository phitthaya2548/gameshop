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
exports.router.get("/", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    try {
        const [[row]] = await db_1.conn.query(`SELECT
         id,
         username,
         email,
         role,
         wallet_balance   AS walletBalance,
         avatar_url       AS avatarUrl
       FROM users
       WHERE id = ?
       LIMIT 1`, [auth.id]);
        if (!row) {
            return res.status(404).json({ ok: false, message: "User not found" });
        }
        const avatarAbs = (0, upload_1.toAbsoluteUrl)(req, row.avatarUrl);
        return res.json({
            ok: true,
            user: {
                id: row.id,
                username: row.username,
                email: row.email,
                role: row.role,
                walletBalance: row.walletBalance ?? 0,
                avatarUrl: avatarAbs,
            },
        });
    }
    catch (e) {
        console.error("GET / (me) error:", e);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
});
exports.router.put("/", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    try {
        let { username, email, avatarBase64, oldPassword, newPassword } = req.body ?? {};
        // ----- partial update: เก็บ set/params แบบไดนามิก -----
        const sets = [];
        const params = [];
        // username (ถ้าส่งมา)
        if (username !== undefined) {
            if (typeof username !== "string")
                return res
                    .status(400)
                    .json({ ok: false, message: "username ต้องเป็นข้อความ" });
            username = username.trim();
            if (username.length < 2 || username.length > 50)
                return res
                    .status(400)
                    .json({ ok: false, message: "ชื่อผู้ใช้ 2–50 ตัวอักษร" });
            sets.push("username = ?");
            params.push(username);
        }
        // email (ถ้าส่งมา)
        if (email !== undefined) {
            if (typeof email !== "string")
                return res
                    .status(400)
                    .json({ ok: false, message: "email ต้องเป็นข้อความ" });
            email = email.trim().toLowerCase();
            const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
            if (!emailOk)
                return res.status(400).json({ ok: false, message: "อีเมลไม่ถูกต้อง" });
            // กันอีเมลซ้ำ
            const [dup] = await db_1.conn.query("SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1", [email, auth.id]);
            if (Array.isArray(dup) && dup.length > 0)
                return res
                    .status(409)
                    .json({ ok: false, message: "อีเมลนี้ถูกใช้แล้ว" });
            sets.push("email = ?");
            params.push(email);
        }
        let avatarUpdated = false;
        if (avatarBase64 !== undefined) {
            if (typeof avatarBase64 !== "string" ||
                !avatarBase64.startsWith("data:image/"))
                return res.status(400).json({ ok: false, message: "รูปภาพไม่ถูกต้อง" });
            const relPath = await (0, upload_1.saveImageFromBase64)(avatarBase64); // => "uploads/xxx.png"
            sets.push("avatar_url = ?");
            params.push(relPath);
            avatarUpdated = true;
        }
        // password (ถ้าส่งมาเป็นคู่)
        let passwordUpdated = false;
        if (oldPassword !== undefined || newPassword !== undefined) {
            if (typeof oldPassword !== "string" ||
                typeof newPassword !== "string" ||
                newPassword.length < 6)
                return res
                    .status(400)
                    .json({ ok: false, message: "payload เปลี่ยนรหัสผ่านไม่ถูกต้อง" });
            const [[rowPwd]] = await db_1.conn.query("SELECT password_hash AS passwordHash FROM users WHERE id = ? LIMIT 1", [auth.id]);
            if (!rowPwd)
                return res.status(404).json({ ok: false, message: "User not found" });
            const ok = await bcryptjs_1.default.compare(oldPassword, rowPwd.passwordHash);
            if (!ok)
                return res
                    .status(401)
                    .json({ ok: false, message: "รหัสผ่านเดิมไม่ถูกต้อง" });
            const hash = await bcryptjs_1.default.hash(newPassword, 10);
            sets.push("password_hash = ?");
            params.push(hash);
            passwordUpdated = true;
        }
        if (sets.length === 0) {
            return res
                .status(400)
                .json({ ok: false, message: "ไม่มีข้อมูลสำหรับอัปเดต" });
        }
        // ทำ UPDATE เดียว ครอบคลุมทุกฟิลด์ที่ส่งมา
        const [rs] = await db_1.conn.execute(`UPDATE users SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ? LIMIT 1`, [...params, auth.id]);
        if (rs.affectedRows === 0)
            return res.status(404).json({ ok: false, message: "ไม่พบผู้ใช้" });
        // ดึงล่าสุดตอบกลับ
        const [[row]] = await db_1.conn.query(`SELECT id, username, email, role, avatar_url AS avatarUrl, wallet_balance AS walletBalance
         FROM users WHERE id = ? LIMIT 1`, [auth.id]);
        if (!row)
            return res.status(404).json({ ok: false, message: "User not found" });
        return res.json({
            ok: true,
            message: passwordUpdated ? "เปลี่ยนรหัสผ่านสำเร็จ" : "บันทึกสำเร็จ",
            user: {
                id: row.id,
                username: row.username,
                email: row.email,
                role: row.role,
                avatarUrl: row.avatarUrl ? (0, upload_1.toAbsoluteUrl)(req, row.avatarUrl) : null,
                walletBalance: row.walletBalance != null ? Number(row.walletBalance) : 0,
            },
        });
    }
    catch (e) {
        if (e?.code === "ER_DUP_ENTRY")
            return res.status(409).json({ ok: false, message: "อีเมลนี้ถูกใช้แล้ว" });
        console.error("PUT /me error:", e);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
});
