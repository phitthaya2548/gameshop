
import type { Request } from "express";
import fs from "fs";
import multer from "multer";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXT_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};



export function saveImageBufferToUploads(
  buffer: Buffer,
  mime: string
): string {
  let ext: 'png' | 'jpg' | 'webp' = 'png';
  const m = mime.toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) ext = 'jpg';
  else if (m.includes('png')) ext = 'png';
  else if (m.includes('webp')) ext = 'webp';

  const dir = path.join(process.cwd(), 'uploads');
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), buffer);

  // เก็บใน DB เป็น path สั้นใต้ /uploads ตามนโยบาย
  return `/uploads/${filename}`;
}

export function toAbsoluteUrl(
  req: Request,
  input?: string | null
): string | null {
  if (!input) return null;

  // กัน external URL
  if (/^https?:\/\//i.test(input)) return null;

  let p = input.trim().replace(/^\/+/, "");
  if (!/^uploads\//i.test(p)) p = `uploads/${p}`;

  const base = `${req.protocol}://${req.get("host")}`;
  return `${base}/${p}`;
}
export const upload = multer({
  storage: multer.memoryStorage(),              // เก็บไว้ในหน่วยความจำก่อน
  limits: { fileSize: 2 * 1024 * 1024 },        // 2MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('รองรับเฉพาะไฟล์รูป png/jpg/webp'));
  },
})