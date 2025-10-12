"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const db_1 = require("../db");
const upload_1 = require("./upload");
exports.router = express_1.default.Router();
exports.router.post("/addgames", upload_1.upload.single("image"), async (req, res) => {
    let savedPath;
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
        const rawCats = req.body.categories ?? req.body.categoryNames ?? req.body.categoryName;
        const categories = _catNormalize(rawCats);
        if (categories.length < MIN_CATEGORIES) {
            return res.status(400).json({
                ok: false,
                message: `ต้องมีหมวดหมู่อย่างน้อย ${MIN_CATEGORIES} หมวดหมู่`,
                detail: "ส่งเป็น array/CSV ก็ได้ เช่น Action, Adventure, RPG, Simulation, Sports",
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
        savedPath = (0, upload_1.saveImageBufferToUploads)(file.buffer, file.mimetype);
        const releaseDateValue = typeof releaseDate === "string" && releaseDate.trim()
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
        const [[dup]] = await db_1.conn.query(`SELECT id FROM games WHERE title = ? AND category_name = ? LIMIT 1`, [title.trim(), categoryCsv]);
        if (dup) {
            _safeUnlink(savedPath);
            return res.status(409).json({
                ok: false,
                message: "มีเกมชื่อนี้ในชุดหมวดหมู่เดียวกันอยู่แล้ว",
            });
        }
        const [rs] = await db_1.conn.query(`INSERT INTO games
         (title, price, category_name, images, description, release_date)
       VALUES (?, ?, ?, ?, ?, ?)`, [
            title.trim(),
            priceNum,
            categoryCsv,
            savedPath,
            typeof description === "string" ? description : null,
            releaseDateValue,
        ]);
        const [[row]] = await db_1.conn.query(`SELECT id, title, price, category_name AS categoryName, images,
              description, release_date AS releaseDate,
              created_at AS createdAt, updated_at AS updatedAt
       FROM games
       WHERE id = ?
       LIMIT 1`, [rs.insertId]);
        const imageUrl = (0, upload_1.toAbsoluteUrl)(req, row.image);
        const categoriesArr = _catFromCsv(row.categoryName);
        return res.status(201).json({
            ok: true,
            game: { ...row, imageUrl, categories: categoriesArr },
        });
    }
    catch (e) {
        if (savedPath)
            _safeUnlink(savedPath);
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
function _catNormalize(input) {
    if (!input)
        return [];
    if (Array.isArray(input))
        return _catClean(input);
    if (typeof input === "string") {
        try {
            const parsed = JSON.parse(input);
            if (Array.isArray(parsed))
                return _catClean(parsed);
        }
        catch { }
        return _catClean(input.split(","));
    }
    return [];
}
function _catToCsvSorted(categories) {
    return _catClean(categories)
        .sort((a, b) => a.localeCompare(b))
        .join(", ");
}
function _catFromCsv(csv) {
    if (!csv)
        return [];
    return csv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}
function _catClean(arr) {
    const set = new Set(arr.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean));
    return Array.from(set);
}
function _safeUnlink(p) {
    if (!p)
        return;
    try {
        if (fs_1.default.existsSync(p))
            fs_1.default.unlinkSync(p);
    }
    catch (err) {
        console.warn("unlink ignore:", err);
    }
}
exports.router.get("/search", async (req, res) => {
    try {
        const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
        const rawCats = req.query.categories ??
            req.query["categories[]"] ??
            req.query.categoryName;
        const cats = normalizeCats(rawCats);
        let sql = `SELECT id, title, price, category_name, images FROM games WHERE 1=1`;
        const params = [];
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
        const [rows] = await db_1.conn.query(sql, params);
        if (!rows.length) {
            return res
                .status(404)
                .json({ ok: false, message: "ไม่พบเกมที่ตรงกับเงื่อนไขการค้นหา" });
        }
        return res.json({ ok: true, games: rows });
    }
    catch (error) {
        console.error("Error searching games:", error);
        return res
            .status(500)
            .json({ ok: false, message: "เกิดข้อผิดพลาดในการค้นหาเกม" });
    }
});
function normalizeCats(input) {
    if (!input)
        return [];
    if (Array.isArray(input))
        return clean(input);
    if (typeof input === "string") {
        try {
            const parsed = JSON.parse(input);
            if (Array.isArray(parsed))
                return clean(parsed);
        }
        catch { }
        return clean(input.split(","));
    }
    return [];
}
function clean(arr) {
    return Array.from(new Set(arr.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)));
}
exports.router.patch("/games/:id", upload_1.upload.single("image"), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ ok: false, message: "Invalid id" });
        }
        const [[current]] = await db_1.conn.query("SELECT * FROM games WHERE id = ? LIMIT 1", [id]);
        if (!current)
            return res.status(404).json({ ok: false, message: "Not Found" });
        const MIN_CATEGORIES = 5;
        let { title, price, categoryName, description, releaseDate } = req.body ?? {};
        let categoryCsvToSet;
        const rawCats = req.body.categories ??
            req.body["categories[]"] ??
            req.body.categoryNames;
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
        }
        else if (typeof categoryName !== "undefined") {
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
        const set = [];
        const params = [];
        let nextTitle = current.title;
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
        let nextCategoryCsv = current.category_name;
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
            const newPath = (0, upload_1.saveImageBufferToUploads)(req.file.buffer, req.file.mimetype);
            set.push("images = ?");
            params.push(newPath);
        }
        if (set.length === 0) {
            return res
                .status(400)
                .json({ ok: false, message: "ไม่มีฟิลด์ให้อัปเดต" });
        }
        const [[dup]] = await db_1.conn.query(`SELECT id FROM games WHERE title = ? AND category_name = ? AND id <> ? LIMIT 1`, [nextTitle, nextCategoryCsv, id]);
        if (dup) {
            return res.status(409).json({
                ok: false,
                message: "มีเกมชื่อนี้ในชุดหมวดหมู่เดียวกันอยู่แล้ว",
            });
        }
        params.push(id);
        await db_1.conn.query(`UPDATE games SET ${set.join(", ")} WHERE id = ?`, params);
        const [[updated]] = await db_1.conn.query("SELECT * FROM games WHERE id = ? LIMIT 1", [id]);
        const imageUrl = (0, upload_1.toAbsoluteUrl)(req, updated.images);
        const categoriesArr = _catFromCsv(updated.category_name);
        res.json({
            ok: true,
            message: "อัปเดตสำเร็จ (บางฟิลด์)",
            game: { ...updated, imageUrl, categories: categoriesArr },
        });
    }
    catch (e) {
        console.error("PATCH /games/:id error:", e);
        res.status(500).json({ ok: false, message: "Server error" });
    }
});
exports.router.delete("/games/:id", async (req, res) => {
    const gameId = req.params.id;
    try {
        const [[gameToDelete]] = await db_1.conn.query(`SELECT * FROM games WHERE id = ? LIMIT 1`, [gameId]);
        if (!gameToDelete) {
            return res
                .status(404)
                .json({ ok: false, message: "ไม่พบเกมที่ต้องการลบ" });
        }
        const imagePath = gameToDelete.images;
        if (imagePath && fs_1.default.existsSync(imagePath)) {
            try {
                fs_1.default.unlinkSync(imagePath);
                console.log("Image file deleted:", imagePath);
            }
            catch (err) {
                console.error("Error deleting image file:", err);
            }
        }
        await db_1.conn.query(`DELETE FROM games WHERE id = ?`, [gameId]);
        const [[checkGame]] = await db_1.conn.query(`SELECT * FROM games WHERE id = ? LIMIT 1`, [gameId]);
        if (checkGame) {
            return res
                .status(500)
                .json({ ok: false, message: "เกิดข้อผิดพลาดในการลบข้อมูลเกม" });
        }
        res.json({ ok: true, message: "ข้อมูลเกมถูกลบเรียบร้อยแล้ว" });
    }
    catch (error) {
        console.error("Error deleting game:", error);
        res.status(500).json({
            ok: false,
            message: "เกิดข้อผิดพลาดในการลบข้อมูลเกม",
            error: error,
        });
    }
});
exports.router.get("/games/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ ok: false, message: "Invalid id" });
        }
        // Retrieve game details from the database
        const [rows] = await db_1.conn.query(`
      SELECT id, title, price, category_name AS category_name, description, images, release_date AS releaseDate
      FROM games
      WHERE id = ? 
      LIMIT 1
    `, [id]);
        if (!rows.length) {
            return res.status(404).json({ ok: false, message: "Not Found" });
        }
        const game = rows[0];
        const imageUrl = (0, upload_1.toAbsoluteUrl)(req, game.images);
        // Retrieve purchase stats for the game (number of purchases and revenue)
        const [selfStatRows] = await db_1.conn.query(`
      SELECT
        g.id AS game_id,
        COALESCE(COUNT(oi.id), 0) AS purchases,
        COALESCE(SUM(oi.unit_price), 0) AS revenue
      FROM games g
      LEFT JOIN order_items oi ON oi.game_id = g.id
      LEFT JOIN orders o ON o.id = oi.order_id
      WHERE g.id = ?
      GROUP BY g.id
    `, [id]);
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
        // Rank the games based on the number of purchases
        const [rankRows] = await db_1.conn.query(`
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
          RANK() OVER (ORDER BY purchases DESC, revenue DESC, game_id ASC) AS rank_by_count  -- Rank by purchases
        FROM sales
      )
      SELECT r.*
      FROM ranked r
      WHERE r.game_id = ?
      LIMIT 5;  -- Limit the result to top 5 games
    `, [id]);
        const rank = rankRows[0] ?? {
            rank_by_count: null,
            purchases: 0,
            revenue: 0,
        };
        // If the game rank exceeds 5, show an empty string or skip the rank.
        const ranking = rank.rank_by_count && rank.rank_by_count <= 5
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
    }
    catch (e) {
        console.error("GET /games/:id error:", e);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
});
exports.router.get("/games", async (req, res) => {
    try {
        const [rows] = await db_1.conn.query(`SELECT id, title, price, category_name AS categoryName, images, description,
              release_date AS releaseDate, created_at AS createdAt, updated_at AS updatedAt
       FROM games
       ORDER BY created_at DESC`);
        const data = rows.map((r) => ({
            ...r,
            imageUrl: (0, upload_1.toAbsoluteUrl)(req, r.images),
        }));
        return res.json({ ok: true, games: data });
    }
    catch (e) {
        console.error("GET /games error:", e);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
});
exports.router.get("/stats/ranking", async (req, res) => {
    try {
        const _mode = String(req.query.mode || "").toLowerCase();
        const dateStr = String(req.query.date || "");
        const by = req.query.by === "revenue" ? "revenue" : "count";
        const fillZeros = String(req.query.fillZeros || "0") === "1";
        const limitReq = Number(req.query.limit) || 5;
        const limit = Math.max(5, Math.min(limitReq, 100));
        const rawCats = req.query.categories ??
            req.query.category ??
            req.query.categoryName;
        const categories = normalizeCats(rawCats);
        const isAll = !_mode || _mode === "all";
        const mode = isAll ? "all" : _mode;
        let range = null;
        if (!isAll) {
            range = calcRange(mode, dateStr);
            if (!range) {
                return res.status(400).json({
                    ok: false,
                    message: "mode/date ไม่ถูกต้อง (mode=day|month|year, date ตามรูปแบบของ mode)",
                });
            }
        }
        // สร้าง WHERE/params สำหรับ filter หมวดหมู่ (เวลาถูกย้ายไปไว้ใน JOIN)
        const conds = [];
        const params = [];
        if (categories.length) {
            conds.push(`(${categories
                .map(() => `FIND_IN_SET(?, REPLACE(g.category_name, ', ', ','))`)
                .join(" OR ")})`);
            params.push(...categories);
        }
        const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
        // ORDER หลักตาม "by"
        const orderSQL = by === "revenue"
            ? `ORDER BY revenue DESC, purchases DESC, game_id ASC`
            : `ORDER BY purchases DESC, revenue DESC, game_id ASC`;
        // สร้างส่วนเงื่อนไขเวลาสำหรับ JOIN orders (ไม่ทำลาย LEFT JOIN)
        const joinTimeSQL = !range
            ? "" // ทั้งช่วงเวลา = ไม่กรองเวลา
            : "AND (o.created_at >= ? AND o.created_at < ?)";
        // params เวลาต้องต่อท้าย (ใช้ใน JOIN)
        if (range) {
            params.push(range.start, range.end);
        }
        const sql = `
      WITH sales AS (
        SELECT
          g.id AS game_id,
          g.title,
          g.images,
          g.category_name,
          g.price AS price,
          COUNT(oi.id) AS purchases,  -- จำนวนการซื้อ
          COALESCE(SUM(oi.unit_price), 0) AS revenue,  -- ยอดขายรวม
          MIN(o.created_at) AS first_sale_at,
          MAX(o.created_at) AS last_sale_at
        FROM games g
        LEFT JOIN order_items oi
          ON oi.game_id = g.id
        LEFT JOIN orders o
          ON o.id = oi.order_id
          ${joinTimeSQL}                 -- เงื่อนไขเวลาอยู่ใน JOIN
        ${whereSql}                      -- เงื่อนไขหมวดหมู่
        GROUP BY g.id
        HAVING COUNT(oi.id) > 0          -- กรองเฉพาะเกมที่มียอดขาย (purchases > 0)
      ),
      ranked AS (
        SELECT
          s.*,
          RANK() OVER (ORDER BY s.purchases DESC, s.game_id ASC) AS rank_by_count  -- จัดอันดับจากจำนวนการซื้อ
        FROM sales s
      )
      SELECT *
      FROM ranked
      ${fillZeros ? "" : "WHERE purchases > 0"}   -- เลือกตัด 0 ออกหรือไม่
      ${orderSQL}
      LIMIT ${limit};
    `;
        const [rows] = await db_1.conn.query(sql, params);
        const items = rows.map((r, idx) => {
            const imageUrl = typeof upload_1.toAbsoluteUrl === "function" ? (0, upload_1.toAbsoluteUrl)(req, r.images) : r.images;
            return {
                rank: idx + 1,
                gameId: r.game_id,
                title: r.title,
                price: Number(r.price ?? 0),
                purchases: Number(r.purchases ?? 0),
                revenue: Number(r.revenue ?? 0), // ยอดขายรวม
                categoryName: r.category_name,
                categories: csvToArray(r.category_name),
                image: r.images,
                imageUrl,
                firstSaleAt: r.first_sale_at,
                lastSaleAt: r.last_sale_at,
                period: range ? { start: range.start, end: range.end } : null,
                rankByCount: r.rank_by_count,
            };
        });
        return res.json({
            ok: true,
            mode,
            date: range ? dateStr : null,
            by,
            limit,
            count: items.length,
            items,
        });
    }
    catch (e) {
        console.error("GET /admin/stats/ranking error:", e);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
});
function calcRange(mode, dateStr) {
    const pad = (n) => String(n).padStart(2, "0");
    if (mode === "day") {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
        if (!m)
            return null;
        const y = +m[1], mo = +m[2], d = +m[3];
        const start = `${y}-${pad(mo)}-${pad(d)} 00:00:00`;
        const dt = new Date(Date.UTC(y, mo - 1, d + 1));
        const end = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())} 00:00:00`;
        return { start, end };
    }
    if (mode === "month") {
        const m = /^(\d{4})-(\d{2})$/.exec(dateStr);
        if (!m)
            return null;
        const y = +m[1], mo = +m[2];
        const start = `${y}-${pad(mo)}-01 00:00:00`;
        const dt = new Date(Date.UTC(y, mo, 1));
        const end = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())} 00:00:00`;
        return { start, end };
    }
    if (mode === "year") {
        const m = /^(\d{4})$/.exec(dateStr);
        if (!m)
            return null;
        const y = +m[1];
        const start = `${y}-01-01 00:00:00`;
        const end = `${y + 1}-01-01 00:00:00`;
        return { start, end };
    }
    return null;
}
function csvToArray(csv) {
    if (!csv)
        return [];
    return String(csv)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}
