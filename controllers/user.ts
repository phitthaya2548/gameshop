import bcrypt from "bcryptjs";
import express from "express";
import type { FieldPacket, ResultSetHeader, RowDataPacket } from "mysql2";
import { conn } from "../db";
import { saveImageBufferToUploads, toAbsoluteUrl, upload } from "./upload";

export const router = express.Router();

router.get("/", async (req, res) => {
  const auth = (req as any).auth as { id: number | string } | undefined;

  if (!auth)
    return res.status(401).json({ ok: false, message: "Unauthorized" });

  try {
    const [[row]] = await conn.query<RowDataPacket[]>(
      `SELECT
         id,
         username,
         email,
         role,
         wallet_balance   AS walletBalance,
         avatar_url       AS avatarUrl
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [auth.id]
    );

    if (!row) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }
    const avatarAbs = toAbsoluteUrl(req, row.avatarUrl);

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
  } catch (e) {
    console.error("GET / (me) error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});
router.get("/balance", async (req, res) => {
  const auth = (req as any).auth as { id: number } | undefined;
  if (!auth)
    return res.status(401).json({ ok: false, message: "Unauthorized" });

  try {
    const [[row]] = await conn.query<RowDataPacket[]>(
      "SELECT wallet_balance AS walletBalance FROM users WHERE id = ? LIMIT 1",
      [auth.id]
    );
    if (!row)
      return res.status(404).json({ ok: false, message: "User not found" });
    return res.json({ ok: true, walletBalance: row.walletBalance ?? 0 });
  } catch (e) {
    console.error("GET /balance error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});
router.get("/wallet/history", async (req, res) => {
  const auth = (req as any).auth as { id: number } | undefined;
  if (!auth)
    return res.status(401).json({ ok: false, message: "Unauthorized" });

  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT * FROM wallet_ledger WHERE user_id = ? ORDER BY created_at DESC",
      [auth.id]
    );
    return res.json(rows);
  } catch (e) {
    console.error("GET /wallet/history error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.post("/orders/buy", async (req, res) => {
  const auth = (req as any).auth as { id: number } | undefined;
  if (!auth)
    return res.status(401).json({ ok: false, message: "Unauthorized" });

  let gameIds: number[] = Array.isArray(req.body?.gameIds)
    ? req.body.gameIds
    : [];
  if (!gameIds.length && req.body?.gameId) {
    const one = Number(req.body.gameId);
    if (Number.isFinite(one) && one > 0) gameIds = [one];
  }
  gameIds = (gameIds || [])
    .map((v: any) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
  gameIds = Array.from(new Set(gameIds));

  if (!gameIds.length) {
    return res
      .status(400)
      .json({ ok: false, message: "กรุณาระบุเกมที่ต้องการซื้อ" });
  }

  const couponCode: string | undefined =
    typeof req.body?.couponCode === "string" && req.body.couponCode.trim()
      ? req.body.couponCode.trim().toUpperCase()
      : undefined;

  const db = await conn.getConnection();
  try {
    await db.beginTransaction();

    const [[me]] = await db.query<RowDataPacket[]>(
      `SELECT id, role, wallet_balance
         FROM users
        WHERE id = ? 
        LIMIT 1
        FOR UPDATE`,
      [auth.id]
    );
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

    const [games]: [RowDataPacket[], FieldPacket[]] = await db.query(
      `SELECT id, price
         FROM games
        WHERE id IN (?)`,
      [gameIds]
    );
    const foundIds = new Set(games.map((g: any) => Number(g.id)));
    const notFound = gameIds.filter((id) => !foundIds.has(id));
    if (notFound.length) {
      await db.rollback();
      return res.status(404).json({
        ok: false,
        message: "ไม่พบเกมบางรายการ",
        notFoundIds: notFound,
      });
    }

    const [owned]: [RowDataPacket[], FieldPacket[]] = await db.query(
      `SELECT game_id
         FROM order_items
        WHERE user_id = ? 
          AND game_id IN (?)`,
      [me.id, gameIds]
    );
    if (owned.length) {
      await db.rollback();
      return res.status(409).json({
        ok: false,
        message: "มีเกมที่คุณเป็นเจ้าของอยู่แล้ว ไม่สามารถซื้อซ้ำได้",
        alreadyOwnedIds: owned.map((r: any) => Number(r.game_id)),
      });
    }

    const totalBefore = games.reduce(
      (sum: number, g: any) => sum + Number(g.price || 0),
      0
    );

    let discountCodeId: number | null = null;
    let discountAmount = 0;

    if (couponCode) {
      const [[dc]] = await db.query<RowDataPacket[]>(
        `SELECT id, code, value, total_quota, used_count, per_user_limit
           FROM discount_codes
          WHERE code = ? 
          LIMIT 1
          FOR UPDATE`,
        [couponCode]
      );

      if (!dc) {
        await db.rollback();
        return res.status(404).json({ ok: false, message: "ไม่พบโค้ดส่วนลด" });
      }

      if (Number(dc.used_count) >= Number(dc.total_quota)) {
        await db.query(`DELETE FROM discount_codes WHERE id = ?`, [dc.id]);
        await db.rollback();
        return res.status(400).json({
          ok: false,
          message: "โค้ดนี้ใช้ครบโควตาแล้ว และถูกลบออกจากระบบแล้ว",
        });
      }

      const [countUsed]: [RowDataPacket[], FieldPacket[]] = await db.query(
        `SELECT COUNT(*) AS cnt
           FROM orders
          WHERE user_id = ? AND discount_code_id = ?`,
        [me.id, dc.id]
      );
      const already = Number(countUsed[0]?.cnt || 0);
      const limitPerUser = Number(dc.per_user_limit || 1);
      if (already >= limitPerUser) {
        await db.rollback();
        return res
          .status(409)
          .json({ ok: false, message: "คุณใช้โค้ดนี้ครบสิทธิ์แล้ว" });
      }

      const percent = Math.max(0, Math.min(100, Number(dc.value) || 0));
      discountAmount = +(totalBefore * (percent / 100)).toFixed(2);
      discountAmount = Math.min(discountAmount, totalBefore);

      discountCodeId = Number(dc.id);
    }

    const totalPaid = +(totalBefore - discountAmount).toFixed(2);

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

    const [orderRs] = await db.query<ResultSetHeader>(
      `INSERT INTO orders
         (user_id, total_before, discount_code_id, discount_amount, total_paid, created_at)
       VALUES (?, ?, ?, ?, ?, CONVERT_TZ(NOW(), '+00:00', '+07:00'))`,
      [me.id, totalBefore, discountCodeId, discountAmount, totalPaid]
    );
    const orderId = orderRs.insertId;

    const placeholders = games.map(() => "(?,?,?,?)").join(",");
    const params: any[] = [];
    for (const g of games) {
      params.push(orderId, me.id, Number(g.id), Number(g.price));
    }
    await db.query(
      `INSERT INTO order_items (order_id, user_id, game_id, unit_price)
       VALUES ${placeholders}`,
      params
    );

    const newBalance = +(wallet - totalPaid).toFixed(2);
    await db.query(`UPDATE users SET wallet_balance = ? WHERE id = ?`, [
      newBalance,
      me.id,
    ]);
    await db.query(
      `INSERT INTO wallet_ledger (user_id, type, amount, balance_after, note)
       VALUES (?, 'PURCHASE', ?, ?, ?)`,

      [
        me.id,
        -totalPaid,
        newBalance,
        `ซื้อ ${games.length} เกม${
          couponCode ? " (ใช้โค้ด " + couponCode + ")" : ""
        }`,
      ]
    );

    if (discountCodeId) {
      const [aff] = await db.query<ResultSetHeader>(
        `UPDATE discount_codes
            SET used_count = used_count + 1
          WHERE id = ? 
            AND used_count < total_quota`,
        [discountCodeId]
      );

      if (!aff.affectedRows) {
        await db.query(`DELETE FROM discount_codes WHERE id = ?`, [
          discountCodeId,
        ]);
        await db.rollback();
        return res.status(409).json({
          ok: false,
          message: "โค้ดนี้ถูกใช้ครบโควตาพอดี กรุณาลองใหม่",
        });
      }

      const [[after]] = await db.query<RowDataPacket[]>(
        `SELECT used_count, total_quota FROM discount_codes WHERE id = ?`,
        [discountCodeId]
      );
      if (after && Number(after.used_count) >= Number(after.total_quota)) {
        await db.query(`DELETE FROM discount_codes WHERE id = ?`, [
          discountCodeId,
        ]);
      }
    }

    await db.commit();
    await conn.query("DELETE FROM cart_items WHERE user_id=?", [auth.id]);
    return res.json({
      ok: true,
      message: "สั่งซื้อสำเร็จ",
      orderId,
      totalBefore,
      discountAmount,
      totalPaid,
      newBalance,
      couponCode: couponCode || null,
      purchasedGameIds: games.map((g: any) => Number(g.id)),
    });
  } catch (e: any) {
    await db.rollback();
    if (e?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        ok: false,
        message: "มีบางเกมเป็นเจ้าของอยู่แล้ว ไม่สามารถซื้อซ้ำได้",
      });
    }
    console.error("POST /orders/buy error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  } finally {
    db.release();
  }
});

router.post("/balance", async (req, res) => {
  const auth = (req as any).auth as { id: number } | undefined;
  if (!auth)
    return res.status(401).json({ ok: false, message: "Unauthorized" });

  const raw = req.body?.amount;
  const amount = Number(raw);

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ ok: false, message: "Invalid amount" });
  }

  const topup = +amount.toFixed(2);
  const note: string = String(req.body?.note ?? "เติมเงิน").slice(0, 255);

  const cx = await conn.getConnection();
  try {
    await cx.beginTransaction();

    const [[user]] = await cx.query<RowDataPacket[]>(
      "SELECT id, wallet_balance FROM users WHERE id = ? FOR UPDATE",
      [auth.id]
    );
    if (!user) {
      await cx.rollback();
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    const current = Number(user.wallet_balance ?? 0);
    const newBalance = +(current + topup).toFixed(2);

    await cx.query("UPDATE users SET wallet_balance = ? WHERE id = ?", [
      newBalance,
      auth.id,
    ]);

    await cx.query(
      `INSERT INTO wallet_ledger (user_id, type, amount, balance_after, note)
       VALUES (?, 'TOPUP', ?, ?, ?)`,
      [auth.id, topup, newBalance, note]
    );

    await cx.commit();
    return res.json({ ok: true, walletBalance: newBalance });
  } catch (e) {
    await cx.rollback();
    console.error("POST /balance error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  } finally {
    cx.release();
  }
});

router.put("/", upload.single("avatar"), async (req, res) => {
  const auth = (req as any).auth as { id: number } | undefined;
  if (!auth)
    return res.status(401).json({ ok: false, message: "Unauthorized" });

  try {
    let { username, email, oldPassword, newPassword } = req.body ?? {};
    const sets: string[] = [];
    const params: any[] = [];

    if (username !== undefined) {
      username = String(username).trim();
      if (username.length < 2 || username.length > 50)
        return res
          .status(400)
          .json({ ok: false, message: "ชื่อผู้ใช้ 2–50 ตัวอักษร" });
      sets.push("username = ?");
      params.push(username);
    }

    if (email !== undefined) {
      email = String(email).trim().toLowerCase();
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!ok)
        return res.status(400).json({ ok: false, message: "อีเมลไม่ถูกต้อง" });

      const [dup] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1",
        [email, auth.id]
      );
      if (Array.isArray(dup) && dup.length > 0)
        return res
          .status(409)
          .json({ ok: false, message: "อีเมลนี้ถูกใช้แล้ว" });

      sets.push("email = ?");
      params.push(email);
    }

    const file = req.file;
    if (file) {
      const relPath = saveImageBufferToUploads(file.buffer, file.mimetype);
      sets.push("avatar_url = ?");
      params.push(relPath);
    }

    if (oldPassword !== undefined || newPassword !== undefined) {
      if (
        typeof oldPassword !== "string" ||
        typeof newPassword !== "string" ||
        newPassword.length < 6
      ) {
        return res
          .status(400)
          .json({ ok: false, message: "payload เปลี่ยนรหัสผ่านไม่ถูกต้อง" });
      }
      const [[rowPwd]] = await conn.query<RowDataPacket[]>(
        "SELECT password_hash AS passwordHash FROM users WHERE id = ? LIMIT 1",
        [auth.id]
      );
      if (!rowPwd)
        return res.status(404).json({ ok: false, message: "User not found" });

      const ok = await bcrypt.compare(oldPassword, rowPwd.passwordHash);
      if (!ok)
        return res
          .status(401)
          .json({ ok: false, message: "รหัสผ่านเดิมไม่ถูกต้อง" });

      const hash = await bcrypt.hash(newPassword, 10);
      sets.push("password_hash = ?");
      params.push(hash);
    }

    if (sets.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "ไม่มีข้อมูลสำหรับอัปเดต" });
    }

    const [rs] = await conn.execute<ResultSetHeader>(
      `UPDATE users SET ${sets.join(
        ", "
      )}, updated_at = NOW() WHERE id = ? LIMIT 1`,
      [...params, auth.id]
    );
    if (rs.affectedRows === 0)
      return res.status(404).json({ ok: false, message: "ไม่พบผู้ใช้" });

    const [[row]] = await conn.query<RowDataPacket[]>(
      `SELECT id, username, email, role, avatar_url AS avatarUrl, wallet_balance AS walletBalance
           FROM users WHERE id = ? LIMIT 1`,
      [auth.id]
    );
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
        avatarUrl: toAbsoluteUrl(req, row.avatarUrl),
        walletBalance: row.walletBalance ?? 0,
      },
    });
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY")
      return res.status(409).json({ ok: false, message: "อีเมลนี้ถูกใช้แล้ว" });
    console.error("PUT /me error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});
router.get("/cart", async (req, res) => {
  const auth = (req as any).auth as { id: number } | undefined;
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
    const [rows]: any = await conn.query(sql, [auth.id]);

    const items = rows.map((r: any) => ({
      gameId: Number(r.gameId),
      qty: Number(r.qty || 1),
      title: r.title,
      price: Number(r.price || 0),
      image: toAbsoluteUrl(req, r.images) || null,
      categoryName: r.category_name,
      description: r.description,
      releaseDate: r.release_date,
    }));

    const subtotal = items.reduce(
      (s: number, it: any) => s + it.price * it.qty,
      0
    );
    return res.json({ ok: true, items, subtotal });
  } catch (e: any) {
    console.error("GET /cart error:", {
      code: e?.code,
      msg: e?.sqlMessage,
      sql: e?.sql,
    });
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});
router.post("/cart/add", async (req, res) => {
  const auth = (req as any).auth as
    | { id: number; role?: "user" | "admin" }
    | undefined;

  // Check if user is authenticated
  if (!auth) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  try {
    let role = auth.role;

    if (!role) {
      const [[u]] = await conn.query<RowDataPacket[]>(
        "SELECT role FROM users WHERE id=? LIMIT 1",
        [auth.id]
      );
      if (!u) {
        return res.status(401).json({ ok: false, message: "Unauthorized" });
      }
      role = u.role as "user" | "admin";
    }

    if (role === "admin") {
      return res.status(403).json({
        ok: false,
        message: "บัญชีผู้ดูแลระบบไม่สามารถเพิ่มสินค้าในตะกร้าได้",
      });
    }
  } catch (e) {
    console.error("Role check error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }

  const gameId = Number(req.body?.gameId);

  if (!Number.isFinite(gameId) || gameId <= 0) {
    return res.status(400).json({ ok: false, message: "Invalid gameId" });
  }

  const sql = `
    INSERT INTO cart_items (user_id, game_id, qty)
    SELECT ?, ?, 1
    FROM DUAL
    WHERE EXISTS (SELECT 1 FROM games WHERE id = ?)
      AND NOT EXISTS (SELECT 1 FROM order_items WHERE user_id = ? AND game_id = ?)
    ON DUPLICATE KEY UPDATE
      qty = CASE WHEN qty < 99 THEN qty + 1 ELSE qty END
  `;

  const params = [auth.id, gameId, gameId, auth.id, gameId];

  const execWithRetry = async (tries = 3) => {
    let n = 0;
    for (;;) {
      try {
        const [r]: any = await conn.execute(sql, params);
        return r;
      } catch (e: any) {
        if (
          (e?.code === "ER_LOCK_WAIT_TIMEOUT" || e?.code === "ER_DEADLOCK") &&
          n < tries
        ) {
          await new Promise((r) => setTimeout(r, 60 * Math.pow(2, n)));
          n++;
          continue;
        }
        throw e;
      }
    }
  };

  try {
    const result: any = await execWithRetry();

    if (result.affectedRows === 1) {
      return res.json({ ok: true, message: "เพิ่มลงตะกร้าแล้ว" });
    }

    if (result.affectedRows === 2) {
      if (typeof result.changedRows === "number" && result.changedRows === 0) {
        return res.json({
          ok: true,
          message: "อยู่ในตะกร้าแล้ว (ครบจำนวนสูงสุด)",
        });
      }
      return res.json({ ok: true, message: "เพิ่มจำนวนเกมในตะกร้าแล้ว" });
    }

    const [[g]] = await conn.query<RowDataPacket[]>(
      "SELECT id FROM games WHERE id=? LIMIT 1",
      [gameId]
    );

    if (!g) return res.status(404).json({ ok: false, message: "ไม่พบเกม" });

    const [[own]] = await conn.query<RowDataPacket[]>(
      "SELECT 1 FROM order_items WHERE user_id=? AND game_id=? LIMIT 1",
      [auth.id, gameId]
    );

    if (own) {
      return res.status(409).json({
        ok: false,
        message: "คุณเป็นเจ้าของเกมนี้แล้ว ไม่สามารถเพิ่มในตะกร้าได้",
      });
    }

    return res.status(409).json({
      ok: false,
      message: "ไม่สามารถเพิ่มสินค้าลงตะกร้าได้",
    });
  } catch (e: any) {
    if (e?.code === "ER_LOCK_WAIT_TIMEOUT" || e?.code === "ER_DEADLOCK") {
      return res.status(409).json({
        ok: false,
        message: "ระบบไม่พร้อม โปรดลองอีกครั้ง",
      });
    }
    console.error("POST /cart/add error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.delete("/cart/:gameId", async (req, res) => {
  const auth = (req as any).auth as { id: number } | undefined;
  if (!auth)
    return res.status(401).json({ ok: false, message: "Unauthorized" });

  const gameId = Number(req.params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return res.status(400).json({ ok: false, message: "Invalid gameId" });
  }

  const sql = `DELETE FROM cart_items WHERE user_id=? AND game_id=? LIMIT 1`;
  const params = [auth.id, gameId];

  try {
    const [result]: any = await conn.execute(sql, params);

    // ตรวจสอบว่ามีการลบสินค้า
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, message: "ไม่พบรายการในตะกร้า" });
    }

    // รีเฟรชข้อมูลตะกร้า
    const sqlFetchUpdatedCart = `
      SELECT
        ci.game_id AS gameId,
        COALESCE(ci.qty, 1) AS qty,
        g.title,
        g.price,
        g.images,
        g.category_name,
        g.description,
        g.release_date
      FROM cart_items ci
      JOIN games g ON g.id = ci.game_id
      WHERE ci.user_id = ?
      ORDER BY ci.id DESC
    `;
    const [updatedRows]: any = await conn.query(sqlFetchUpdatedCart, [auth.id]);

    const items = updatedRows.map((r: any) => ({
      gameId: Number(r.gameId),
      qty: Number(r.qty || 1),
      title: r.title,
      price: Number(r.price || 0),
      image: toAbsoluteUrl(req, r.images) || null,
      categoryName: r.category_name,
      description: r.description,
      releaseDate: r.release_date,
    }));

    const subtotal = items.reduce(
      (s: number, it: any) => s + it.price * it.qty,
      0
    );

    return res.json({ ok: true, message: "ลบออกจากตะกร้าแล้ว", items, subtotal });
  } catch (e: any) {
    console.error("DELETE /cart/:gameId error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.post("/checkout", async (req, res) => {
  const auth = (req as any).auth as { id: number } | undefined;
  if (!auth)
    return res.status(401).json({ ok: false, message: "Unauthorized" });

  try {
    const [rs] = await conn.query<ResultSetHeader>(
      `DELETE FROM cart_items WHERE user_id=?`,
      [auth.id]
    );
    if (!rs.affectedRows) {
      return res.status(404).json({ ok: false, message: "ไม่พบตะกร้า" });
    }
    return res.json({ ok: true, message: "สั่งซื้อเรียบร้อยแล้ว" });
  } catch (e) {
    console.error("POST /checkout error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});
router.get("/mygames", async (req, res) => {
  const auth = (req as any).auth as { id: number } | undefined;
  if (!auth)
    return res.status(401).json({ ok: false, message: "Unauthorized" });

  try {
    // ดึงข้อมูลยอดรวมรายได้และเกมที่ผู้ใช้ซื้อ
    const sql = `
      WITH sales AS (
        SELECT
          g.id AS game_id,
          COALESCE(SUM(oi.unit_price), 0) AS revenue
        FROM games g
        LEFT JOIN order_items oi ON oi.game_id = g.id
        LEFT JOIN orders o ON o.id = oi.order_id
        GROUP BY g.id
      ),
      mine AS (
        SELECT
          oi.game_id,
          MAX(o.created_at) AS purchasedAt
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.user_id = ?
        GROUP BY oi.game_id
      )
      SELECT
        m.game_id              AS gameId,
        g.title,
        g.price,
        g.category_name        AS categoryName,
        g.description,
        g.release_date         AS releaseDate,
        g.images,
        m.purchasedAt,
        s.revenue
      FROM mine m
      JOIN games g ON g.id = m.game_id
      LEFT JOIN sales s ON s.game_id = m.game_id
      ORDER BY m.purchasedAt DESC; -- ลบ LIMIT 5 ออก เพื่อแสดงทั้งหมด
    `;

    const [rows] = await conn.query<RowDataPacket[]>(sql, [auth.id]);

    const purchases = rows.map((r) => ({
      gameId: Number(r.gameId),
      title: r.title,
      price: Number(r.price || 0),
      categoryName: r.categoryName ?? null,
      description: r.description ?? null,
      releaseDate: r.releaseDate ?? null,
      purchasedAt: r.purchasedAt ?? null,
      image: r.images ? toAbsoluteUrl(req, r.images) : null,
      revenue: Number(r.revenue ?? 0),
    }));

    return res.json({
      ok: true,
      count: purchases.length,
      purchases,
    });
  } catch (e) {
    console.error("GET /mygames error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});
