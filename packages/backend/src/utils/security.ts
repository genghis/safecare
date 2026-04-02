import crypto from 'crypto';

/**
 * Constant-time string comparison that does not leak input length.
 * HMACs both inputs with a random key to produce fixed-length digests,
 * then compares the digests with timingSafeEqual.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const key = crypto.randomBytes(32);
  const left = crypto.createHmac('sha256', key).update(a).digest();
  const right = crypto.createHmac('sha256', key).update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

export function sanitizePlainText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('+')) {
    return `+${trimmed.slice(1).replace(/\D/g, '')}`;
  }
  return trimmed.replace(/\D/g, '');
}

export function normalizeCommunicationPreference(
  value?: string,
): 'sms' | 'whatsapp' | 'signal' {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'whatsapp' || normalized === 'signal') {
    return normalized;
  }
  return 'sms';
}

export function redactPhone(phone: string): string {
  const normalized = normalizePhone(phone);
  if (normalized.length <= 4) {
    return '***';
  }

  return `${normalized.slice(0, Math.min(2, normalized.length - 4))}***${normalized.slice(-2)}`;
}
