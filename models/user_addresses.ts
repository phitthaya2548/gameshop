export class UserAddress {
    user_id: number;
    name_address: string;
    address_text: string;
    gps_lat?: number | null;
    gps_lng?: number | null;
    is_default: boolean;
  
    constructor(data: any, userId: number) {
      this.user_id = userId;
      this.name_address = data.name_address ?? "บ้าน";
      this.address_text = data.address_text;
      this.gps_lat = data.gps_lat ?? null;
      this.gps_lng = data.gps_lng ?? null;
      this.is_default = data.is_default ?? false;
    }
}