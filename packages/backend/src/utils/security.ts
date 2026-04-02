import crypto from 'crypto';

export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  if (left.length !== right.length) {
    return false;
  }

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
