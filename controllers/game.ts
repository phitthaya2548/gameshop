import express from "express";
import fs from "fs";
import { FieldPacket, ResultSetHeader, RowDataPacket } from "mysql2";
import { conn } from "../db";
import { saveImageBufferToUploads, toAbsoluteUrl, upload } from "./upload";
export const router = express.Router();

router.post("/addgames", upload.single("image"), async (req, res) => {
  let savedPath: string | undefined;

  try {
    const { title, price, description, releaseDate } = req.body ?? {};
    const MIN_CATEGORIES = 5;

    if (typeof title !== "string" || title.trim().length < 2) {
      return res
        .status(400)
        .json({ ok: false, message: "กรุณากรอกชื่อเกมอย่างน้อย 2 ตัวอักษร" });
    }

    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ ok: false, message: "ราคาไม่ถูกต้อง" });
    }

    const rawCats =
      req.body.categories ?? req.body.categoryNames ?? req.body.categoryName;
    const categories = _catNormalize(rawCats);

    if (categories.length < MIN_CATEGORIES) {
      return res.status(400).json({
        ok: false,
        message: `ต้องมีหมวดหมู่อย่างน้อย ${MIN_CATEGORIES} หมวดหมู่`,
        detail:
          "ส่งเป็น array/CSV ก็ได้ เช่น Action, Adventure, RPG, Simulation, Sports",
      });
    }

    if (categories.some((n) => n.length < 2)) {
      return res.status(400).json({
        ok: false,
        message: "ชื่อหมวดหมู่ต้องยาวอย่างน้อย 2 ตัวอักษร",
      });
    }

    const categoryCsv = _catToCsvSorted(categories);
    if (categoryCsv.length > 80) {
      return res.status(400).json({
        ok: false,
        message: `หมวดหมู่รวมยาวเกิน 80 ตัวอักษร (${categoryCsv.length}) กรุณาลดจำนวน/ย่อชื่อ`,
      });
    }

    const file = req.file;
    if (!file) {
      return res
        .status(400)
        .json({ ok: false, message: "กรุณาแนบรูปปก (ไฟล์ภาพ)" });
    }
    savedPath = saveImageBufferToUploads(file.buffer, file.mimetype);

    const releaseDateValue =
      typeof releaseDate === "string" && releaseDate.trim()
        ? releaseDate.trim()
        : new Date()
            .toLocaleDateString("en-GB", {
              timeZone: "Asia/Bangkok",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            })
            .split("/")
            .reverse()
            .join("-");

    const [[dup]] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM games WHERE title = ? AND category_name = ? LIMIT 1`,
      [title.trim(), categoryCsv]
    );
    if (dup) {
      _safeUnlink(savedPath);
      return res.status(409).json({
        ok: false,
        message: "มีเกมชื่อนี้ในชุดหมวดหมู่เดียวกันอยู่แล้ว",
      });
    }

    const [rs] = await conn.query<ResultSetHeader>(
      `INSERT INTO games
         (title, price, category_name, images, description, release_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        title.trim(),
        priceNum,
        categoryCsv,
        savedPath,
        typeof description === "string" ? description : null,
        releaseDateValue,
      ]
    );

    const [[row]] = await conn.query<RowDataPacket[]>(
      `SELECT id, title, price, category_name AS categoryName, images,
              description, release_date AS releaseDate,
              created_at AS createdAt, updated_at AS updatedAt
       FROM games
       WHERE id = ?
       LIMIT 1`,
      [rs.insertId]
    );

    const imageUrl = toAbsoluteUrl(req, row.image);
    const categoriesArr = _catFromCsv(row.categoryName);

    return res.status(201).json({
      ok: true,
      game: { ...row, imageUrl, categories: categoriesArr },
    });
  } catch (e: any) {
    if (savedPath) _safeUnlink(savedPath);
    if (e?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        ok: false,
        message: "มีเกมชื่อนี้ในชุดหมวดหมู่เดียวกันอยู่แล้ว",
        detail: e?.sqlMessage ?? String(e),
      });
    }
    console.error("POST /addgames error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

function _catNormalize(input: unknown): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return _catClean(input);
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) return _catClean(parsed);
    } catch {}
    return _catClean(input.split(","));
  }
  return [];
}
function _catToCsvSorted(categories: string[]): string {
  return _catClean(categories)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
}
function _catFromCsv(csv?: string | null): string[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
function _catClean(arr: any[]): string[] {
  const set = new Set(
    arr.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean)
  );
  return Array.from(set);
}
function _safeUnlink(p?: string) {
  if (!p) return;
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (err) {
    console.warn("unlink ignore:", err);
  }
}

