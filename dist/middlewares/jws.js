"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jwtAuthen = exports.secret = void 0;
exports.generateToken = generateToken;
exports.verifyToken = verifyToken;
const dotenv_1 = __importDefault(require("dotenv"));
const express_jwt_1 = require("express-jwt");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
dotenv_1.default.config();
exports.secret = process.env.JWT_SECRET;
exports.jwtAuthen = (0, express_jwt_1.expressjwt)({
    secret: exports.secret,
    algorithms: ["HS256"],
}).unless({
    path: ["/register", "/login", { url: /^\/uploads\/.*/, methods: ["GET"] }],
});
function generateToken(payload) {
    return jsonwebtoken_1.default.sign(payload, exports.secret, {
        expiresIn: "30d",
        issuer: "Game-shop",
    });
}
function verifyToken(token) {
    try {
        const decodedPayload = jsonwebtoken_1.default.verify(token, exports.secret);
        return { valid: true, decoded: decodedPayload };
    }
    catch (error) {
        return { valid: false, error: JSON.stringify(error) };
    }
}
