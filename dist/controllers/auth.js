"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
const jws_1 = require("../middlewares/jws");
const upload_1 = require("./upload");
exports.router = express_1.default.Router();
exports.router.post("/", async (req, res) => {
    try {
        const { email, password } = req.body ?? {};
        if (typeof email !== "string" || typeof password !== "string") {
            return res
                .status(400)
                .json({ ok: false, message: "กรอกอีเมลและรหัสผ่าน" });
        }
        const [[user]] = await db_1.conn.query(`
      SELECT
        id,
        username,
        email,
        password_hash AS passwordHash,
        role,
        avatar_url AS avatarUrl,
        wallet_balance AS walletBalance
      FROM users
      WHERE email = ?
      LIMIT 1
    `, [email.toLowerCase()]);
        if (!user) {
            return res
                .status(401)
                .json({ ok: false, message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
        }
        const match = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!match) {
            return res
                .status(401)
                .json({ ok: false, message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
        }
        const avatarUrl = (0, upload_1.toAbsoluteUrl)(req, user.avatarUrl);
        const payload = {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            avatarUrl,
            walletBalance: Number(user.walletBalance ?? 0),
        };
        const token = (0, jws_1.generateToken)(payload);
        return res.json({ ok: true, token, user: payload });
    }
    catch (err) {
        console.error("LOGIN error:", err);
        return res
            .status(500)
            .json({ ok: false, message: "เกิดข้อผิดพลาด กรุณาลองใหม่" });
    }
});
