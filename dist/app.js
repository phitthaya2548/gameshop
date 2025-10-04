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
const addgame_1 = require("./controllers/addgame");
const auth_1 = require("./controllers/auth");
const register_1 = require("./controllers/register");
const user_1 = require("./controllers/user");
const jws_1 = require("./middlewares/jws");
exports.app = (0, express_1.default)();
// app.use(
//   cors({
//     origin: true,
//     credentials: true,
//     allowedHeaders: ["Content-Type", "Authorization"],
//     methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
//   })
// );
exports.app.use((0, cors_1.default)({
    origin: "*",
}));
exports.app.use(jws_1.jwtAuthen);
exports.app.use(express_1.default.json({ limit: "80mb" }));
exports.app.use(express_1.default.urlencoded({ extended: true, limit: "80mb" }));
exports.app.use("/uploads", express_1.default.static(path_1.default.join(process.cwd(), "uploads")));
exports.app.use("/me", user_1.router);
exports.app.use("/login", auth_1.router);
exports.app.use("/register", register_1.router);
exports.app.use("/admin", addgame_1.router);
exports.app.use((err, _req, res, _next) => {
    if (err instanceof express_jwt_1.UnauthorizedError) {
        return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
    return res.status(500).json({ ok: false, message: "Server error" });
});
exports.app.use((req, res) => {
    res.status(404).json({ message: "Not Found" });
});
