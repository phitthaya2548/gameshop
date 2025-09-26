
export interface Rider {
    rider_id?: number;         
    phone_number: string;     
    password: string;         
    name: string;              
    profile_image?: string | null; 
    vehicle_image?: string | null;  
    license_plate?: string | null;  
}