"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
exports.saveImageBufferToUploads = saveImageBufferToUploads;
exports.toAbsoluteUrl = toAbsoluteUrl;
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const UPLOAD_DIR = path_1.default.join(process.cwd(), "uploads");
if (!fs_1.default.existsSync(UPLOAD_DIR))
    fs_1.default.mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXT_MAP = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
};
function saveImageBufferToUploads(buffer, mime) {
    let ext = 'png';
    const m = mime.toLowerCase();
    if (m.includes('jpeg') || m.includes('jpg'))
        ext = 'jpg';
    else if (m.includes('png'))
        ext = 'png';
    else if (m.includes('webp'))
        ext = 'webp';
    const dir = path_1.default.join(process.cwd(), 'uploads');
    fs_1.default.mkdirSync(dir, { recursive: true });
    const filename = `${Date.now()}.${ext}`;
    fs_1.default.writeFileSync(path_1.default.join(dir, filename), buffer);
    // เก็บใน DB เป็น path สั้นใต้ /uploads ตามนโยบาย
    return `/uploads/${filename}`;
}
function toAbsoluteUrl(req, input) {
    if (!input)
        return null;
    // กัน external URL
    if (/^https?:\/\//i.test(input))
        return null;
    let p = input.trim().replace(/^\/+/, "");
    if (!/^uploads\//i.test(p))
        p = `uploads/${p}`;
    const base = `${req.protocol}://${req.get("host")}`;
    return `${base}/${p}`;
}
exports.upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(), // เก็บไว้ในหน่วยความจำก่อน
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
        if (/^image\/(png|jpe?g|webp)$/i.test(file.mimetype))
            cb(null, true);
        else
            cb(new Error('รองรับเฉพาะไฟล์รูป png/jpg/webp'));
    },
});
