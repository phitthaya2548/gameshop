import express from "express";
import { conn } from "../db";
import { Draw } from "../models/draw";

export const router = express.Router();

import type { RequestHandler } from "express";

const checkPrizes: RequestHandler = async (req, res) => {
  const drawNumber = Number(req.query.drawNumber ?? req.query.draw_number);
  const ticketNumber =
    typeof req.query.ticketNumber === "string"
      ? req.query.ticketNumber.trim()
      : undefined;
  const buyerId =
    req.query.buyerUserId ?? req.query.buyer_user_id
      ? Number(req.query.buyerUserId ?? req.query.buyer_user_id)
      : undefined;

  // validate input mode
  if (
    !Number.isInteger(drawNumber) ||
    (ticketNumber == null && !Number.isInteger(buyerId!))
  ) {
    res.status(400).json({
      success: false,
      message:
        "ต้องระบุ drawNumber:int และอย่างน้อยหนึ่งใน ticketNumber:string หรือ buyerUserId:int",
    });
    return;
  }

  // ดึงข้อมูลงวดจาก draw_number
  const [drawRows] = await conn.promise().query(
    `SELECT id, status,
              win1_full, win2_full, win3_full,
              win_last3, win_last2,
              prize1_amount, prize2_amount, prize3_amount,
              last3_amount, last2_amount
       FROM draws
       WHERE draw_number = ?`,
    [drawNumber]
  );

  const draw = Array.isArray(drawRows) && (drawRows[0] as any);
  if (!draw) {
    res
      .status(404)
      .json({ success: false, message: "ไม่พบงวดนี้ (draw_number)" });
    return;
  }

  if (draw.status !== "CLOSED") {
    res.status(409).json({
      success: false,
      message: "งวดยังไม่ปิดประกาศผล (status != CLOSED)",
    });
    return;
  }

  // เตรียมรายการตั๋วที่จะตรวจ
  let ticketList: Array<{ ticket_number: string }> = [];

  if (ticketNumber) {
    ticketList = [{ ticket_number: ticketNumber }];
  } else if (Number.isInteger(buyerId)) {
    const [tRows] = await conn.promise().query(
      `SELECT t.ticket_number
         FROM tickets t
         INNER JOIN draws d ON d.id = t.draw_id
         WHERE d.draw_number = ? AND t.buyer_user_id = ?`,
      [drawNumber, buyerId]
    );
    ticketList = (tRows as any[]).map((r) => ({
      ticket_number: r.ticket_number,
    }));
  }

  if (ticketList.length === 0) {
    res.json({
      success: true,
      drawNumber,
      count: 0,
      results: [],
      note: "ไม่มีตั๋วให้ตรวจในเงื่อนไขที่ส่งมา",
    });
    return;
  }

  // ฟังก์ชันตรวจรางวัลใบเดียว
  type PrizeHit = {
    prize: "PRIZE1" | "PRIZE2" | "PRIZE3" | "LAST3" | "LAST2";
    amount: number;
  };

  const judgeTicket = (num: string) => {
    const n6 = (num ?? "").trim();
    const last3 = n6.slice(-3);
    const last2 = n6.slice(-2);

    const hits: PrizeHit[] = [];

    if (draw.win1_full && n6 === draw.win1_full) {
      hits.push({ prize: "PRIZE1", amount: Number(draw.prize1_amount) });
    }
    if (draw.win2_full && n6 === draw.win2_full) {
      hits.push({ prize: "PRIZE2", amount: Number(draw.prize2_amount) });
    }
    if (draw.win3_full && n6 === draw.win3_full) {
      hits.push({ prize: "PRIZE3", amount: Number(draw.prize3_amount) });
    }
    if (draw.win_last3 && last3 === draw.win_last3) {
      hits.push({ prize: "LAST3", amount: Number(draw.last3_amount) });
    }
    if (draw.win_last2 && last2 === draw.win_last2) {
      hits.push({ prize: "LAST2", amount: Number(draw.last2_amount) });
    }

    // กติกา: ได้ "รางวัลสูงสุดเพียงรายการเดียว" (ไม่บวกรวม)
    // ถ้าอยากให้บวกรวม ทดแทนด้วย reduce บวก amount ได้เลย
    const best =
      hits.length === 0
        ? null
        : hits.reduce((a, b) => (a.amount >= b.amount ? a : b));

    return {
      ticketNumber: n6,
      matched: hits.map((h) => h.prize),
      bestPrize: best?.prize ?? null,
      awardedAmount: best?.amount ?? 0,
    };
  };

  const results = ticketList.map((t) => judgeTicket(t.ticket_number));

  res.json({
    success: true,
    mode: ticketNumber ? "single" : "buyer",
    drawNumber,
    ...(buyerId != null ? { buyerUserId: buyerId } : {}),
    count: results.length,
    results,
  });
};

