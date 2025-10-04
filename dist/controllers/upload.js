"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveImageFromBase64 = saveImageFromBase64;
exports.toAbsoluteUrl = toAbsoluteUrl;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function saveImageFromBase64(base64OrDataUrl, ext = "png") {
    if (!base64OrDataUrl || base64OrDataUrl.trim().length === 0)
        return "";
    // รองรับ data URL
    let detectedExt = null;
    const m = base64OrDataUrl.match(/^data:(.+?);base64,(.+)$/i);
    let pureBase64 = m ? m[2] : base64OrDataUrl;
    // ตัดช่องว่าง/ขึ้นบรรทัด ที่อาจทำให้ไฟล์เสีย
    pureBase64 = pureBase64.replace(/\s+/g, "");
    // ถ้ามี MIME ให้ map เป็นนามสกุล
    if (m) {
        const mime = m[1].toLowerCase();
        if (mime.includes("jpeg") || mime.includes("jpg"))
            detectedExt = "jpg";
        else if (mime.includes("png"))
            detectedExt = "png";
        else if (mime.includes("webp"))
            detectedExt = "webp";
    }
    const finalExt = detectedExt ?? ext; // ให้ MIME เป็นตัวกำหนดก่อน
    const filename = `${Date.now()}.${finalExt}`;
    const dir = path_1.default.join(process.cwd(), "uploads");
    fs_1.default.mkdirSync(dir, { recursive: true });
    fs_1.default.writeFileSync(path_1.default.join(dir, filename), Buffer.from(pureBase64, "base64"));
    return `/uploads/${filename}`;
}
function toAbsoluteUrl(req, input) {
    if (!input)
        return null;
    if (/^https?:\/\//i.test(input))
        return input;
    const base = `${req.protocol}://${req.get("host")}`;
    // ทำให้ขึ้นต้นด้วย /uploads เสมอ
    let path = input.trim().replace(/^\/+/, "");
    if (!/^uploads\//i.test(path))
        path = `uploads/${path}`;
    return `${base}/${path}`;
}
