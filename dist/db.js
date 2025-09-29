"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.conn = void 0;
const mysql2_1 = __importDefault(require("mysql2"));
exports.conn = mysql2_1.default.createPool({
    host: "202.28.34.203",
    port: 3306,
    user: "mb68_66011212194",
    password: "RKbxYKrhHQ1#",
    database: "mb68_66011212194",
    waitForConnections: true,
    connectionLimit: 10,
});