const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
// Route ใหม่
router.get("/prize-check", asyncHandler(checkPrizes));

type PrizeHit = {
  prize: "PRIZE1" | "PRIZE2" | "PRIZE3" | "LAST3" | "LAST2";
  amount: number;
};

const claimPrize: RequestHandler = async (req, res) => {
  const drawNumber = Number(req.body.drawNumber ?? req.body.draw_number);
  const ticketNumber =
    typeof req.body.ticketNumber === "string"
      ? req.body.ticketNumber.trim()
      : undefined;
  const buyerId =
    req.body.buyerUserId ?? req.body.buyer_user_id
      ? Number(req.body.buyerUserId ?? req.body.buyer_user_id)
      : undefined;

  if (
    !Number.isInteger(drawNumber) ||
    !ticketNumber ||
    !Number.isInteger(buyerId!)
  ) {
    res.status(400).json({
      success: false,
      message: "ต้องระบุ drawNumber:int, ticketNumber:string, buyerUserId:int",
    });
    return;
  }

  const judgeTicket = (num: string, draw: any) => {
    const n6 = (num ?? "").trim();
    const last3 = n6.slice(-3);
    const last2 = n6.slice(-2);

    const hits: PrizeHit[] = [];
    if (draw.win1_full && n6 === draw.win1_full) {
      hits.push({ prize: "PRIZE1", amount: Number(draw.prize1_amount) });
    }
    if (draw.win2_full && n6 === draw.win2_full) {
      hits.push({ prize: "PRIZE2", amount: Number(draw.prize2_amount) });
    }
    if (draw.win3_full && n6 === draw.win3_full) {
      hits.push({ prize: "PRIZE3", amount: Number(draw.prize3_amount) });
    }
    if (draw.win_last3 && last3 === draw.win_last3) {
      hits.push({ prize: "LAST3", amount: Number(draw.last3_amount) });
    }
    if (draw.win_last2 && last2 === draw.win_last2) {
      hits.push({ prize: "LAST2", amount: Number(draw.last2_amount) });
    }

    const best =
      hits.length === 0
        ? null
        : hits.reduce((a, b) => (a.amount >= b.amount ? a : b));

    return {
      isWinner: !!best,
      bestPrize: best?.prize ?? null,
      awardedAmount: best?.amount ?? 0,
      matched: hits.map((h) => h.prize),
    };
  };

  const db = conn.promise();
  const tx = await db.getConnection();
  try {
    await tx.beginTransaction();

    // 1) โหลด draw
    const [drawRows] = await tx.query(
      `SELECT id, status,
              win1_full, win2_full, win3_full,
              win_last3, win_last2,
              prize1_amount, prize2_amount, prize3_amount,
              last3_amount, last2_amount
       FROM draws
       WHERE draw_number = ?`,
      [drawNumber]
    );
    const draw = Array.isArray(drawRows) && (drawRows as any[])[0];
    if (!draw) {
      await tx.rollback();
      res
        .status(404)
        .json({ success: false, message: "ไม่พบงวดนี้ (draw_number)" });
      return;
    }
    if (draw.status !== "CLOSED") {
      await tx.rollback();
      res.status(409).json({
        success: false,
        code: "DRAW_NOT_CLOSED",
        message: "งวดยังไม่ปิดประกาศผล (status != CLOSED)",
      });
      return;
    }

    // 2) lock ticket
    const [tRows] = await tx.query(
      `SELECT id, draw_id, ticket_number, status, buyer_user_id
       FROM tickets
       WHERE draw_id = ? AND ticket_number = ?
       FOR UPDATE`,
      [draw.id, ticketNumber]
    );
    const ticket = Array.isArray(tRows) && (tRows as any[])[0];
    if (!ticket) {
      await tx.rollback();
      res.status(404).json({
        success: false,
        message: "ไม่พบสลากใบนี้ในงวดดังกล่าว",
      });
      return;
    }

    // 3) ตรวจสิทธิ์
    if (Number(ticket.buyer_user_id) !== Number(buyerId)) {
      await tx.rollback();
      res.status(403).json({
        success: false,
        code: "NOT_OWNER",
        message: "สลากใบนี้ไม่ได้เป็นของผู้ใช้นี้",
      });
      return;
    }

    // 4) ตรวจสถานะซ้ำ
    if (ticket.status === "REDEEMED") {
      await tx.rollback();
      res.status(409).json({
        success: false,
        code: "ALREADY_REDEEMED",
        message: "สลากใบนี้ถูกขึ้นเงินไปแล้ว",
      });
      return;
    }
    if (ticket.status !== "SOLD") {
      await tx.rollback();
      res.status(409).json({
        success: false,
        code: "INVALID_STATUS",
        message: `สถานะปัจจุบัน (${ticket.status}) ไม่สามารถขึ้นเงินได้`,
      });
      return;
    }

    // 5) คิดรางวัล
    const judge = judgeTicket(ticket.ticket_number, draw);
    if (!judge.isWinner || judge.awardedAmount <= 0) {
      await tx.rollback();
      res.status(409).json({
        success: false,
        code: "NOT_A_WINNER",
        message: "สลากใบนี้ไม่ถูกรางวัล",
        detail: {
          drawNumber,
          ticketNumber: ticket.ticket_number,
          matched: judge.matched,
        },
      });
      return;
    }

    // 6) ล็อกกระเป๋าเงินของผู้ใช้ (ต้องมีอยู่แล้ว)
    const [wRows] = await tx.query(
      `SELECT id, user_id, balance
     FROM wallets
    WHERE user_id = ?
    FOR UPDATE`,
      [buyerId]
    );
    const wallet = Array.isArray(wRows) && (wRows as any[])[0];

    if (!wallet) {
      await tx.rollback();
      res.status(409).json({
        success: false,
        code: "WALLET_NOT_FOUND",
        message:
          "ไม่พบกระเป๋าเงินของผู้ใช้ โปรดติดต่อฝ่ายบริการหรือให้สร้างกระเป๋าก่อน",
      });
      return;
    }

    // 7) ลงรายการธุรกรรม PRIZE (กันซ้ำด้วย unique key ถ้าใส่ตามข้อ 1)
    const note = `Claim prize ${judge.bestPrize} for draw ${drawNumber} (ticket ${ticket.ticket_number})`;
    try {
      await tx.query(
        `INSERT INTO wallet_transactions
           (wallet_id, tx_type, amount, ref_type, ref_id, note)
         VALUES
           (?, 'PRIZE', ?, 'TICKET', ?, ?)`,
        [wallet.id, judge.awardedAmount, ticket.id, note]
      );
    } catch (e: any) {
      // ถ้าชน UNIQUE (เคยบันทึกไปแล้ว) → ถือว่าเคลมซ้ำ
      if (e && e.code === "ER_DUP_ENTRY") {
        await tx.rollback();
        res.status(409).json({
          success: false,
          code: "DUPLICATE_PRIZE_TX",
          message: "ธุรกรรมรางวัลนี้ถูกบันทึกไปแล้ว",
        });
        return;
      }
      throw e;
    }

    // 8) อัปเดตยอดกระเป๋า
    await tx.query(
      `UPDATE wallets
         SET balance = balance + ?
       WHERE id = ?`,
      [judge.awardedAmount, wallet.id]
    );

    // 9) เปลี่ยนสถานะตั๋วเป็น REDEEMED
    await tx.query(
      `UPDATE tickets
         SET status = 'REDEEMED'
       WHERE id = ?`,
      [ticket.id]
    );

    await tx.commit();

    res.json({
      success: true,
      message: "ขึ้นเงินสำเร็จ และโอนเข้ากระเป๋าแล้ว",
      drawNumber,
      ticketNumber: ticket.ticket_number,
      prize: judge.bestPrize,
      awardedAmount: judge.awardedAmount,
      wallet: {
        walletId: wallet.id,
        // ปล. ถ้าอยากส่ง balance ปัจจุบันกลับด้วย ควร SELECT อีกครั้งหลัง update
      },
    });
  } catch (err) {
    try {
      await tx.rollback();
    } catch (_) {}
    console.error(err);
    res.status(500).json({ success: false, message: "server error" });
  } finally {
    tx.release();
  }
};

