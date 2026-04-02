import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import type { FastifyRequest } from 'fastify';
import {
  getExternalRequestUrl,
  validateTwilioSignature,
} from '../utils/webhook-auth.js';

describe('webhook-auth utilities', () => {
  it('validates a Twilio signature for a form-encoded webhook body', () => {
    const url = 'https://safecare.example/api/webhooks/twilio/sms';
    const params = {
      From: '+15551234567',
      Body: 'Received',
      MessageSid: 'SM123',
    };
    const authToken = 'super-secret-token';
    const payload = Object.keys(params)
      .sort()
      .reduce((acc, key) => `${acc}${key}${params[key as keyof typeof params]}`, url);
    const signature = crypto
      .createHmac('sha1', authToken)
      .update(payload, 'utf8')
      .digest('base64');

    expect(validateTwilioSignature(url, params, authToken, signature)).toBe(true);
    expect(validateTwilioSignature(url, params, authToken, 'bad-signature')).toBe(false);
  });

  it('prefers configured base URLs when reconstructing webhook URLs', () => {
    const request = {
      url: '/api/webhooks/twilio/sms',
      protocol: 'http',
      headers: {
        host: 'internal:3001',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'safecare.example',
      },
    } as FastifyRequest;

    expect(getExternalRequestUrl(request, 'https://secure.example')).toBe(
      'https://secure.example/api/webhooks/twilio/sms',
    );
    expect(getExternalRequestUrl(request)).toBe(
      'https://safecare.example/api/webhooks/twilio/sms',
    );
  });
});
