"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserAddress = void 0;
class UserAddress {
    constructor(data, userId) {
        this.user_id = userId;
        this.name_address = data.name_address ?? "บ้าน";
        this.address_text = data.address_text;
        this.gps_lat = data.gps_lat ?? null;
        this.gps_lng = data.gps_lng ?? null;
        this.is_default = data.is_default ?? false;
    }
}
exports.UserAddress = UserAddress;
