// --- Union types ---

export type DeliveryStatus =
  | 'pending'
  | 'assigned'
  | 'released'
  | 'in_transit'
  | 'delivered'
  | 'acknowledged'
  | 'failed';

export type DispatchStatus = 'draft' | 'ready' | 'active' | 'completed';

export type VettedStatus = 'pending' | 'vetted' | 'suspended';

export type StrictnessLevel = 'standard' | 'high' | 'maximum';

export type CommunicationPreference = 'sms' | 'whatsapp';

// --- Enums ---

export enum UserRole {
  admin = 'admin',
  driver = 'driver',
}

// --- Core interfaces ---

export interface Recipient {
  id: string;
  name: string;
  address: string;
  phone: string;
  lat: number;
  lng: number;
  communicationPreference: CommunicationPreference;
  whatsappConsent: boolean;
  verified: boolean;
  createdAt: Date;
}

export type VehicleSize = 'sedan' | 'suv' | 'minivan' | 'truck' | 'van';

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface AvailabilitySlot {
  day: DayOfWeek;
  startTime: string; // "HH:mm" 24h format
  endTime: string;   // "HH:mm" 24h format
}

export interface DeliveryZone {
  id: string;
  name: string;
  polygon: Array<{ lat: number; lng: number }>; // GeoJSON-style polygon points
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  email: string;
  vettedStatus: VettedStatus;
  vehicleSize: VehicleSize;
  vehicleModel: string;
  maxDeliveries: number;        // max stops per shift based on vehicle + preference
  languages: string[];
  availability: AvailabilitySlot[];
  deliveryZoneIds: string[];    // zones this driver is willing to cover
  teamName: string;
  createdAt: Date;
}

export interface DistributionProposal {
  sessionId: string;
  assignments: DistributionAssignment[];
  unassigned: UnassignedDelivery[];
  warnings: string[];
}

export interface DistributionAssignment {
  driverId: string;
  driverName: string;
  vehicleSize: VehicleSize;
  maxDeliveries: number;
  deliveries: Array<{
    deliveryId: string;
    recipientName: string;
    address: string;
    lat: number;
    lng: number;
    notes: string;
    distanceFromPrev: number; // km from previous stop
  }>;
  totalDistance: number; // km total route
  estimatedTime: number; // minutes
  loadPercent: number;   // deliveries / maxDeliveries * 100
}

export interface UnassignedDelivery {
  deliveryId: string;
  recipientName: string;
  address: string;
  lat: number;
  lng: number;
  reason: string; // e.g. "no driver covers this zone", "all drivers at capacity"
}

export interface Delivery {
  id: string;
  recipientId: string;
  driverId: string;
  dispatchSessionId: string;
  status: DeliveryStatus;
  address: string; // encrypted snapshot
  lat: number;
  lng: number;
  notes: string;
  releasedAt: Date | null;
  deliveredAt: Date | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
}

export interface DispatchSession {
  id: string;
  date: string;
  status: DispatchStatus;
  createdBy: string;
  strictnessLevel: StrictnessLevel;
  downloadTokenTtlMinutes: number;
  routeDataTtlHours: number;
  createdAt: Date;
}

export interface DriverCheckIn {
  id: string;
  driverId: string;
  dispatchSessionId: string;
  checkedInAt: Date;
  routeReleasedAt: Date | null;
  routeDownloadedAt: Date | null;
  purgeConfirmedAt: Date | null;
}

export interface CommunicationSession {
  id: string;
  driverPhone: string; // encrypted
  recipientPhone: string; // encrypted
  twilioProxyNumber: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface AdminUser {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  totpSecret?: string;
  createdAt: Date;
}

// --- Data transfer types ---

export interface RoutePacket {
  sessionId: string;
  driverId: string;
  stops: Array<{
    deliveryId: string;
    address: string;
    lat: number;
    lng: number;
    notes: string;
    recipientName: string;
    sequence: number;
  }>;
  expiresAt: Date;
}

export interface DriverSyncPayload {
  driverId: string;
  updates: Array<{
    deliveryId: string;
    status: DeliveryStatus;
    timestamp: Date;
  }>;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
