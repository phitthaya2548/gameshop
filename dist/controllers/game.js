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
// POST /addgames
exports.router.post("/addgames", upload_1.upload.single("image"), async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    try {
        const { title, price, categoryName, description, releaseDate } = req.body ?? {};
        // ตรวจสอบชื่อเกม
        if (typeof title !== "string" || title.trim().length < 2) {
            return res
                .status(400)
                .json({ ok: false, message: "กรุณากรอกชื่อเกมอย่างน้อย 2 ตัวอักษร" });
        }
        // ตรวจสอบราคา
        const priceNum = Number(price);
        if (!Number.isFinite(priceNum) || priceNum < 0) {
            return res.status(400).json({ ok: false, message: "ราคาไม่ถูกต้อง" });
        }
        // ตรวจสอบประเภทเกม
        if (typeof categoryName !== "string" || categoryName.trim().length < 2) {
            return res.status(400).json({ ok: false, message: "กรุณากรอกประเภทเกม" });
        }
        const file = req.file;
        if (!file) {
            return res
                .status(400)
                .json({ ok: false, message: "กรุณาแนบรูปปก (ไฟล์ภาพ)" });
        }
        // บันทึกไฟล์รูปภาพ
        const relativePath = (0, upload_1.saveImageBufferToUploads)(file.buffer, file.mimetype);
        // ถ้า releaseDate ไม่ได้กรอก, ใช้วันที่ปัจจุบัน
        const releaseDateValue = releaseDate
            ? releaseDate.trim()
            : new Date()
                .toLocaleDateString("en-GB", {
                timeZone: "Asia/Bangkok", // ใช้เขตเวลา Bangkok (ประเทศไทย)
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
            })
                .split("/")
                .reverse()
                .join("-"); // รูปแบบ YYYY-MM-DD
        // คำสั่ง SQL สำหรับเพิ่มข้อมูลเกม
        const [rs] = await db_1.conn.query(`INSERT INTO games
         (title, price, category_name, images, description, release_date)
       VALUES (?, ?, ?, ?, ?, ?)`, [
            title.trim(),
            priceNum,
            categoryName.trim(),
            relativePath,
            typeof description === "string" ? description : null,
            releaseDateValue, // ใช้ releaseDate ที่รับเข้ามาหรือวันที่ปัจจุบัน
        ]);
        // ดึงข้อมูลเกมที่เพิ่งสร้าง
        const [[row]] = await db_1.conn.query(`SELECT id, title, price, category_name AS categoryName, images, description,
              release_date AS releaseDate, created_at AS createdAt, updated_at AS updatedAt
       FROM games
       WHERE id = ? 
       LIMIT 1`, [rs.insertId]);
        // สร้าง URL สำหรับแสดงภาพ
        const imageUrl = (0, upload_1.toAbsoluteUrl)(req, row.images);
        return res.status(201).json({ ok: true, game: { ...row, imageUrl } });
    }
    catch (e) {
        console.error("POST /addgames error:", e);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
});
exports.router.get("/search", async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    try {
        // รับ title และ categoryName จาก query parameter
        const { title, categoryName } = req.query;
        // สร้าง query พื้นฐาน
        let query = `SELECT id, title, price, category_name, images FROM games WHERE 1=1`;
        const queryParams = [];
        // กรองตามชื่อเกม (ถ้ามี)
        if (title) {
            query += ` AND title LIKE ?`;
            queryParams.push(`%${title}%`);
        }
        // กรองตามหมวดหมู่ (ถ้ามี)
        if (categoryName) {
            query += ` AND category_name LIKE ?`;
            queryParams.push(`%${categoryName}%`);
        }
        // รัน query
        const [rows] = await db_1.conn.query(query, queryParams);
        const games = rows;
        // ถ้าไม่พบเกม
        if (games.length === 0) {
            return res
                .status(404)
                .json({ ok: false, message: "ไม่พบเกมที่ตรงกับเงื่อนไขการค้นหา" });
        }
        // ส่งผลลัพธ์กลับไป
        res.json({ ok: true, games });
    }
    catch (error) {
        console.error("Error searching games:", error);
        res.status(500).json({ ok: false, message: "เกิดข้อผิดพลาดในการค้นหาเกม" });
    }
});
// ✅ Partial update เฉพาะฟิลด์ที่มีใน request
exports.router.patch("/games/:id", upload_1.upload.single("image"), async (req, res) => {
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ ok: false, message: "Invalid id" });
        }
        // ดึงข้อมูลเดิม (ไว้ตรวจเช็ค/สร้าง url รูป)
        const [[current]] = await db_1.conn.query("SELECT * FROM games WHERE id = ? LIMIT 1", [id]);
        if (!current)
            return res.status(404).json({ ok: false, message: "Not Found" });
        // รับค่าที่ “อาจ” ถูกส่งมา (undefined = ไม่อัปเดต)
        let { title, price, categoryName, description, releaseDate } = req.body ?? {};
        // เก็บรายการคอลัมน์ที่ต้องอัปเดตแบบไดนามิก
        const set = [];
        const params = [];
        if (typeof title !== "undefined") {
            title = String(title).trim();
            if (title.length < 2)
                return res
                    .status(400)
                    .json({ ok: false, message: "ชื่อเกมสั้นเกินไป" });
            set.push("title = ?");
            params.push(title);
        }
        if (typeof price !== "undefined") {
            const pn = Number(price);
            if (!Number.isFinite(pn) || pn < 0)
                return res.status(400).json({ ok: false, message: "ราคาไม่ถูกต้อง" });
            set.push("price = ?");
            params.push(pn);
        }
        if (typeof categoryName !== "undefined") {
            set.push("category_name = ?");
            params.push(String(categoryName).trim());
        }
        if (typeof description !== "undefined") {
            // อนุญาต null ได้: ส่ง "" จะเก็บ "", ส่ง null จะเก็บ NULL
            set.push("description = ?");
            params.push(description === null ? null : String(description).trim());
        }
        if (typeof releaseDate !== "undefined") {
            // อนุญาต null หรือ 'YYYY-MM-DD'
            set.push("release_date = ?");
            params.push(releaseDate ? String(releaseDate).trim() : null);
        }
        // ไฟล์ภาพใหม่ (ถ้ามี)
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
        params.push(id);
        await db_1.conn.query(`UPDATE games SET ${set.join(", ")} WHERE id = ?`, params);
        const [[updated]] = await db_1.conn.query("SELECT * FROM games WHERE id = ? LIMIT 1", [id]);
        // สร้าง URL รูปให้พร้อมใช้ (แล้วแต่โครงสร้างจริงของคุณ)
        const imageUrl = (0, upload_1.toAbsoluteUrl)(req, updated.images);
        res.json({
            ok: true,
            message: "อัปเดตสำเร็จ (บางฟิลด์)",
            game: { ...updated, imageUrl },
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
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
            return res.status(400).json({ ok: false, message: "Invalid id" });
        const [rows] = await db_1.conn.query(`SELECT id, title, price,
              category_name AS category_name,
              description,
              images,
              release_date AS releaseDate
       FROM games
       WHERE id = ?`, [id]);
        if (!rows.length)
            return res.status(404).json({ ok: false, message: "Not Found" });
        const imageUrl = (0, upload_1.toAbsoluteUrl)(req, rows[0].images);
        rows[0].images = imageUrl;
        const g = rows[0];
        return res.json({
            id: g.id,
            title: g.title,
            price: Number(g.price),
            category_name: g.category_name ?? "",
            description: g.description ?? "",
            releaseDate: g.releaseDate ?? null,
            images: imageUrl ?? null,
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