exports.router.get("/top-sellers", async (req, res) => {
    try {
        const { period = "all", date = "" } = req.query;
        const dateStr = String(date ?? "");
        let start = null;
        let end = null;
        // สร้างช่วงเวลาแบบ [start, end) ครอบคลุมเต็มวัน/เดือน/ปี
        if (period === "day" && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            start = `${dateStr} 00:00:00`;
            const d = new Date(`${dateStr}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() + 1);
            end = d.toISOString().slice(0, 10) + " 00:00:00";
        }
        else if (period === "month" && /^\d{4}-\d{2}$/.test(dateStr)) {
            const [y, m] = dateStr.split("-").map(Number);
            const startD = new Date(Date.UTC(y, m - 1, 1));
            const endD = new Date(Date.UTC(y, m, 1));
            start = startD.toISOString().slice(0, 10) + " 00:00:00";
            end = endD.toISOString().slice(0, 10) + " 00:00:00";
        }
        else if (period === "year" && /^\d{4}$/.test(dateStr)) {
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
          COALESCE(COUNT(oi.id), 0) AS purchases,  -- จำนวนการซื้อ
          COALESCE(SUM(oi.unit_price), 0) AS revenue,  -- ยอดขายรวม
          MIN(o.created_at) AS first_sale_at,
          MAX(o.created_at) AS last_sale_at
        FROM games g
        LEFT JOIN order_items oi
          ON oi.game_id = g.id
        LEFT JOIN orders o
          ON o.id = oi.order_id
        WHERE o.created_at >= ? AND o.created_at < ?  -- กรองช่วงเวลาใน WHERE
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
        const params = start && end ? [start, end] : []; // Ensure that params are correctly set
        const [rows] = await db_1.conn.query(query, params);
        const topSellers = rows.map((r, idx) => {
            const rel = r.images ?? null; // คอลัมน์ชื่อ image
            const imageUrl = rel ? (0, upload_1.toAbsoluteUrl)(req, rel) : "default-image-url.jpg";
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
    }
    catch (e) {
        console.error("Error fetching top sellers:", e);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
});
