
export type ShipmentStatus = '1' | '2' | '3' | '4';

export interface ShipmentRow {
  shipment_id: number;
  sender_id: number;
  receiver_id: number;
  pickup_address_id: number;
  delivery_address_id: number;
  rider_id: number | null;
  item_description: string;
  item_name: string | null;
  status: ShipmentStatus;
  created_at: string;
  updated_at: string;
}