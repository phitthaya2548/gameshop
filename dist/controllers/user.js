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
exports.router.get("/balance", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    try {
        const [[row]] = await db_1.conn.query("SELECT wallet_balance AS walletBalance FROM users WHERE id = ? LIMIT 1", [auth.id]);
        if (!row)
            return res.status(404).json({ ok: false, message: "User not found" });
        return res.json({ ok: true, walletBalance: row.walletBalance ?? 0 });
    }
    catch (e) {
        console.error("GET /balance error:", e);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
});
exports.router.get("/wallet/history", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    try {
        // ดึงประวัติการทำรายการจากตาราง wallet_ledger
        const [rows] = await db_1.conn.query("SELECT * FROM wallet_ledger WHERE user_id = ? ORDER BY created_at DESC", [auth.id]);
        return res.json(rows); // ส่งกลับรายการธุรกรรมทั้งหมด
    }
    catch (e) {
        console.error("GET /wallet/history error:", e);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
});
exports.router.post("/orders/buy", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    // 1) รับ input: รองรับทั้ง gameId เดี่ยว และ gameIds (array)
    let gameIds = Array.isArray(req.body?.gameIds)
        ? req.body.gameIds
        : [];
    if (!gameIds.length && req.body?.gameId) {
        const one = Number(req.body.gameId);
        if (Number.isFinite(one) && one > 0)
            gameIds = [one];
    }
    gameIds = (gameIds || [])
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0);
    gameIds = Array.from(new Set(gameIds)); // กันส่งซ้ำเอง
    if (!gameIds.length) {
        return res
            .status(400)
            .json({ ok: false, message: "กรุณาระบุเกมที่ต้องการซื้อ" });
    }
    // คูปอง (optional) — เราจะคิดเปอร์เซ็นต์เท่านั้น
    const couponCode = typeof req.body?.couponCode === "string" && req.body.couponCode.trim()
        ? req.body.couponCode.trim().toUpperCase()
        : undefined;
    const db = await db_1.conn.getConnection();
    try {
        await db.beginTransaction();
        // 2) ล็อคผู้ใช้ ป้องกันแข่งกันตัดเงิน
        const [[me]] = await db.query(`SELECT id, role, wallet_balance
         FROM users
        WHERE id = ?
        LIMIT 1
        FOR UPDATE`, [auth.id]);
        if (!me) {
            await db.rollback();
            return res.status(401).json({ ok: false, message: "Unauthorized" });
        }
        if (me.role !== "user") {
            await db.rollback();
            return res
                .status(403)
                .json({ ok: false, message: "ต้องเป็นสมาชิก (user) ก่อนจึงจะซื้อได้" });
        }
        // 3) ดึงราคาเกม
        const [games] = await db.query(`SELECT id, price
         FROM games
        WHERE id IN (?)`, [gameIds]);
        const foundIds = new Set(games.map((g) => Number(g.id)));
        const notFound = gameIds.filter((id) => !foundIds.has(id));
        if (notFound.length) {
            await db.rollback();
            return res.status(404).json({
                ok: false,
                message: "ไม่พบเกมบางรายการ",
                notFoundIds: notFound,
            });
        }
        // 4) กันซื้อซ้ำ (ผู้ใช้ห้ามมีเกมเดิมอยู่แล้ว)
        const [owned] = await db.query(`SELECT game_id
         FROM order_items
        WHERE user_id = ?
          AND game_id IN (?)`, [me.id, gameIds]);
        if (owned.length) {
            await db.rollback();
            return res.status(409).json({
                ok: false,
                message: "มีเกมที่คุณเป็นเจ้าของอยู่แล้ว ไม่สามารถซื้อซ้ำได้",
                alreadyOwnedIds: owned.map((r) => Number(r.game_id)),
            });
        }
        // 5) รวมราคาเต็มก่อนหักส่วนลด
        const totalBefore = games.reduce((sum, g) => sum + Number(g.price || 0), 0);
        // 6) ส่วนลดแบบเปอร์เซ็นต์เท่านั้น (ไม่เช็ควันหมดอายุ/สถานะ)
        let discountCodeId = null;
        let discountAmount = 0;
        if (couponCode) {
            // ล็อคคูปอง
            const [[dc]] = await db.query(`SELECT id, code, value, total_quota, used_count, per_user_limit
           FROM discount_codes
          WHERE code = ?
          LIMIT 1
          FOR UPDATE`, [couponCode]);
            if (!dc) {
                await db.rollback();
                return res.status(404).json({ ok: false, message: "ไม่พบโค้ดส่วนลด" });
            }
            // ถ้าใช้ครบโควตาแล้ว -> ลบทันที และแจ้ง
            if (Number(dc.used_count) >= Number(dc.total_quota)) {
                await db.query(`DELETE FROM discount_codes WHERE id = ?`, [dc.id]);
                await db.rollback();
                return res.status(400).json({
                    ok: false,
                    message: "โค้ดนี้ใช้ครบโควตาแล้ว และถูกลบออกจากระบบแล้ว",
                });
            }
            // จำกัดสิทธิ์ต่อผู้ใช้ (ค่า default 1)
            const [countUsed] = await db.query(`SELECT COUNT(*) AS cnt
           FROM orders
          WHERE user_id = ? AND discount_code_id = ?`, [me.id, dc.id]);
            const already = Number(countUsed[0]?.cnt || 0);
            const limitPerUser = Number(dc.per_user_limit || 1);
            if (already >= limitPerUser) {
                await db.rollback();
                return res
                    .status(409)
                    .json({ ok: false, message: "คุณใช้โค้ดนี้ครบสิทธิ์แล้ว" });
            }
            // ✅ คิดเป็นเปอร์เซ็นต์เท่านั้น (0-100)
            const percent = Math.max(0, Math.min(100, Number(dc.value) || 0));
            discountAmount = +(totalBefore * (percent / 100)).toFixed(2);
            discountAmount = Math.min(discountAmount, totalBefore);
            discountCodeId = Number(dc.id);
        }
        const totalPaid = +(totalBefore - discountAmount).toFixed(2);
        // 7) เงินพอไหม
        const wallet = Number(me.wallet_balance || 0);
        if (wallet < totalPaid) {
            await db.rollback();
            return res.status(400).json({
                ok: false,
                message: "ยอดเงินในกระเป๋าไม่พอ",
                needed: totalPaid,
                currentBalance: wallet,
            });
        }
        // 8) สร้าง order
        const [orderRs] = await db.query(`INSERT INTO orders
         (user_id, total_before, discount_code_id, discount_amount, total_paid)
       VALUES (?, ?, ?, ?, ?)`, [me.id, totalBefore, discountCodeId, discountAmount, totalPaid]);
        const orderId = orderRs.insertId;
        // 9) เพิ่มรายการเกม
        const placeholders = games.map(() => "(?,?,?,?)").join(",");
        const params = [];
        for (const g of games) {
            params.push(orderId, me.id, Number(g.id), Number(g.price));
        }
        await db.query(`INSERT INTO order_items (order_id, user_id, game_id, unit_price)
       VALUES ${placeholders}`, params);
        // 10) ตัดเงิน + ลงเล่มบัญชี
        const newBalance = +(wallet - totalPaid).toFixed(2);
        await db.query(`UPDATE users SET wallet_balance = ? WHERE id = ?`, [
            newBalance,
            me.id,
        ]);
        await db.query(`INSERT INTO wallet_ledger (user_id, type, amount, balance_after, note)
       VALUES (?, 'PURCHASE', ?, ?, ?)`, [
            me.id,
            -totalPaid,
            newBalance,
            `ซื้อ ${games.length} เกม${couponCode ? " (ใช้โค้ด " + couponCode + ")" : ""}`,
        ]);
        // 11) นับใช้คูปอง + ลบทันทีถ้าเต็มหลังเพิ่ม
        if (discountCodeId) {
            const [aff] = await db.query(`UPDATE discount_codes
            SET used_count = used_count + 1
          WHERE id = ?
            AND used_count < total_quota`, [discountCodeId]);
            if (!aff.affectedRows) {
                // มีคนอื่นใช้จนเต็มพอดี -> ลบทิ้งและ rollback
                await db.query(`DELETE FROM discount_codes WHERE id = ?`, [
                    discountCodeId,
                ]);
                await db.rollback();
                return res.status(409).json({
                    ok: false,
                    message: "โค้ดนี้ถูกใช้ครบโควตาพอดี กรุณาลองใหม่",
                });
            }
            // เช็คอีกครั้ง ถ้าเต็มแล้วให้ลบออกเพื่อเคลียร์
            const [[after]] = await db.query(`SELECT used_count, total_quota FROM discount_codes WHERE id = ?`, [discountCodeId]);
            if (after && Number(after.used_count) >= Number(after.total_quota)) {
                await db.query(`DELETE FROM discount_codes WHERE id = ?`, [
                    discountCodeId,
                ]);
            }
        }
        await db.commit();
        await db_1.conn.query("DELETE FROM cart_items WHERE user_id=?", [auth.id]);
        return res.json({
            ok: true,
            message: "สั่งซื้อสำเร็จ",
            orderId,
            totalBefore,
            discountAmount,
            totalPaid,
            newBalance,
            couponCode: couponCode || null,
            purchasedGameIds: games.map((g) => Number(g.id)),
        });
    }
    catch (e) {
        await db.rollback();
        if (e?.code === "ER_DUP_ENTRY") {
            // กันชน UNIQUE user_id+game_id
            return res.status(409).json({
                ok: false,
                message: "มีบางเกมเป็นเจ้าของอยู่แล้ว ไม่สามารถซื้อซ้ำได้",
            });
        }
        console.error("POST /orders/buy error:", e);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
    finally {
        db.release();
    }
});
exports.router.post("/balance", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    const raw = req.body?.amount;
    const amount = Number(raw);
    // ต้องเป็นตัวเลขบวก
    if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ ok: false, message: "Invalid amount" });
    }
    // ปัดให้ชัดเจน 2 ตำแหน่ง (กันเศษทศนิยมลอย)
    const topup = +amount.toFixed(2);
    const note = String(req.body?.note ?? "เติมเงิน").slice(0, 255);
    const cx = await db_1.conn.getConnection();
    try {
        await cx.beginTransaction();
        // ล็อคแถวผู้ใช้ กันแข่งกันอัปเดต
        const [[user]] = await cx.query("SELECT id, wallet_balance FROM users WHERE id = ? FOR UPDATE", [auth.id]);
        if (!user) {
            await cx.rollback();
            return res.status(404).json({ ok: false, message: "User not found" });
        }
        // MySQL DECIMAL -> string, แปลงเป็น number ก่อนคำนวณ
        const current = Number(user.wallet_balance ?? 0);
        const newBalance = +(current + topup).toFixed(2);
        // อัปเดตยอดกระเป๋า
        await cx.query("UPDATE users SET wallet_balance = ? WHERE id = ?", [
            newBalance,
            auth.id,
        ]);
        // ลงสมุดบัญชี (TOPUP เป็นจำนวนบวก)
        await cx.query(`INSERT INTO wallet_ledger (user_id, type, amount, balance_after, note)
       VALUES (?, 'TOPUP', ?, ?, ?)`, [auth.id, topup, newBalance, note]);
        await cx.commit();
        return res.json({ ok: true, walletBalance: newBalance });
    }
    catch (e) {
        await cx.rollback();
        console.error("POST /balance error:", e);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
    finally {
        cx.release();
    }
});
exports.router.put("/", upload_1.upload.single("avatar"), async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    try {
        let { username, email, oldPassword, newPassword } = req.body ?? {};
        const sets = [];
        const params = [];
        // username
        if (username !== undefined) {
            username = String(username).trim();
            if (username.length < 2 || username.length > 50)
                return res
                    .status(400)
                    .json({ ok: false, message: "ชื่อผู้ใช้ 2–50 ตัวอักษร" });
            sets.push("username = ?");
            params.push(username);
        }
        // email
        if (email !== undefined) {
            email = String(email).trim().toLowerCase();
            const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
            if (!ok)
                return res.status(400).json({ ok: false, message: "อีเมลไม่ถูกต้อง" });
            const [dup] = await db_1.conn.query("SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1", [email, auth.id]);
            if (Array.isArray(dup) && dup.length > 0)
                return res
                    .status(409)
                    .json({ ok: false, message: "อีเมลนี้ถูกใช้แล้ว" });
            sets.push("email = ?");
            params.push(email);
        }
        // avatar (ไฟล์จริงจาก multer)
        const file = req.file; // Express.Multer.File | undefined
        if (file) {
            const relPath = (0, upload_1.saveImageBufferToUploads)(file.buffer, file.mimetype);
            sets.push("avatar_url = ?");
            params.push(relPath);
        }
        // เปลี่ยนรหัสผ่าน (ถ้าส่งมาเป็นคู่)
        if (oldPassword !== undefined || newPassword !== undefined) {
            if (typeof oldPassword !== "string" ||
                typeof newPassword !== "string" ||
                newPassword.length < 6) {
                return res
                    .status(400)
                    .json({ ok: false, message: "payload เปลี่ยนรหัสผ่านไม่ถูกต้อง" });
            }
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
        }
        if (sets.length === 0) {
            return res
                .status(400)
                .json({ ok: false, message: "ไม่มีข้อมูลสำหรับอัปเดต" });
        }
        const [rs] = await db_1.conn.execute(`UPDATE users SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ? LIMIT 1`, [...params, auth.id]);
        if (rs.affectedRows === 0)
            return res.status(404).json({ ok: false, message: "ไม่พบผู้ใช้" });
        const [[row]] = await db_1.conn.query(`SELECT id, username, email, role, avatar_url AS avatarUrl, wallet_balance AS walletBalance
           FROM users WHERE id = ? LIMIT 1`, [auth.id]);
        if (!row)
            return res.status(404).json({ ok: false, message: "User not found" });
        return res.json({
            ok: true,
            message: "บันทึกสำเร็จ",
            user: {
                id: row.id,
                username: row.username,
                email: row.email,
                role: row.role,
                avatarUrl: (0, upload_1.toAbsoluteUrl)(req, row.avatarUrl),
                walletBalance: row.walletBalance ?? 0,
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
exports.router.get("/cart", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    try {
        const sql = `
      SELECT
  ci.game_id            AS gameId,
  COALESCE(ci.qty, 1)    AS qty,
  g.title,
  g.price,
  g.images,              -- Added comma here
  g.category_name,       -- Added comma here
  g.description,         -- Added comma here
  g.release_date
FROM cart_items ci
JOIN games g ON g.id = ci.game_id
WHERE ci.user_id = ?
ORDER BY ci.id DESC        
    `;
        const [rows] = await db_1.conn.query(sql, [auth.id]);
        const items = rows.map((r) => ({
            gameId: Number(r.gameId),
            qty: Number(r.qty || 1),
            title: r.title,
            price: Number(r.price || 0),
            image: (0, upload_1.toAbsoluteUrl)(req, r.images) || null,
            categoryName: r.category_name,
            description: r.description,
            releaseDate: r.release_date,
        }));
        const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
        return res.json({ ok: true, items, subtotal });
    }
    catch (e) {
        console.error("GET /cart error:", {
            code: e?.code,
            msg: e?.sqlMessage,
            sql: e?.sql,
        });
        return res.status(500).json({ ok: false, message: "Server error" });
    }
});
exports.router.post("/cart/add", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    // ⛔ บล็อก admin
    try {
        let role = auth.role;
        if (!role) {
            const [[u]] = await db_1.conn.query("SELECT role FROM users WHERE id=? LIMIT 1", [auth.id]);
            if (!u)
                return res.status(401).json({ ok: false, message: "Unauthorized" });
            role = u.role;
        }
        if (role === "admin") {
            return res.status(403).json({
                ok: false,
                message: "บัญชีผู้ดูแลระบบไม่สามารถเพิ่มสินค้าในตะกร้าได้",
            });
        }
    }
    catch (e) {
        console.error("role check error:", e);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
    const gameId = Number(req.body?.gameId);
    if (!Number.isFinite(gameId) || gameId <= 0) {
        return res.status(400).json({ ok: false, message: "Invalid gameId" });
    }
    const db = await db_1.conn.getConnection();
    try {
        // ลดโอกาส gap/next-key lock
        await db.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED");
        // ✅ คำสั่งเดียวจบ: แทรกเฉพาะเมื่อมีเกมอยู่จริงและยังไม่เป็นเจ้าของ
        // ถ้ามีอยู่ในตะกร้าแล้วจะ UPDATE qty (+1) แบบ atomic
        const sql = `
  INSERT INTO cart_items (user_id, game_id, qty)
  SELECT ?, ?, 1
  FROM DUAL
  WHERE EXISTS (SELECT 1 FROM games WHERE id = ?)
    AND NOT EXISTS (SELECT 1 FROM order_items WHERE user_id = ? AND game_id = ?)
  ON DUPLICATE KEY UPDATE
    qty = LEAST(qty + 1, 99)
`;
        const params = [auth.id, gameId, gameId, auth.id, gameId];
        // retry สั้น ๆ กรณีชน lock/deadlock
        const execWithRetry = async () => {
            let n = 0;
            for (;;) {
                try {
                    const [r] = await db.execute(sql, params);
                    return r;
                }
                catch (e) {
                    if ((e?.code === "ER_LOCK_WAIT_TIMEOUT" || e?.code === "ER_DEADLOCK") &&
                        n < 3) {
                        await new Promise((r) => setTimeout(r, 60 * Math.pow(2, n)));
                        n++;
                        continue;
                    }
                    throw e;
                }
            }
        };
        const result = await execWithRetry();
        // MySQL semantics:
        // - insert ใหม่ => affectedRows = 1
        // - duplicate → update => affectedRows = 2
        // - guard ไม่ผ่าน (ไม่พบเกม/เป็นเจ้าของแล้ว) => affectedRows = 0
        if (result.affectedRows === 1) {
            return res.json({ ok: true, message: "เพิ่มลงตะกร้าแล้ว" });
        }
        if (result.affectedRows === 2) {
            return res.json({ ok: true, message: "เพิ่มจำนวนเกมในตะกร้าแล้ว" });
        }
        // affectedRows = 0 → หาเหตุผลเพื่อข้อความที่ถูกต้อง
        const [[g]] = await db.query("SELECT id FROM games WHERE id=? LIMIT 1", [gameId]);
        if (!g)
            return res.status(404).json({ ok: false, message: "ไม่พบเกม" });
        const [[own]] = await db.query("SELECT 1 FROM order_items WHERE user_id=? AND game_id=? LIMIT 1", [auth.id, gameId]);
        if (own) {
            return res.status(409).json({
                ok: false,
                message: "คุณเป็นเจ้าของเกมนี้แล้ว ไม่สามารถเพิ่มในตะกร้าได้",
            });
        }
        // กรณีอื่น ๆ (ไม่น่าเกิด)
        return res
            .status(409)
            .json({ ok: false, message: "ไม่สามารถเพิ่มสินค้าลงตะกร้าได้" });
    }
    catch (e) {
        if (e?.code === "ER_LOCK_WAIT_TIMEOUT" || e?.code === "ER_DEADLOCK") {
            return res
                .status(409)
                .json({ ok: false, message: "ระบบไม่พร้อม โปรดลองอีกครั้ง" });
        }
        console.error("POST /cart/add error:", e);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
    finally {
        db.release();
    }
});
exports.router.delete("/cart/:gameId", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    const gameId = Number(req.params.gameId);
    if (!Number.isFinite(gameId) || gameId <= 0) {
        return res.status(400).json({ ok: false, message: "Invalid gameId" });
    }
    const db = await db_1.conn.getConnection();
    try {
        // ลดโอกาส gap/next-key lock สำหรับคำสั่งสั้น ๆ
        await db.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED");
        const sql = `DELETE FROM cart_items WHERE user_id=? AND game_id=? LIMIT 1`;
        const params = [auth.id, gameId];
        // retry สั้น ๆ เมื่อชน lock/deadlock
        const execWithRetry = async () => {
            let n = 0;
            for (;;) {
                try {
                    const [r] = await db.execute(sql, params);
                    r;
                }
                catch (e) {
                    if ((e?.code === "ER_LOCK_WAIT_TIMEOUT" || e?.code === "ER_DEADLOCK") &&
                        n < 3) {
                        await new Promise((r) => setTimeout(r, 60 * Math.pow(2, n))); // 60ms, 120ms, 240ms
                        n++;
                        continue;
                    }
                    throw e;
                }
            }
        };
        const result = await execWithRetry();
        if (!result.affectedRows) {
            res.status(404).json({ ok: false, message: "ไม่พบรายการในตะกร้า" });
        }
        res.json({ ok: true, message: "ลบออกจากตะกร้าแล้ว" });
    }
    catch (e) {
        if (e?.code === "ER_LOCK_WAIT_TIMEOUT" || e?.code === "ER_DEADLOCK") {
            return res
                .status(409)
                .json({ ok: false, message: "ระบบไม่พร้อม โปรดลองอีกครั้ง" });
        }
        console.error("DELETE /cart/:gameId error:", e);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
    finally {
        db.release();
    }
});
exports.router.post("/checkout", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    try {
        const [rs] = await db_1.conn.query(`DELETE FROM cart_items WHERE user_id=?`, [auth.id]);
        if (!rs.affectedRows) {
            return res.status(404).json({ ok: false, message: "ไม่พบตะกร้า" });
        }
        return res.json({ ok: true, message: "สั่งซื้อเรียบร้อยแล้ว" });
    }
    catch (e) {
        console.error("POST /checkout error:", e);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
});
exports.router.get("/mygames", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    try {
        // หมายเหตุ: ปกติคุณกันซื้อซ้ำไว้แล้ว จึง 1 เกมจะมีได้แค่ครั้งเดียว
        const sql = `
      SELECT
        oi.game_id               AS gameId,
        g.title,
        g.price,
        g.category_name          AS categoryName,
        g.description,
        g.release_date           AS releaseDate,
        g.images,                              -- เก็บเป็น path/URL
        o.created_at             AS purchasedAt
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN games  g ON g.id = oi.game_id
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC, oi.id DESC
    `;
        const [rows] = await db_1.conn.query(sql, [auth.id]);
        const purchases = rows.map((r) => ({
            gameId: Number(r.gameId),
            title: r.title,
            price: Number(r.price || 0),
            categoryName: r.categoryName ?? null,
            description: r.description ?? null,
            releaseDate: r.releaseDate ?? null,
            purchasedAt: r.purchasedAt ?? null,
            image: r.images ? (0, upload_1.toAbsoluteUrl)(req, r.images) : null, // แปลงเป็น absolute URL
        }));
        // ไม่ต้องเช็ค length ฝั่งเซิร์ฟเวอร์ — ส่ง array กลับไปตรง ๆ
        // ฝั่ง Client จะเช็คว่ามี array ว่างหรือไม่เพื่อแสดง "ยังไม่มีเกม"
        return res.json({
            ok: true,
            count: purchases.length, // เผื่อ UI ใช้นับจำนวน
            purchases,
        });
    }
    catch (e) {
        console.error("GET /orders/my-games error:", e);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
});
