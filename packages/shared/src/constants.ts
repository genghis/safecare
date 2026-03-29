/** Time-to-live for download tokens, in minutes */
export const DEFAULT_DOWNLOAD_TOKEN_TTL_MINUTES = 5;

/** Time-to-live for route data on driver devices, in hours */
export const DEFAULT_ROUTE_DATA_TTL_HOURS = 8;

/** Window within which drivers must confirm data purge, in hours */
export const DEFAULT_PURGE_CONFIRMATION_WINDOW_HOURS = 12;

/** Alert threshold for undelivered food, in minutes */
export const ORPHANED_FOOD_ALERT_MINUTES = 15;

/** Maximum retention time for delivery PII, in hours */
export const MAX_DELIVERY_RETENTION_HOURS = 24;

/** Audit log retention period, in days */
export const AUDIT_LOG_RETENTION_DAYS = 90;

/** Twilio number rotation interval, in days */
export const NUMBER_ROTATION_DAYS = 14;

/** Rate limit for driver API requests per minute */
export const RATE_LIMIT_DRIVER_RPM = 100;

/** JWT token expiry */
export const JWT_EXPIRY = '24h';

/** Admin session expiry, in hours */
export const SESSION_EXPIRY_HOURS = 8;

/** Strictness level descriptions for dispatch sessions */
export const STRICTNESS_LEVELS: Record<string, string> = {
  standard: 'Default settings with standard TTLs and rate limits',
  high: 'Shortened TTLs, stricter rate limits, and enhanced logging',
  maximum: 'Minimal TTLs, aggressive purge schedules, and full audit trail',
};

/** Randomised team names assigned to drivers for anonymity */
export const TEAM_NAMES: string[] = [
  'Squirrels',
  'Reindeer',
  'Foxes',
  'Owls',
  'Bears',
  'Rabbits',
  'Hawks',
  'Otters',
];

/** Vehicle size categories with default max delivery counts */
export const VEHICLE_SIZES: Record<
  string,
  { label: string; defaultMaxDeliveries: number; description: string }
> = {
  compact: { label: 'Compact / Hatchback', defaultMaxDeliveries: 2, description: 'Small car — a couple bags in the back seat' },
  sedan: { label: 'Sedan', defaultMaxDeliveries: 3, description: 'Standard car — trunk fits a few boxes' },
  suv: { label: 'SUV / Crossover', defaultMaxDeliveries: 5, description: 'SUV — folding rear seats for more room' },
  minivan: { label: 'Minivan', defaultMaxDeliveries: 7, description: 'Minivan — can load up the back' },
  truck: { label: 'Pickup Truck / Van', defaultMaxDeliveries: 10, description: 'Truck bed or cargo van — the big runs' },
};

/** Days of week with labels */
export const DAYS_OF_WEEK = [
  { value: 'mon', label: 'Monday', short: 'Mon' },
  { value: 'tue', label: 'Tuesday', short: 'Tue' },
  { value: 'wed', label: 'Wednesday', short: 'Wed' },
  { value: 'thu', label: 'Thursday', short: 'Thu' },
  { value: 'fri', label: 'Friday', short: 'Fri' },
  { value: 'sat', label: 'Saturday', short: 'Sat' },
  { value: 'sun', label: 'Sunday', short: 'Sun' },
] as const;