// route
router.post("/claim", asyncHandler(claimPrize));

router.get("/list", async (req, res) => {
  try {
    const sql = `
      SELECT
        id AS id,                                  -- ถ้าอยากได้ id ใน /list ด้วย ให้ใส่
        draw_number AS drawNumber,
        DATE_FORMAT(draw_date, '%Y-%m-%d') AS drawDate
      FROM draws
      ORDER BY draw_date DESC
    `;
    const [rows] = await conn.promise().query(sql);
    res.json({ success: true, draws: rows });
  } catch (err: any) {
    console.error("SQL error:", err.sqlMessage || err.message || err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

router.get("/bydate", async (req, res) => {
  try {
    const { date, drawNumber } = req.query as {
      date?: string;
      drawNumber?: string;
    };

    // ===== validate =====
    if (!date) {
      res
        .status(400)
        .json({ success: false, message: "date is required (YYYY-MM-DD)" });
    }

    let drawNo: number | undefined;
    if (typeof drawNumber === "string" && drawNumber.trim() !== "") {
      const n = Number(drawNumber);
      if (!Number.isInteger(n) || n <= 0) {
        res.status(400).json({ success: false, message: "invalid drawNumber" });
      }
      drawNo = n;
    }

    // ===== build SQL =====
    const where: string[] = ["draw_date = ?"];
    const params: any[] = [date];
    if (typeof drawNo === "number") {
      where.push("draw_number = ?");
      params.push(drawNo);
    }

    const sql = `
      SELECT
        COALESCE(id, 0)                             AS id,          -- <<<< ใส่ id มาด้วย
        COALESCE(draw_number, 0)                    AS drawNumber,
        DATE_FORMAT(draw_date, '%Y-%m-%d')          AS drawDate,
        COALESCE(win1_full, '')                     AS prize1,
        COALESCE(win2_full, '')                     AS prize2,
        COALESCE(win3_full, '')                     AS prize3,
        COALESCE(win_last3, '')                     AS last3,
        COALESCE(win_last2, '')                     AS last2,
        COALESCE(prize1_amount, 0)                  AS prize1_amount,
        COALESCE(prize2_amount, 0)                  AS prize2_amount,
        COALESCE(prize3_amount, 0)                  AS prize3_amount,
        COALESCE(last3_amount, 0)                   AS last3_amount,
        COALESCE(last2_amount, 0)                   AS last2_amount
      FROM draws
      WHERE ${where.join(" AND ")}
      ORDER BY draw_number DESC
      LIMIT 1
    `;

    const [rows] = await conn.promise().query(sql, params);
    const list = rows as any[];
    if (!list || list.length === 0) {
      res.status(404).json({ success: false, message: "Not found" });
    }

    const row = list[0];

    res.json({
      success: true,
      draw: {
        id: Number(row.id ?? 0), // <<<< ตอนนี้มีค่าแน่นอน
        drawNumber: Number(row.drawNumber ?? 0),
        drawDate: row.drawDate ?? date,
        results: {
          first: String(row.prize1 ?? ""),
          second: String(row.prize2 ?? ""),
          third: String(row.prize3 ?? ""),
          last3: String(row.last3 ?? ""),
          last2: String(row.last2 ?? ""),
        },
        amounts: {
          prize1Amount: Number(row.prize1_amount ?? 0),
          prize2Amount: Number(row.prize2_amount ?? 0),
          prize3Amount: Number(row.prize3_amount ?? 0),
          last3Amount: Number(row.last3_amount ?? 0),
          last2Amount: Number(row.last2_amount ?? 0),
        },
      },
    });
  } catch (err: any) {
    console.error("SQL error:", err.sqlMessage || err.message || err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

router.get("/", (req, res) => {
  const sql = `
      SELECT
        id, draw_number, draw_date, status,
        win1_full, win2_full, win3_full, win_last3, win_last2,
        prize1_amount, prize2_amount, prize3_amount, last3_amount, last2_amount,
        created_at, closed_at, source_mode
      FROM draws
      WHERE status = 'CLOSED'
      ORDER BY draw_number DESC
      LIMIT 1
    `;

  conn.execute(sql, [], (err, results) => {
    if (err) {
      console.error("DB Error:", (err as any).sqlMessage || err.message || err);
      res.status(500).json({ message: "Internal Server Error" });
    }

    const rows = results as Draw[];
    if (!rows || rows.length === 0) {
      res.status(404).json({ message: "ยังไม่มีผลรางวัล" });
    }

    const r = rows[0];

    res.json({
      success: true,
      draw: {
        id: r.id,
        drawNumber: r.draw_number,
        drawDate: r.draw_date,
        status: r.status,
        results: {
          first: r.win1_full,
          second: r.win2_full,
          third: r.win3_full,
          last3: r.win_last3,
          last2: r.win_last2,
        },
        amounts: {
          prize1Amount: Number(r.prize1_amount ?? 0),
          prize2Amount: Number(r.prize2_amount ?? 0),
          prize3Amount: Number(r.prize3_amount ?? 0),
          last3Amount: Number(r.last3_amount ?? 0),
          last2Amount: Number(r.last2_amount ?? 0),
        },
        meta: {
          createdAt: r.createdAt,
          closedAt: r.closedAt,
          sourceMode: r.source_mode,
        },
      },
    });
  });
});
router.post("/randomlotto", async (req, res) => {
  // ===== รับค่า (เหมือนเดิม) =====
  const body: Draw = (req.body ?? {}) as Draw;
  const prize1Amount = Number(body.prize1_amount ?? 0);
  const prize2Amount = Number(body.prize2_amount ?? 0);
  const prize3Amount = Number(body.prize3_amount ?? 0);
  const last3Amount = Number(body.last3_amount ?? 0);
  const last2Amount = Number(body.last2_amount ?? 0);
  const unique = Boolean(body.unique_exact ?? true);
  const sourceMode = String(body.source_mode ?? "ALL");

  const nextDrawDate = req.body?.next_draw_date ?? null; // YYYY-MM-DD หรือ null = วันนี้
  const nextSourceMode = req.body?.next_source_mode ?? "ALL";
  const nextP1 = Number(req.body?.next_prize1_amount ?? 0);
  const nextP2 = Number(req.body?.next_prize2_amount ?? 0);
  const nextP3 = Number(req.body?.next_prize3_amount ?? 0);
  const nextL3 = Number(req.body?.next_last3_amount ?? 0);
  const nextL2 = Number(req.body?.next_last2_amount ?? 0);

  const bootDate = req.body?.bootstrap_draw_date ?? null;
  const bootMode = req.body?.bootstrap_source_mode ?? "ALL";
  const bootP1 = Number(req.body?.bootstrap_prize1_amount ?? 0);
  const bootP2 = Number(req.body?.bootstrap_prize2_amount ?? 0);
  const bootP3 = Number(req.body?.bootstrap_prize3_amount ?? 0);
  const bootL3 = Number(req.body?.bootstrap_last3_amount ?? 0);
  const bootL2 = Number(req.body?.bootstrap_last2_amount ?? 0);

  const randomDigits = (len: number) =>
    Math.floor(Math.random() * Math.pow(10, len))
      .toString()
      .padStart(len, "0");

  // helper: สุ่ม k รายการแบบไม่ซ้ำจากอาร์เรย์ (ถ้าจำนวนน้อยกว่าก็คืนเท่าที่มี)
  const pickUnique = <T>(arr: T[], k: number) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, Math.min(k, a.length));
  };

  const tx = await conn.promise().getConnection();
  try {
    await tx.beginTransaction();

    // 1) หาแถว OPEN (ล็อก)
    const [openRows] = (await tx.query(
      `SELECT id, draw_number
         FROM draws
        WHERE status='OPEN'
        ORDER BY draw_date ASC, draw_number ASC
        LIMIT 1
        FOR UPDATE`
    )) as unknown as [{ id: number; draw_number: number }[], unknown];

    let open = openRows[0] ?? null;

    // 1.1) bootstrap ถ้าไม่มี OPEN
    if (!open) {
      const [lastRows] = (await tx.query(
        `SELECT id, draw_number
           FROM draws
          ORDER BY draw_number DESC
          LIMIT 1
          FOR UPDATE`
      )) as unknown as [{ id: number; draw_number: number }[], unknown];

      const nextNumber = lastRows.length > 0 ? lastRows[0].draw_number + 1 : 1;

      const [insOpen] = (await tx.execute(
        `INSERT INTO draws (
           draw_number, draw_date, status, source_mode,
           prize1_amount, prize2_amount, prize3_amount, last3_amount, last2_amount,
           created_at
         ) VALUES (
           ?, COALESCE(?, CURDATE()), 'OPEN', ?,
           ?, ?, ?, ?, ?,
           NOW()
         )`,
        [nextNumber, bootDate, bootMode, bootP1, bootP2, bootP3, bootL3, bootL2]
      )) as unknown as [{ insertId: number }, unknown];

      open = { id: insOpen.insertId, draw_number: nextNumber };
    }

    // ===== 2) เลขรางวัล: โหมดปกติ vs SOLD_ONLY =====
    let prize1: string;
    let prize2: string;
    let prize3: string;
    let last3: string; // <-- จะเซ็ตหลังจากรู้ prize1 แล้ว
    let last2: string;

    if (sourceMode === "SOLD_ONLY") {
      const [soldRows] = (await tx.query(
        `SELECT ticket_number
       FROM tickets
      WHERE draw_id=? AND status='SOLD'
      FOR UPDATE`,
        [open.id]
      )) as unknown as [{ ticket_number: string }[], unknown];

      const soldList = soldRows.map((r) => r.ticket_number);

      if (soldList.length === 0) {
        // ไม่มีตั๋วขาย → fallback สุ่ม
        prize1 = randomDigits(6);
        prize2 = randomDigits(6);
        prize3 = randomDigits(6);
        if (unique) {
          while (prize2 === prize1) prize2 = randomDigits(6);
          while (prize3 === prize1 || prize3 === prize2)
            prize3 = randomDigits(6);
        }
        // last3 จะตั้งค่าหลังจากนี้จาก prize1
        last2 = randomDigits(2);
      } else {
        // มีตั๋วขาย → จับจากเลขที่ขาย
        const picks = unique
          ? pickUnique(soldList, 3)
          : pickUnique(soldList, 1);
        prize1 = picks[0];

        if (unique) {
          const need = 3 - picks.length;
          const extra: string[] = [];
          const used = new Set(picks);
          for (let i = 0; i < need; i++) {
            let x = randomDigits(6);
            while (used.has(x)) x = randomDigits(6);
            used.add(x);
            extra.push(x);
          }
          const all = [...picks, ...extra];
          prize2 = all[1] ?? randomDigits(6);
          prize3 = all[2] ?? randomDigits(6);
        } else {
          const r1 = soldList[Math.floor(Math.random() * soldList.length)];
          const r2 = soldList[Math.floor(Math.random() * soldList.length)];
          prize2 = r1;
          prize3 = r2;
        }

        // last2 จะเอาจากเลขที่ขายเพื่อเพิ่มโอกาสถูกรางวัล
        const anySold2 = soldList[Math.floor(Math.random() * soldList.length)];
        last2 = anySold2.slice(-2);
      }
    } else {
      // โหมดเดิม: สุ่มอิสระ
      prize1 = randomDigits(6);
      prize2 = randomDigits(6);
      prize3 = randomDigits(6);
      if (unique) {
        while (prize2 === prize1) prize2 = randomDigits(6);
        while (prize3 === prize1 || prize3 === prize2) prize3 = randomDigits(6);
      }
      // last3 จะตั้งค่าหลังจากนี้จาก prize1
      last2 = randomDigits(2);
    }

    last3 = prize1.slice(-3);

    // 3) ปิดงวดด้วยผลรางวัลที่ได้
    await tx.execute(
      `UPDATE draws
          SET status='CLOSED',
              win1_full=?, win2_full=?, win3_full=?, win_last3=?, win_last2=?,
              prize1_amount=?, prize2_amount=?, prize3_amount=?, last3_amount=?, last2_amount=?,
              source_mode=?,
              closed_at=NOW()
        WHERE id=?`,
      [
        prize1,
        prize2,
        prize3,
        last3,
        last2,
        prize1Amount,
        prize2Amount,
        prize3Amount,
        last3Amount,
        last2Amount,
        sourceMode,
        open.id,
      ]
    );

    // 4) เปิดงวดถัดไป
    const nextOpenNumber = open.draw_number + 1;
    const carryP1 = Number(req.body?.next_prize1_amount ?? prize1Amount);
    const carryP2 = Number(req.body?.next_prize2_amount ?? prize2Amount);
    const carryP3 = Number(req.body?.next_prize3_amount ?? prize3Amount);
    const carryL3 = Number(req.body?.next_last3_amount ?? last3Amount);
    const carryL2 = Number(req.body?.next_last2_amount ?? last2Amount);

    const [openIns] = (await tx.execute(
      `INSERT INTO draws (
         draw_number, draw_date, status, source_mode,
         prize1_amount, prize2_amount, prize3_amount, last3_amount, last2_amount,
         created_at
       ) VALUES (
         ?, COALESCE(?, CURDATE()), 'OPEN', ?,
         ?, ?, ?, ?, ?,
         NOW()
       )`,
      [
        nextOpenNumber,
        nextDrawDate,
        nextSourceMode,
        carryP1,
        carryP2,
        carryP3,
        carryL3,
        carryL2,
      ]
    )) as unknown as [{ insertId: number }, unknown];

    // 5) ตอบกลับรายละเอียดงวดที่ปิด
    const [oneRows] = (await tx.query(
      `SELECT
         id,
         draw_number AS drawNumber,
         DATE_FORMAT(draw_date, '%Y-%m-%d') AS drawDate,
         status,
         win1_full, win2_full, win3_full, win_last3, win_last2,
         prize1_amount, prize2_amount, prize3_amount, last3_amount, last2_amount,
         source_mode, created_at, closed_at
       FROM draws
       WHERE id = ?
       LIMIT 1`,
      [open.id]
    )) as unknown as [Array<any>, unknown];

    await tx.commit();

    const row = oneRows[0];
    res.status(201).json({
      success: true,
      message:
        "open draw (bootstrapped if missing) closed with results, next draw opened",
      draw: {
        id: row.id,
        drawNumber: row.drawNumber,
        drawDate: row.drawDate,
        status: row.status,
        results: {
          first: row.win1_full,
          second: row.win2_full,
          third: row.win3_full,
          last3: row.win_last3,
          last2: row.win_last2,
        },
        amounts: {
          prize1Amount: Number(row.prize1_amount ?? 0),
          prize2Amount: Number(row.prize2_amount ?? 0),
          prize3Amount: Number(row.prize3_amount ?? 0),
          last3Amount: Number(row.last3_amount ?? 0),
          last2Amount: Number(row.last2_amount ?? 0),
        },
        meta: {
          sourceMode: row.source_mode,
          createdAt: row.created_at,
          closedAt: row.closed_at,
        },
      },
      nextOpen: {
        id: (openIns as any).insertId,
        drawNumber: nextOpenNumber,
        drawDate: nextDrawDate ?? "CURDATE()",
        sourceMode: nextSourceMode,
        amounts: {
          prize1Amount: nextP1,
          prize2Amount: nextP2,
          prize3Amount: nextP3,
          last3Amount: nextL3,
          last2Amount: nextL2,
        },
      },
    });
  } catch (error) {
    console.error("DB Error:", (error as any).sqlMessage || error);
    try {
      await tx.rollback();
    } catch {}
    res.status(500).json({ message: "Internal Server Error" });
  } finally {
    try {
      tx.release();
    } catch {}
  }
});
