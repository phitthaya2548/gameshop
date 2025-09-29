"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveImageFromBase64 = saveImageFromBase64;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function saveImageFromBase64(base64, ext = "png") {
    if (!base64 || base64.trim().length === 0)
        return "";
    const filename = `${Date.now()}.${ext}`;
    const dir = path_1.default.join(process.cwd(), "uploads");
    fs_1.default.mkdirSync(dir, { recursive: true });
    fs_1.default.writeFileSync(path_1.default.join(dir, filename), Buffer.from(base64, "base64"));
    return `/uploads/${filename}`;
}
