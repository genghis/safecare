/**
 * Admin audit logging service.
 *
 * Logs security-relevant admin actions to the audit_log table.
 * Actions include: login, logout, session revocation, dispatch operations,
 * recipient/driver management, and settings changes.
 */

import { db } from '../db/index.js';
import { auditLog } from '../db/schema.js';
import type { FastifyRequest } from 'fastify';

export type AuditAction =
  | 'admin_login'
  | 'admin_login_failed'
  | 'admin_logout'
  | 'admin_sessions_revoked'
  | 'totp_enabled'
  | 'totp_disabled'
  | 'dispatch_session_created'
  | 'routes_released'
  | 'driver_revoked'
  | 'recipient_created'
  | 'recipient_updated'
  | 'recipient_deleted'
  | 'driver_created'
  | 'driver_updated'
  | 'driver_vetted'
  | 'settings_updated'
  | 'maps_provisioned'
  | 'backup_exported'
  | 'backup_imported'
  | 'system_unlocked'
  | 'purge_confirmed'
  | 'hourly_purge'
  | 'immediate_purge'
  | 'app_update_started'
  | 'app_update_applied'
  | 'app_update_failed'
  | 'os_update_started'
  | 'os_update_applied'
  | 'os_update_failed';

function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return request.ip;
}

/**
 * Log an admin action to the audit trail.
 * Fire-and-forget — errors are logged but don't block the request.
 */
export async function logAdminAction(
  action: AuditAction,
  request: FastifyRequest,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    const adminId = request.user?.sub ?? null;
    const ip = getClientIp(request);

    await db.insert(auditLog).values({
      adminId,
      action,
      ip,
      details: details ?? null,
    });
  } catch (err) {
    // Non-fatal — don't break the request if audit logging fails
    request.log.error({ err, action }, 'Failed to write audit log');
  }
}

/**
 * Log an action without a request context (background jobs, system events).
 */
export async function logSystemAction(
  action: AuditAction,
  details?: Record<string, unknown> & { driverId?: string; stopCount?: number; completedCount?: number },
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action,
      driverId: details?.driverId ?? null,
      stopCount: details?.stopCount,
      completedCount: details?.completedCount,
      details: details ?? null,
    });
  } catch {
    // Non-fatal
  }
}
