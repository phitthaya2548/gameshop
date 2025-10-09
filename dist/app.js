"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const cors_1 = __importDefault(require("cors"));
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const express_jwt_1 = require("express-jwt");
const path_1 = __importDefault(require("path"));
const auth_1 = require("./controllers/auth");
const coupon_1 = require("./controllers/coupon");
const game_1 = require("./controllers/game");
const register_1 = require("./controllers/register");
const user_1 = require("./controllers/user");
const history_1 = require("./controllers/history");
const jws_1 = require("./middlewares/jws");
exports.app = (0, express_1.default)();
exports.app.use((0, cors_1.default)({
    origin: "*",
}));
exports.app.use(express_1.default.json({ limit: "80mb" }));
exports.app.use(express_1.default.urlencoded({ extended: true, limit: "80mb" }));
exports.app.use("/uploads", express_1.default.static(path_1.default.join(process.cwd(), "uploads")));
exports.app.use("/login", auth_1.router);
exports.app.use("/register", register_1.router);
exports.app.get("/", (_req, res) => {
    res.status(200).json({ ok: "Test Hello GameShop" });
});
exports.app.use("/admin", game_1.router);
exports.app.use(jws_1.jwtAuthen);
exports.app.use("/history", history_1.router);
exports.app.use("/me", user_1.router);
exports.app.use("/coupon", coupon_1.router);
exports.app.use((err, _req, res, _next) => {
    if (err instanceof express_jwt_1.UnauthorizedError) {
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
    console.error("Unhandled error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
});
exports.app.use((_req, res) => {
    res.status(404).json({ message: "Not Found" });
});
