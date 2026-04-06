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

export type ServiceType = 'delivery' | 'ride';

export type ShiftStatus =
  | 'open'        // visible on shift board, no driver yet
  | 'claimed'     // driver has claimed, awaiting coordinator confirmation
  | 'confirmed'   // coordinator approved the claim
  | 'in_progress' // driver marked "on my way"
  | 'completed'   // ride finished
  | 'cancelled'   // cancelled by coordinator or driver
  | 'no_show';    // driver or passenger didn't show

export type IntakeSource = 'whatsapp' | 'signal' | 'jotform' | 'web_form' | 'manual';

export type IntakeStatus = 'pending' | 'processed' | 'rejected';

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
  displayId: string | null;       // short ID for schedules: "P2", "P3"
  serviceTypes: ServiceType[];    // what services they receive
  createdAt: Date;
}

export type VehicleSize = 'compact' | 'sedan' | 'suv' | 'minivan' | 'truck';

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
  vehicleDescription: string | null; // free-text: "red ford focus, grey hat"
  maxDeliveries: number;        // max stops per shift based on vehicle + preference
  maxRidesPerWeek: number;      // weekly ride capacity
  serviceTypes: ServiceType[];  // what services this driver provides
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

// --- Ride coordination interfaces ---

export interface SavedLocation {
  id: string;
  recipientId: string;
  label: string;              // "home", "work 1", "school"
  address: string;            // decrypted address
  lat: number;
  lng: number;
  neighborhood: string | null; // coarse area for shift board display
  isDefault: boolean;
  createdAt: Date;
}

export interface RideSchedule {
  id: string;
  recipientId: string;
  pickupLocationId: string;
  dropoffLocationId: string;
  daysOfWeek: DayOfWeek[];
  pickupTime: string;         // "HH:mm" 24h format
  estimatedDurationMinutes: number;
  label: string | null;       // "work 1 to home"
  notes: string | null;
  active: boolean;
  createdBy: string | null;
  createdAt: Date;
}

export interface Shift {
  id: string;
  rideScheduleId: string | null; // null if ad-hoc
  recipientId: string;
  driverId: string | null;       // null until claimed
  pickupLocationId: string;
  dropoffLocationId: string;
  date: string;                  // YYYY-MM-DD
  pickupTime: string;            // "HH:mm"
  estimatedDurationMinutes: number;
  label: string | null;          // "work 1 to home"
  pickupNeighborhood: string | null;
  dropoffNeighborhood: string | null;
  status: ShiftStatus;
  claimedAt: Date | null;
  confirmedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  notes: string | null;
  createdAt: Date;
}

/** What drivers see on the shift board — progressive disclosure (no addresses or phones) */
export interface ShiftBoardEntry {
  id: string;
  date: string;
  pickupTime: string;
  estimatedDurationMinutes: number;
  label: string | null;              // "work 1 to home"
  pickupNeighborhood: string | null; // "Regina" (not full address)
  dropoffNeighborhood: string | null;
  recipientDisplayId: string | null; // "P2" (not real name)
  status: ShiftStatus;
  /** Only populated if this driver has ridden with this passenger before */
  priorRideCount: number | null;
  /** True if coordinator flagged this as a preferred pairing for this driver */
  isPreferredPairing: boolean;
}

/** Full shift details revealed after driver claims and coordinator confirms */
export interface ShiftClaimDetails {
  shiftId: string;
  pickupAddress: string;
  dropoffAddress: string;
  recipientPhone: string;        // or proxy number
  recipientName: string;
  recipientLanguage: string;
  notes: string | null;
  driverVehicleDescription: string | null; // for day-before message to passenger
}

export interface DriverPassengerAffinity {
  id: string;
  driverId: string;
  recipientId: string;
  rideCount: number;
  preferred: boolean;
  lastRideDate: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface IntakeRequest {
  id: string;
  source: IntakeSource;
  sourceIdentifier: string | null;
  rawText: string | null;
  parsedData: Record<string, unknown> | null;
  status: IntakeStatus;
  processedBy: string | null;
  processedAt: Date | null;
  linkedRecipientId: string | null;
  linkedRideScheduleId: string | null;
  rejectionReason: string | null;
  createdAt: Date;
}

// --- Geometry types ---

export interface RouteGeometry {
  type: 'LineString';
  coordinates: [number, number][]; // [lng, lat] pairs
}

export interface TileBounds {
  south: number;
  west: number;
  north: number;
  east: number;
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
  /** AES-GCM-256 session key (hex) for client-side IndexedDB encryption. */
  sessionKey?: string;
  routeGeometry?: RouteGeometry;
  tileBounds?: TileBounds;
  tileUrls?: string[];
  routeDistance?: number; // meters
  routeDuration?: number; // seconds
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
