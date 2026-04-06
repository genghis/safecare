import Redis from 'ioredis';
import { config } from '../config.js';
import { t, SupportedLocale, DEFAULT_LOCALE } from '@safecare/shared';
import { getTwilioScrubQueue, queueSessionScrub } from '../jobs/index.js';
import { whatsappPool } from './whatsapp-pool.service.js';

type Channel = 'sms' | 'whatsapp' | 'signal';

export interface SendResult {
  success: boolean;
  channel: Channel;
  error?: string;
  messageId?: string;
}

export interface RecipientContact {
  phone: string;                    // decrypted phone number
  communicationPreference: Channel;
  language?: string;                // locale code (e.g., 'en', 'es', 'ar')
  whatsappConsent?: boolean;
}

const REDIS_SID_SET = 'twilio:message-sids';

export class NotificationService {
  private redis: Redis;

  constructor() {
    this.redis = new Redis(config.REDIS_URL);
  }

  /**
   * Send a localized notification to a recipient via their preferred channel.
   * Falls back to SMS if preferred channel fails or is unavailable.
   */
  async send(
    recipient: RecipientContact,
    messageKey: string,
    vars?: Record<string, string>,
  ): Promise<SendResult> {
    const locale = (recipient.language as SupportedLocale) ?? DEFAULT_LOCALE;
    const message = t(messageKey, locale, vars);
    const preferred = recipient.communicationPreference;

    // If WhatsApp is preferred but consent is not given, fall back to SMS
    if (preferred === 'whatsapp' && !recipient.whatsappConsent) {
      return this.sendSms(recipient.phone, message);
    }

    // Try preferred channel first
    let result: SendResult;
    switch (preferred) {
      case 'signal':
        result = await this.sendSignal(recipient.phone, message);
        break;
      case 'whatsapp':
        result = await this.sendWhatsApp(recipient.phone, message);
        break;
      case 'sms':
      default:
        result = await this.sendSms(recipient.phone, message);
        break;
    }

    // If preferred channel succeeded, return the result
    if (result.success) {
      return result;
    }

    // Fall back to SMS if preferred channel was not already SMS
    if (preferred !== 'sms') {
      const fallback = await this.sendSms(recipient.phone, message);
      return fallback;
    }

    return result;
  }

  async sendOneTimeCode(phone: string, code: string): Promise<SendResult> {
    const message = `Your SafeCare login code is ${code}. It expires in 5 minutes.`;

    if (config.SIGNAL_CLI_URL && config.SIGNAL_PHONE_NUMBER) {
      const signalResult = await this.sendSignal(phone, message);
      if (signalResult.success) {
        return signalResult;
      }
    }

    return this.sendSms(phone, message);
  }

  private async trackMessageSid(sid?: string): Promise<void> {
    if (!sid) {
      return;
    }

    await this.redis.sadd(REDIS_SID_SET, sid);

    try {
      await queueSessionScrub(getTwilioScrubQueue(), [sid]);
    } catch {
      // Queue may not be ready yet; the daily sweep is the fallback.
    }
  }

  /**
   * Send an SMS via the Twilio REST API.
   */
  private async sendSms(phone: string, message: string): Promise<SendResult> {
    const accountSid = config.TWILIO_ACCOUNT_SID;
    const authToken = config.TWILIO_AUTH_TOKEN;
    const fromNumber = config.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      return { success: false, channel: 'sms', error: 'Twilio not configured' };
    }

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

      const body = new URLSearchParams({
        To: phone,
        From: fromNumber,
        Body: message,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          channel: 'sms',
          error: `Twilio API error ${response.status}: ${errorBody}`,
        };
      }

      const data = await response.json();
      const sid = data.sid as string;

      await this.trackMessageSid(sid);

      return { success: true, channel: 'sms', messageId: sid };
    } catch (err) {
      return {
        success: false,
        channel: 'sms',
        error: err instanceof Error ? err.message : 'Unknown SMS error',
      };
    }
  }

  /**
   * Send a WhatsApp message via Baileys (direct WhatsApp Web connection).
   *
   * No Twilio, no Meta business verification — just a regular WhatsApp
   * account linked by scanning a QR code from the dashboard. Messages
   * leave no server-side logs to scrub (unlike Twilio).
   */
  private async sendWhatsApp(phone: string, message: string): Promise<SendResult> {
    if (!whatsappPool.isPrimaryConnected()) {
      return { success: false, channel: 'whatsapp', error: 'WhatsApp not connected — pair from Settings' };
    }

    const result = await whatsappPool.sendMessage(phone, message);

    if (result.success) {
      return { success: true, channel: 'whatsapp', messageId: result.messageId };
    }

    return {
      success: false,
      channel: 'whatsapp',
      error: result.error ?? 'Unknown WhatsApp error',
    };
  }

  /**
   * Send a Signal message via the signal-cli REST API.
   */
  private async sendSignal(phone: string, message: string): Promise<SendResult> {
    const signalUrl = config.SIGNAL_CLI_URL;
    const senderNumber = config.SIGNAL_PHONE_NUMBER;

    if (!signalUrl || !senderNumber) {
      return { success: false, channel: 'signal', error: 'Signal not configured' };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${signalUrl}/v2/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          number: senderNumber,
          recipients: [phone],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          channel: 'signal',
          error: `Signal API error ${response.status}: ${errorBody}`,
        };
      }

      return { success: true, channel: 'signal' };
    } catch (err) {
      const message_ = err instanceof Error ? err.message : 'Unknown Signal error';
      return {
        success: false,
        channel: 'signal',
        error: message_.includes('abort') ? 'Signal request timed out' : message_,
      };
    }
  }
}

export const notificationService = new NotificationService();