router.get("/search", async (req, res) => {
  try {
    const title =
      typeof req.query.title === "string" ? req.query.title.trim() : "";

    const rawCats =
      (req.query as any).categories ??
      (req.query as any)["categories[]"] ??
      req.query.categoryName;
    const cats = normalizeCats(rawCats);

    let sql = `SELECT id, title, price, category_name, images FROM games WHERE 1=1`;
    const params: any[] = [];

    if (title) {
      sql += ` AND title LIKE ?`;
      params.push(`%${title}%`);
    }

    if (cats.length) {
      const orConds = cats
        .map(() => `FIND_IN_SET(?, REPLACE(category_name, ', ', ','))`)
        .join(" OR ");
      sql += ` AND (${orConds})`;
      params.push(...cats);
    }

    sql += ` ORDER BY id DESC`;

    const [rows]: [RowDataPacket[], FieldPacket[]] = await conn.query(
      sql,
      params
    );

    if (!rows.length) {
      return res
        .status(404)
        .json({ ok: false, message: "ไม่พบเกมที่ตรงกับเงื่อนไขการค้นหา" });
    }
    return res.json({ ok: true, games: rows });
  } catch (error) {
    console.error("Error searching games:", error);
    return res
      .status(500)
      .json({ ok: false, message: "เกิดข้อผิดพลาดในการค้นหาเกม" });
  }
});

function normalizeCats(input: any): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return clean(input);
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) return clean(parsed);
    } catch {}
    return clean(input.split(","));
  }
  return [];
}
function clean(arr: any[]): string[] {
  return Array.from(
    new Set(
      arr.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
    )
  );
}

