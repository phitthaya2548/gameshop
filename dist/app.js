"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const auth_1 = require("./controllers/auth");
const register_1 = require("./controllers/register");
const rider_1 = require("./controllers/rider");
const senditem_1 = require("./controllers/senditem");
const shipments_1 = require("./controllers/shipments");
const users_1 = require("./controllers/users");
const rideraccepted_1 = require("./controllers/rideraccepted");
exports.app = (0, express_1.default)();
exports.app.use(express_1.default.json({ limit: "80mb" }));
exports.app.use(express_1.default.urlencoded({ extended: true, limit: "80mb" }));
exports.app.use("/uploads", express_1.default.static(path_1.default.join(process.cwd(), "uploads")));
exports.app.use("/senditem", senditem_1.router);
exports.app.use("/users", users_1.router);
exports.app.use("/login", auth_1.router);
exports.app.use("/register", register_1.router);
exports.app.use("/shipments", shipments_1.router);
exports.app.use("/riders", rider_1.router);
exports.app.use("/riders/accepted", rideraccepted_1.router);
exports.app.use((req, res) => {
    res.status(404).json({ message: "Not Found" });
});
