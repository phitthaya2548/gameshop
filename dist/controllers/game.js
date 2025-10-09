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
// ✅ ใช้ชื่อไม่ซ้ำกับของเดิม
exports.router.post("/addgames", upload_1.upload.single("image"), async (req, res) => {
    let savedPath; // เก็บ path ไฟล์ที่เพิ่งเซฟ เพื่อ cleanup ถ้า error
    try {
        const { title, price, description, releaseDate } = req.body ?? {};
        // ---- Validate
        if (typeof title !== "string" || title.trim().length < 2) {
            return res.status(400).json({ ok: false, message: "กรุณากรอกชื่อเกมอย่างน้อย 2 ตัวอักษร" });
        }
        const priceNum = Number(price);
        if (!Number.isFinite(priceNum) || priceNum < 0) {
            return res.status(400).json({ ok: false, message: "ราคาไม่ถูกต้อง" });
        }
        // ---- รับ categories (array / JSON / CSV / fallback from categoryName)
        const rawCats = req.body.categories ?? req.body.categoryNames ?? req.body.categoryName;
        const categories = _catNormalize(rawCats);
        if (!categories.length) {
            return res.status(400).json({ ok: false, message: "กรุณาใส่หมวดหมู่เกมอย่างน้อย 1 หมวดหมู่" });
        }
        if (categories.some((n) => n.length < 2)) {
            return res.status(400).json({ ok: false, message: "ชื่อหมวดหมู่ต้องยาวอย่างน้อย 2 ตัวอักษร" });
        }
        // ---- Canonical CSV (trim, unique, sort) เพื่อให้ชน unique แบบคงที่
        const categoryCsv = _catToCsvSorted(categories); // ex. "Action, Horror"
        if (categoryCsv.length > 80) {
            return res.status(400).json({
                ok: false,
                message: `หมวดหมู่รวมยาวเกิน 80 ตัวอักษร (${categoryCsv.length}) กรุณาลดจำนวน/ย่อชื่อ`,
            });
        }
        // ---- รูปภาพ
        const file = req.file;
        if (!file) {
            return res.status(400).json({ ok: false, message: "กรุณาแนบรูปปก (ไฟล์ภาพ)" });
        }
        savedPath = (0, upload_1.saveImageBufferToUploads)(file.buffer, file.mimetype);
        // ---- วันที่ (YYYY-MM-DD Asia/Bangkok)
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
        // ---- Pre-check กันชน unique (เงียบ/เร็ว)
        const [[dup]] = await db_1.conn.query(`SELECT id FROM games WHERE title = ? AND category_name = ? LIMIT 1`, [title.trim(), categoryCsv]);
        if (dup) {
            // cleanup ไฟล์ที่เพิ่งเซฟ
            _safeUnlink(savedPath);
            return res.status(409).json({
                ok: false,
                message: "มีเกมชื่อนี้ในชุดหมวดหมู่เดียวกันอยู่แล้ว",
                hint: "ให้แก้ชื่อเกม หรือปรับชุดหมวดหมู่ (เพิ่ม/ลบ/เรียงต่างไม่ได้ผล เพราะถูก normalize แล้ว)",
            });
        }
        // ---- Insert
        const [rs] = await db_1.conn.query(`INSERT INTO games
         (title, price, category_name, images, description, release_date)
       VALUES (?, ?, ?, ?, ?, ?)`, [
            title.trim(),
            priceNum,
            categoryCsv, // เก็บ CSV แบบ canonical
            savedPath,
            typeof description === "string" ? description : null,
            releaseDateValue,
        ]);
        // ---- Select กลับมาส่ง
        const [[row]] = await db_1.conn.query(`SELECT id, title, price, category_name AS categoryName, images, description,
              release_date AS releaseDate, created_at AS createdAt, updated_at AS updatedAt
       FROM games
       WHERE id = ? 
       LIMIT 1`, [rs.insertId]);
        const imageUrl = (0, upload_1.toAbsoluteUrl)(req, row.images);
        const categoriesArr = _catFromCsv(row.categoryName);
        return res.status(201).json({
            ok: true,
            game: {
                ...row,
                imageUrl,
                categories: categoriesArr,
            },
        });
    }
    catch (e) {
        // ถ้า insert fail ให้ลบไฟล์ที่เพิ่งเซฟ (กันไฟล์ขยะ)
        if (savedPath)
            _safeUnlink(savedPath);
        // ชน unique index ก็รายงาน 409
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
/* ---------- Helpers ---------- */
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
        return _catClean(input.split(",")); // CSV
    }
    return [];
}
function _catToCsvSorted(categories) {
    return _catClean(categories).sort((a, b) => a.localeCompare(b)).join(", ");
}
function _catFromCsv(csv) {
    if (!csv)
        return [];
    return csv.split(",").map((s) => s.trim()).filter(Boolean);
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
        // รับหลายรูปแบบ: categories, categories[], categoryName (CSV/เดี่ยว)
        const rawCats = req.query.categories ?? req.query["categories[]"] ?? req.query.categoryName;
        const cats = normalizeCats(rawCats); // => string[]
        let sql = `SELECT id, title, price, category_name, images FROM games WHERE 1=1`;
        const params = [];
        if (title) {
            sql += ` AND title LIKE ?`;
            params.push(`%${title}%`);
        }
        if (cats.length) {
            // เป็นเงื่อนไข OR: มีอย่างน้อย 1 หมวดที่ตรง
            // ถ้าต้องการ AND ให้เปลี่ยน join(" AND ") ได้
            const orConds = cats
                .map(() => `FIND_IN_SET(?, REPLACE(category_name, ', ', ','))`)
                .join(" OR ");
            sql += ` AND (${orConds})`;
            params.push(...cats);
        }
        // (เติม order ตามต้องการ)
        sql += ` ORDER BY id DESC`;
        const [rows] = await db_1.conn.query(sql, params);
        if (!rows.length) {
            return res.status(404).json({ ok: false, message: "ไม่พบเกมที่ตรงกับเงื่อนไขการค้นหา" });
        }
        return res.json({ ok: true, games: rows });
    }
    catch (error) {
        console.error("Error searching games:", error);
        return res.status(500).json({ ok: false, message: "เกิดข้อผิดพลาดในการค้นหาเกม" });
    }
});
/* ===== Helpers ===== */
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
        return clean(input.split(",")); // CSV
    }
    return [];
}
function clean(arr) {
    return Array.from(new Set(arr.map(v => (typeof v === "string" ? v.trim() : "")).filter(Boolean)));
}
// ✅ Partial update เฉพาะฟิลด์ที่มีใน request
exports.router.patch("/games/:id", upload_1.upload.single("image"), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ ok: false, message: "Invalid id" });
        }
        // โหลดข้อมูลเดิม
        const [[current]] = await db_1.conn.query("SELECT * FROM games WHERE id = ? LIMIT 1", [id]);
        if (!current)
            return res.status(404).json({ ok: false, message: "Not Found" });
        // ---------- รับค่าที่อาจถูกส่งมา ----------
        let { title, price, categoryName, description, releaseDate } = req.body ?? {};
        // 1) เตรียม categories (array → CSV แบบ canonical)
        // รองรับ: categories (array/ซ้ำคีย์), categories[], categoryNames, categoryName (string/CSV/JSON)
        let categoryCsvToSet;
        const rawCats = req.body.categories ??
            req.body["categories[]"] ??
            req.body.categoryNames;
        if (typeof rawCats !== "undefined") {
            const cats = _catNormalize(rawCats);
            if (!cats.length) {
                return res.status(400).json({ ok: false, message: "กรุณาเลือกหมวดหมู่อย่างน้อย 1 รายการ" });
            }
            categoryCsvToSet = _catToCsvSorted(cats); // e.g. "Action, Horror"
        }
        else if (typeof categoryName !== "undefined") {
            // ยังรองรับการส่งเป็น categoryName (CSV/JSON/ชื่อเดียว)
            const cats = _catNormalize(categoryName);
            if (!cats.length) {
                return res.status(400).json({ ok: false, message: "กรุณาเลือกหมวดหมู่อย่างน้อย 1 รายการ" });
            }
            categoryCsvToSet = _catToCsvSorted(cats);
        }
        // กันความยาวล้นสคีม่าเดิมถ้าคุณใช้ VARCHAR(80) (ปรับตามจริง)
        if (categoryCsvToSet && categoryCsvToSet.length > 80) {
            return res.status(400).json({
                ok: false,
                message: `หมวดหมู่รวมยาวเกิน 80 ตัวอักษร (${categoryCsvToSet.length})`,
            });
        }
        // 2) Validate field อื่น ๆ + สร้างชุด UPDATE
        const set = [];
        const params = [];
        // title
        let nextTitle = current.title;
        if (typeof title !== "undefined") {
            title = String(title).trim();
            if (title.length < 2) {
                return res.status(400).json({ ok: false, message: "ชื่อเกมสั้นเกินไป" });
            }
            set.push("title = ?");
            params.push(title);
            nextTitle = title;
        }
        // price
        if (typeof price !== "undefined") {
            const pn = Number(price);
            if (!Number.isFinite(pn) || pn < 0) {
                return res.status(400).json({ ok: false, message: "ราคาไม่ถูกต้อง" });
            }
            set.push("price = ?");
            params.push(pn);
        }
        // category_name (CSV)
        let nextCategoryCsv = current.category_name;
        if (typeof categoryCsvToSet !== "undefined") {
            set.push("category_name = ?");
            params.push(categoryCsvToSet);
            nextCategoryCsv = categoryCsvToSet;
        }
        // description
        if (typeof description !== "undefined") {
            set.push("description = ?");
            params.push(description === null ? null : String(description).trim());
        }
        // release_date
        if (typeof releaseDate !== "undefined") {
            set.push("release_date = ?");
            params.push(releaseDate ? String(releaseDate).trim() : null);
        }
        // image ใหม่
        if (req.file) {
            const newPath = (0, upload_1.saveImageBufferToUploads)(req.file.buffer, req.file.mimetype);
            set.push("images = ?");
            params.push(newPath);
        }
        if (set.length === 0) {
            return res.status(400).json({ ok: false, message: "ไม่มีฟิลด์ให้อัปเดต" });
        }
        // 3) กันชน unique (title, category_name)
        const [[dup]] = await db_1.conn.query(`SELECT id FROM games WHERE title = ? AND category_name = ? AND id <> ? LIMIT 1`, [nextTitle, nextCategoryCsv, id]);
        if (dup) {
            return res.status(409).json({
                ok: false,
                message: "มีเกมชื่อนี้ในชุดหมวดหมู่เดียวกันอยู่แล้ว",
            });
        }
        // 4) ทำการอัปเดต
        params.push(id);
        await db_1.conn.query(`UPDATE games SET ${set.join(", ")} WHERE id = ?`, params);
        // 5) ตอบกลับ
        const [[updated]] = await db_1.conn.query("SELECT * FROM games WHERE id = ? LIMIT 1", [id]);
        const imageUrl = (0, upload_1.toAbsoluteUrl)(req, updated.images);
        // แปลง CSV -> array เพื่อให้ฟรอนต์ใช้สะดวก
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
        // Check if image exists and delete it (using fs.sync)
        const imagePath = gameToDelete.images;
        if (imagePath && fs_1.default.existsSync(imagePath)) {
            // Use fs from 'fs' for synchronous operations
            try {
                fs_1.default.unlinkSync(imagePath); // Use fs.unlinkSync to delete file synchronously
                console.log("Image file deleted:", imagePath);
            }
            catch (err) {
                console.error("Error deleting image file:", err);
            }
        }
        // Delete the game from the database
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
        // ---------- พารามิเตอร์สำหรับแรงก์ ----------
        const rawMode = (req.query.mode ?? "").toString().toLowerCase().trim();
        const mode = !rawMode || rawMode === "all" ? "all" : rawMode; // all|day|month|year
        const dateStr = (req.query.date ?? "").toString().trim();
        const by = req.query.by === "revenue" ? "revenue" : "count";
        let range = null;
        if (mode !== "all") {
            range = calcRange(mode, dateStr);
            if (!range) {
                return res.status(400).json({
                    ok: false,
                    message: "mode/date ไม่ถูกต้อง (mode=day|month|year, date ตามรูปแบบของ mode)",
                });
            }
        }
        const hasRange = !!range;
        // ---------- โหลดข้อมูลเกมพื้นฐาน ----------
        const [rows] = await db_1.conn.query(`SELECT id, title, price, category_name AS category_name, description, images,
              release_date AS releaseDate
       FROM games
       WHERE id = ? LIMIT 1`, [id]);
        if (!rows.length) {
            return res.status(404).json({ ok: false, message: "Not Found" });
        }
        const g = rows[0];
        const imageUrl = (0, upload_1.toAbsoluteUrl)(req, g.images);
        // ---------- คำนวณยอดขาย/รายได้ของ "เกมนี้" ----------
        // ใช้ LEFT JOIN + เงื่อนไขช่วงเวลาใน ON เพื่อให้เกมที่ไม่มีออเดอร์ยังได้ผลลัพธ์ (0)
        const timeJoin = hasRange ? `AND o.created_at >= ? AND o.created_at < ?` : ``;
        const [selfStatRows] = await db_1.conn.query(`
      SELECT
        g.id AS game_id,
        COALESCE(COUNT(oi.id), 0)           AS purchases,
        COALESCE(SUM(oi.unit_price), 0)     AS revenue
      FROM games g
      LEFT JOIN order_items oi ON oi.game_id = g.id
      LEFT JOIN orders o       ON o.id = oi.order_id ${timeJoin}
      WHERE g.id = ?
      GROUP BY g.id
      `, hasRange ? [range.start, range.end, id] : [id]);
        const selfStat = selfStatRows[0] ?? {
            game_id: id,
            purchases: 0,
            revenue: 0,
        };
        // ---------- คำนวณ "อันดับ" ของเกมนี้ ----------
        // ทำตารางยอดขายของทุกเกมในช่วงเดียวกัน แล้ว rank ทั้งระบบ
        const [rankRows] = await db_1.conn.query(`
      WITH sales AS (
        SELECT
          g.id AS game_id,
          COALESCE(COUNT(oi.id), 0)       AS purchases,
          COALESCE(SUM(oi.unit_price), 0) AS revenue
        FROM games g
        LEFT JOIN order_items oi ON oi.game_id = g.id
        LEFT JOIN orders o       ON o.id = oi.order_id ${timeJoin}
        GROUP BY g.id
      ),
      ranked AS (
        SELECT
          game_id,
          purchases,
          revenue,
          RANK() OVER (ORDER BY purchases DESC, revenue DESC, game_id ASC) AS rank_by_count,
          RANK() OVER (ORDER BY revenue   DESC, purchases DESC, game_id ASC) AS rank_by_revenue
        FROM sales
      )
      SELECT r.*, (SELECT COUNT(*) FROM sales) AS population
      FROM ranked r
      WHERE r.game_id = ?
      `, hasRange ? [range.start, range.end, id] : [id]);
        const rank = rankRows[0] ?? {
            rank_by_count: null,
            rank_by_revenue: null,
            population: null,
            purchases: 0,
            revenue: 0,
        };
        // ---------- ตอบกลับ (โครงสร้างเดิม + เพิ่ม ranking) ----------
        return res.json({
            id: g.id,
            title: g.title,
            price: Number(g.price),
            category_name: g.category_name ?? "",
            description: g.description ?? "",
            releaseDate: g.releaseDate ?? null,
            images: imageUrl ?? null,
            // เพิ่มข้อมูลที่ใช้กับหน้าแสดงอันดับ
            categories: csvToArray(g.category_name),
            ranking: {
                mode,
                date: mode === "all" ? null : dateStr,
                by,
                period: hasRange ? { start: range.start, end: range.end } : null,
                purchases: Number(selfStat.purchases || 0),
                revenue: Number(selfStat.revenue || 0),
                rankByCount: rank.rank_by_count ? Number(rank.rank_by_count) : null,
                rankByRevenue: rank.rank_by_revenue ? Number(rank.rank_by_revenue) : null,
                population: rank.population ? Number(rank.population) : null,
            },
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
        // ===== พารามิเตอร์ =====
        const _mode = String(req.query.mode || "").toLowerCase(); // all | day | month | year | ''(ว่าง)
        const dateStr = String(req.query.date || ""); // อาจว่าง
        const by = req.query.by === "revenue" ? "revenue" : "count";
        const fillZeros = String(req.query.fillZeros || "0") === "1";
        const limitReq = Number(req.query.limit) || 5;
        const limit = Math.max(5, Math.min(limitReq, 100)); // อย่างน้อย 5
        // หมวดหมู่: categories[]=, categories=, category=, categoryName=
        const rawCats = req.query.categories ??
            req.query.category ??
            req.query.categoryName;
        const categories = normalizeCats(rawCats);
        // ===== โหมดเวลา =====
        // isAll = ไม่ระบุ mode/date, หรือระบุ mode=all → ไม่กรองเวลา
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
        const hasRange = !!range;
        // ===== เงื่อนไข WHERE รวม (เวลา + หมวด) =====
        const conds = [];
        const params = [];
        if (hasRange) {
            conds.push(`o.created_at >= ? AND o.created_at < ?`);
            params.push(range.start, range.end);
        }
        if (categories.length) {
            conds.push(`(${categories.map(() => `FIND_IN_SET(?, REPLACE(g.category_name, ', ', ','))`).join(" OR ")})`);
            params.push(...categories);
        }
        const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
        // ===== ORDER BY =====
        const orderSQL = by === "revenue"
            ? `ORDER BY revenue DESC, purchases DESC`
            : `ORDER BY purchases DESC, revenue DESC`;
        // ===== ดึงข้อมูล =====
        let rows;
        if (!fillZeros) {
            // เฉพาะเกมที่ "มีขาย" ในช่วงนั้น (หรือทั้งหมดถ้า isAll)
            const sql = `
        SELECT
          oi.game_id,
          g.title,
          g.price,
          g.images,
          g.category_name,
          COUNT(*)           AS purchases,
          SUM(oi.unit_price) AS revenue,
          MIN(o.created_at)  AS first_sale_at,
          MAX(o.created_at)  AS last_sale_at
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN games  g ON g.id = oi.game_id
        ${whereSql}
        GROUP BY oi.game_id
        ${orderSQL}
        LIMIT ?
      `;
            const [rs] = await db_1.conn.query(sql, [...params, limit]);
            rows = rs;
        }
        else {
            // ปาดให้ครบด้วยยอด 0: รวมยอดใน CTE sales แล้ว LEFT JOIN games
            const timeWhereInCTE = hasRange ? `WHERE o.created_at >= ? AND o.created_at < ?` : ``;
            const catWhereOuter = categories.length
                ? `WHERE ${categories.map(() => `FIND_IN_SET(?, REPLACE(g.category_name, ', ', ','))`).join(" OR ")}`
                : ``;
            const sql = `
        WITH sales AS (
          SELECT
            oi.game_id,
            COUNT(*)           AS purchases,
            SUM(oi.unit_price) AS revenue,
            MIN(o.created_at)  AS first_sale_at,
            MAX(o.created_at)  AS last_sale_at
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          ${timeWhereInCTE}
          GROUP BY oi.game_id
        )
        SELECT
          g.id AS game_id,
          g.title,
          g.price,
          g.images,
          g.category_name,
          COALESCE(sales.purchases, 0) AS purchases,
          COALESCE(sales.revenue,   0) AS revenue,
          sales.first_sale_at,
          sales.last_sale_at
        FROM games g
        LEFT JOIN sales ON sales.game_id = g.id
        ${catWhereOuter}
        ${orderSQL}
        LIMIT ?
      `;
            const paramsCTE = [];
            if (hasRange)
                paramsCTE.push(range.start, range.end); // ของ CTE มาก่อน
            if (categories.length)
                paramsCTE.push(...categories); // แล้วของ outer WHERE
            paramsCTE.push(limit);
            const [rs] = await db_1.conn.query(sql, paramsCTE);
            rows = rs;
        }
        // ===== ตอบกลับ =====
        const items = rows.map((r, idx) => {
            const imageUrl = typeof upload_1.toAbsoluteUrl === "function" ? (0, upload_1.toAbsoluteUrl)(req, r.images) : r.images;
            return {
                rank: idx + 1,
                gameId: r.game_id,
                title: r.title,
                price: Number(r.price ?? 0),
                purchases: Number(r.purchases ?? 0),
                revenue: Number(r.revenue ?? 0),
                categoryName: r.category_name,
                categories: csvToArray(r.category_name),
                image: r.images,
                imageUrl,
                firstSaleAt: r.first_sale_at,
                lastSaleAt: r.last_sale_at,
                period: hasRange ? { start: range.start, end: range.end } : null,
            };
        });
        return res.json({
            ok: true,
            mode, // 'all' | 'day' | 'month' | 'year'
            date: hasRange ? dateStr : null,
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
    return String(csv).split(",").map((s) => s.trim()).filter(Boolean);
}