router.patch("/games/:id", upload.single("image"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const [[current]] = await conn.query<RowDataPacket[]>(
      "SELECT * FROM games WHERE id = ? LIMIT 1",
      [id]
    );
    if (!current)
      return res.status(404).json({ ok: false, message: "Not Found" });

    const MIN_CATEGORIES = 5;

    let { title, price, categoryName, description, releaseDate } =
      req.body ?? {};

    let categoryCsvToSet: string | undefined;
    const rawCats =
      (req.body as any).categories ??
      (req.body as any)["categories[]"] ??
      (req.body as any).categoryNames;

    if (typeof rawCats !== "undefined") {
      const cats = _catNormalize(rawCats);

      if (cats.length < MIN_CATEGORIES) {
        return res.status(400).json({
          ok: false,
          message: `ต้องมีหมวดหมู่อย่างน้อย ${MIN_CATEGORIES} หมวดหมู่`,
        });
      }
      if (cats.some((n) => n.length < 2)) {
        return res.status(400).json({
          ok: false,
          message: "ชื่อหมวดหมู่ต้องยาวอย่างน้อย 2 ตัวอักษร",
        });
      }
      categoryCsvToSet = _catToCsvSorted(cats);
    } else if (typeof categoryName !== "undefined") {
      const cats = _catNormalize(categoryName);
      if (cats.length < MIN_CATEGORIES) {
        return res.status(400).json({
          ok: false,
          message: `ต้องมีหมวดหมู่อย่างน้อย ${MIN_CATEGORIES} หมวดหมู่`,
        });
      }
      if (cats.some((n) => n.length < 2)) {
        return res.status(400).json({
          ok: false,
          message: "ชื่อหมวดหมู่ต้องยาวอย่างน้อย 2 ตัวอักษร",
        });
      }
      categoryCsvToSet = _catToCsvSorted(cats);
    }

    if (categoryCsvToSet && categoryCsvToSet.length > 80) {
      return res.status(400).json({
        ok: false,
        message: `หมวดหมู่รวมยาวเกิน 80 ตัวอักษร (${categoryCsvToSet.length})`,
      });
    }

    const set: string[] = [];
    const params: any[] = [];

    let nextTitle = current.title as string;
    if (typeof title !== "undefined") {
      title = String(title).trim();
      if (title.length < 2) {
        return res
          .status(400)
          .json({ ok: false, message: "ชื่อเกมสั้นเกินไป" });
      }
      set.push("title = ?");
      params.push(title);
      nextTitle = title;
    }

    if (typeof price !== "undefined") {
      const pn = Number(price);
      if (!Number.isFinite(pn) || pn < 0) {
        return res.status(400).json({ ok: false, message: "ราคาไม่ถูกต้อง" });
      }
      set.push("price = ?");
      params.push(pn);
    }

    let nextCategoryCsv = current.category_name as string;
    if (typeof categoryCsvToSet !== "undefined") {
      set.push("category_name = ?");
      params.push(categoryCsvToSet);
      nextCategoryCsv = categoryCsvToSet;
    }

    if (typeof description !== "undefined") {
      set.push("description = ?");
      params.push(description === null ? null : String(description).trim());
    }

    if (typeof releaseDate !== "undefined") {
      const val = String(releaseDate).trim();
      if (val) {
        set.push("release_date = ?");
        params.push(val);
      }
    }

    if (req.file) {
      const newPath = saveImageBufferToUploads(
        req.file.buffer,
        req.file.mimetype
      );
      set.push("images = ?");
      params.push(newPath);
    }

    if (set.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "ไม่มีฟิลด์ให้อัปเดต" });
    }

    const [[dup]] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM games WHERE title = ? AND category_name = ? AND id <> ? LIMIT 1`,
      [nextTitle, nextCategoryCsv, id]
    );
    if (dup) {
      return res.status(409).json({
        ok: false,
        message: "มีเกมชื่อนี้ในชุดหมวดหมู่เดียวกันอยู่แล้ว",
      });
    }

    params.push(id);
    await conn.query(`UPDATE games SET ${set.join(", ")} WHERE id = ?`, params);

    const [[updated]] = await conn.query<RowDataPacket[]>(
      "SELECT * FROM games WHERE id = ? LIMIT 1",
      [id]
    );
    const imageUrl = toAbsoluteUrl(req, updated.images);
    const categoriesArr = _catFromCsv(updated.category_name);

    res.json({
      ok: true,
      message: "อัปเดตสำเร็จ (บางฟิลด์)",
      game: { ...updated, imageUrl, categories: categoriesArr },
    });
  } catch (e) {
    console.error("PATCH /games/:id error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.delete("/games/:id", async (req, res) => {
  const gameId = req.params.id;

  try {
    const [[gameToDelete]] = await conn.query<RowDataPacket[]>(
      `SELECT * FROM games WHERE id = ? LIMIT 1`,
      [gameId]
    );

    if (!gameToDelete) {
      return res
        .status(404)
        .json({ ok: false, message: "ไม่พบเกมที่ต้องการลบ" });
    }

    const imagePath = gameToDelete.images;
    if (imagePath && fs.existsSync(imagePath)) {
      try {
        fs.unlinkSync(imagePath);
        console.log("Image file deleted:", imagePath);
      } catch (err) {
        console.error("Error deleting image file:", err);
      }
    }

    await conn.query(`DELETE FROM games WHERE id = ?`, [gameId]);

    const [[checkGame]] = await conn.query<RowDataPacket[]>(
      `SELECT * FROM games WHERE id = ? LIMIT 1`,
      [gameId]
    );

    if (checkGame) {
      return res
        .status(500)
        .json({ ok: false, message: "เกิดข้อผิดพลาดในการลบข้อมูลเกม" });
    }

    res.json({ ok: true, message: "ข้อมูลเกมถูกลบเรียบร้อยแล้ว" });
  } catch (error) {
    console.error("Error deleting game:", error);
    res.status(500).json({
      ok: false,
      message: "เกิดข้อผิดพลาดในการลบข้อมูลเกม",
      error: error,
    });
  }
});

router.get("/games/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    // Retrieve game details from the database
    const [rows] = await conn.query<RowDataPacket[]>(
      `
      SELECT id, title, price, category_name AS category_name, description, images, release_date AS releaseDate
      FROM games
      WHERE id = ? 
      LIMIT 1
    `,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, message: "Not Found" });
    }

    const game = rows[0];
    const imageUrl = toAbsoluteUrl(req, game.images);

    // Retrieve purchase stats for the game (number of purchases and revenue)
    const [selfStatRows] = await conn.query<RowDataPacket[]>(
      `
      SELECT
        g.id AS game_id,
        COALESCE(COUNT(oi.id), 0) AS purchases,
        COALESCE(SUM(oi.unit_price), 0) AS revenue
      FROM games g
      LEFT JOIN order_items oi ON oi.game_id = g.id
      LEFT JOIN orders o ON o.id = oi.order_id
      WHERE g.id = ?
      GROUP BY g.id
    `,
      [id]
    );

    const selfStat = selfStatRows[0] ?? {
      game_id: id,
      purchases: 0,
      revenue: 0,
    };

    // If there are no purchases, no need to calculate ranking
    if (selfStat.purchases === 0) {
      return res.json({
        id: game.id,
        title: game.title,
        price: Number(game.price),
        category_name: game.category_name ?? "",
        description: game.description ?? "",
        releaseDate: game.releaseDate ?? null,
        images: imageUrl ?? null,
        categories: csvToArray(game.category_name),
        ranking: "", // No ranking if no purchases
      });
    }

    // Rank the games based on the number of purchases and revenue (for all games)
    const [rankRows] = await conn.query<RowDataPacket[]>(
      `
      WITH sales AS (
        SELECT
          g.id AS game_id,
          COALESCE(COUNT(oi.id), 0) AS purchases,
          COALESCE(SUM(oi.unit_price), 0) AS revenue
        FROM games g
        LEFT JOIN order_items oi ON oi.game_id = g.id
        LEFT JOIN orders o ON o.id = oi.order_id
        GROUP BY g.id
      ),
      ranked AS (
        SELECT
          game_id,
          purchases,
          revenue,
          RANK() OVER (ORDER BY purchases DESC, revenue DESC, game_id ASC) AS rank_by_count
        FROM sales
      )
      SELECT r.*
      FROM ranked r
      WHERE r.game_id = ?
    `,
      [id]
    );

    const rank = rankRows[0] ?? {
      rank_by_count: null,
      purchases: 0,
      revenue: 0,
    };

    // If the game rank exceeds 5, show an empty string or skip the rank.
    const ranking =
      rank.rank_by_count && rank.rank_by_count <= 5
        ? Number(rank.rank_by_count)
        : ""; // If rank is above 5, show empty

    return res.json({
      id: game.id,
      title: game.title,
      price: Number(game.price),
      category_name: game.category_name ?? "",
      description: game.description ?? "",
      releaseDate: game.releaseDate ?? null,
      images: imageUrl ?? null,
      categories: csvToArray(game.category_name),
      ranking, // Show rank if available and not above 5
    });
  } catch (e) {
    console.error("GET /games/:id error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.get("/games", async (req, res) => {
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id, title, price, category_name AS categoryName, images, description,
              release_date AS releaseDate, created_at AS createdAt, updated_at AS updatedAt
       FROM games
       ORDER BY created_at DESC`
    );

    const data = rows.map((r) => ({
      ...r,
      imageUrl: toAbsoluteUrl(req, r.images),
    }));

    return res.json({ ok: true, games: data });
  } catch (e) {
    console.error("GET /games error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.get("/stats/ranking", async (req, res) => {
  try {
    const { period = "all", date = "" } = req.query;
    const dateStr = String(date ?? "");
    let start: string | null = null;
    let end: string | null = null;

    // กำหนดช่วงเวลาให้กับแต่ละ period
    if (period === "day" && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      start = `${dateStr} 00:00:00`;
      const d = new Date(`${dateStr}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      end = d.toISOString().slice(0, 10) + " 00:00:00";
    } else if (period === "month" && /^\d{4}-\d{2}$/.test(dateStr)) {
      const [y, m] = dateStr.split("-").map(Number);
      const startD = new Date(Date.UTC(y, m - 1, 1));
      const endD = new Date(Date.UTC(y, m, 1));
      start = startD.toISOString().slice(0, 10) + " 00:00:00";
      end = endD.toISOString().slice(0, 10) + " 00:00:00";
    } else if (period === "year" && /^\d{4}$/.test(dateStr)) {
      const y = Number(dateStr);
      start = `${y}-01-01 00:00:00`;
      end = `${y + 1}-01-01 00:00:00`;
    }

    // ถ้าเป็น period "all" ไม่ต้องกรองช่วงเวลา
    let query = `
      WITH sales AS (
        SELECT
          g.id AS game_id,
          g.title,
          g.images,
          g.category_name,
          COALESCE(COUNT(oi.id), 0) AS purchases,  -- จำนวนการซื้อ
          COALESCE(SUM(oi.unit_price), 0) AS revenue,  -- ยอดขายรวม
          MIN(o.created_at) AS first_sale_at,
          MAX(o.created_at) AS last_sale_at
        FROM games g
        LEFT JOIN order_items oi
          ON oi.game_id = g.id
        LEFT JOIN orders o
          ON o.id = oi.order_id
        ${
          period !== "all" ? "WHERE o.created_at >= ? AND o.created_at < ?" : ""
        }
        GROUP BY g.id
      ),
      ranked AS (
        SELECT
          s.*,
          RANK() OVER (ORDER BY s.purchases DESC, s.game_id ASC) AS rank_by_count  -- จัดอันดับจากจำนวนการซื้อ
        FROM sales s
      )
      SELECT r.*, (SELECT COUNT(*) FROM sales) AS population
      FROM ranked r
      ORDER BY r.purchases DESC, r.game_id ASC  -- จัดเรียงจากจำนวนการซื้อ
    `;

    const params: any[] = period !== "all" && start && end ? [start, end] : []; // กำหนด params ถ้าเป็น period ที่มีการกรองเวลา

    const [rows] = await conn.query<RowDataPacket[]>(query, params);

    const topSellers = rows.map((r: any, idx: number) => {
      const rel = r.images ?? null; // คอลัมน์ชื่อ image
      const imageUrl = rel ? toAbsoluteUrl(req, rel) : "default-image-url.jpg";
      return {
        rank: idx + 1,
        gameId: r.game_id,
        title: r.title ?? null,
        image: rel, // เก็บ path เดิม
        imageUrl, // full URL สำหรับแสดงผล
        categoryName: r.category_name ?? null,
        categories: csvToArray(r.category_name ?? ""),
        purchases: Number(r.purchases ?? 0),
        revenue: Number(r.revenue ?? 0), // ยอดขายรวม
        firstSaleAt: r.first_sale_at ?? null,
        lastSaleAt: r.last_sale_at ?? null,
        period: start && end ? { start, end } : null,
        rankByCount: r.rank_by_count, // อันดับจากจำนวนการซื้อ
        population: r.population,
      };
    });

    return res.json({ ok: true, topSellers });
  } catch (e) {
    console.error("Error fetching top sellers:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

function calcRange(
  mode: string,
  dateStr: string
): { start: string; end: string } | null {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (mode === "day") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return null;
    const y = +m[1],
      mo = +m[2],
      d = +m[3];
    const start = `${y}-${pad(mo)}-${pad(d)} 00:00:00`;
    const dt = new Date(Date.UTC(y, mo - 1, d + 1));
    const end = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(
      dt.getUTCDate()
    )} 00:00:00`;
    return { start, end };
  }
  if (mode === "month") {
    const m = /^(\d{4})-(\d{2})$/.exec(dateStr);
    if (!m) return null;
    const y = +m[1],
      mo = +m[2];
    const start = `${y}-${pad(mo)}-01 00:00:00`;
    const dt = new Date(Date.UTC(y, mo, 1));
    const end = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(
      dt.getUTCDate()
    )} 00:00:00`;
    return { start, end };
  }
  if (mode === "year") {
    const m = /^(\d{4})$/.exec(dateStr);
    if (!m) return null;
    const y = +m[1];
    const start = `${y}-01-01 00:00:00`;
    const end = `${y + 1}-01-01 00:00:00`;
    return { start, end };
  }
  return null;
}
function csvToArray(csv?: string | null): string[] {
  if (!csv) return [];
  return String(csv)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
router.get("/top-sellers", async (req, res) => {
  try {
    const { period = "all", date = "" } = req.query;
    const dateStr = String(date ?? "");
    let start: string | null = null;
    let end: string | null = null;

    
    if (period === "day" && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      start = `${dateStr} 00:00:00`;
      const d = new Date(`${dateStr}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      end = d.toISOString().slice(0, 10) + " 00:00:00";
    } else if (period === "month" && /^\d{4}-\d{2}$/.test(dateStr)) {
      const [y, m] = dateStr.split("-").map(Number);
      const startD = new Date(Date.UTC(y, m - 1, 1));
      const endD = new Date(Date.UTC(y, m, 1));
      start = startD.toISOString().slice(0, 10) + " 00:00:00";
      end = endD.toISOString().slice(0, 10) + " 00:00:00";
    } else if (period === "year" && /^\d{4}$/.test(dateStr)) {
      const y = Number(dateStr);
      start = `${y}-01-01 00:00:00`;
      end = `${y + 1}-01-01 00:00:00`;
    }


    let query = `
      WITH sales AS (
        SELECT
          g.id AS game_id,
          g.title,
          g.images,
          g.category_name,
          COALESCE(COUNT(oi.id), 0) AS purchases,
          COALESCE(SUM(oi.unit_price), 0) AS revenue,
          MIN(o.created_at) AS first_sale_at,
          MAX(o.created_at) AS last_sale_at
        FROM games g
        LEFT JOIN order_items oi ON oi.game_id = g.id
        LEFT JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= ? AND o.created_at < ?
        GROUP BY g.id
      ),
      ranked AS (
        SELECT
          s.*,
          RANK() OVER (ORDER BY s.purchases DESC, s.game_id ASC) AS rank_by_count
        FROM sales s
      )
      SELECT r.*, (SELECT COUNT(*) FROM sales) AS population
      FROM ranked r
      ORDER BY r.purchases DESC, r.game_id ASC;
    `;


    const params: any[] = start && end ? [start, end] : [];

    // Ensure the parameters are passed correctly
    const [rows] = await conn.query<RowDataPacket[]>(query, params);

    const topSellers = rows.map((r: any, idx: number) => {
      const rel = r.images ?? null; // Column name for image
      const imageUrl = rel ? toAbsoluteUrl(req, rel) : "default-image-url.jpg";
      return {
        rank: idx + 1,
        gameId: r.game_id,
        title: r.title ?? null,
        image: rel, // Keep the original path
        imageUrl, // Full URL for display
        categoryName: r.category_name ?? null,
        categories: csvToArray(r.category_name ?? ""),
        purchases: Number(r.purchases ?? 0),
        revenue: Number(r.revenue ?? 0), // Total revenue
        firstSaleAt: r.first_sale_at ?? null,
        lastSaleAt: r.last_sale_at ?? null,
        period: start && end ? { start, end } : null,
        rankByCount: r.rank_by_count, // Ranking based on purchases
        population: r.population,
      };
    });

    return res.json({ ok: true, topSellers });
  } catch (e) {
    console.error("Error fetching top sellers:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});
