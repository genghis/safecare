import crypto from 'crypto';
import type { FastifyRequest } from 'fastify';
import { constantTimeEquals } from './security.js';

function getForwardedValue(header: string | undefined): string | undefined {
  return header
    ?.split(',')
    .map((value) => value.trim())
    .find(Boolean);
}

export function getExternalRequestUrl(
  request: FastifyRequest,
  configuredBaseUrl?: string,
): string {
  if (configuredBaseUrl) {
    return new URL(request.url, configuredBaseUrl).toString();
  }

  const protocol =
    getForwardedValue(request.headers['x-forwarded-proto'] as string | undefined) ??
    request.protocol;
  const host =
    getForwardedValue(request.headers['x-forwarded-host'] as string | undefined) ??
    request.headers.host ??
    'localhost';

  return new URL(request.url, `${protocol}://${host}`).toString();
}

export function validateTwilioSignature(
  url: string,
  params: Record<string, string | string[] | undefined>,
  authToken: string,
  providedSignature?: string,
): boolean {
  if (!providedSignature) {
    return false;
  }

  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      const rawValue = params[key];
      if (rawValue === undefined) {
        return acc;
      }

      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of values) {
        acc += `${key}${value}`;
      }
      return acc;
    }, url);

  const expected = crypto
    .createHmac('sha1', authToken)
    .update(data, 'utf8')
    .digest('base64');

  return constantTimeEquals(expected, providedSignature);
}
