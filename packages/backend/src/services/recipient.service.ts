import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { recipients } from '../db/schema.js';
import { encryptField, decryptField, hmacField } from '../db/encryption.js';
import { config } from '../config.js';

export interface CreateRecipientInput {
  name: string;
  address: string;
  phone: string;
  lat?: number;
  lng?: number;
  communicationPreference?: string;
  whatsappConsent?: boolean;
}

export class RecipientService {
  /**
   * Create a new recipient with encrypted PII fields.
   */
  async create(data: CreateRecipientInput): Promise<string> {
    const result = await db
      .insert(recipients)
      .values({
        nameEnc: sql`pgp_sym_encrypt(${data.name}, ${config.DEK})`,
        nameHash: sql`encode(hmac(${data.name}, ${config.HMAC_KEY}, 'sha256'), 'hex')`,
        addressEnc: sql`pgp_sym_encrypt(${data.address}, ${config.DEK})`,
        phoneEnc: sql`pgp_sym_encrypt(${data.phone}, ${config.DEK})`,
        phoneHash: sql`encode(hmac(${data.phone}, ${config.HMAC_KEY}, 'sha256'), 'hex')`,
        lat: data.lat?.toString(),
        lng: data.lng?.toString(),
        communicationPreference: data.communicationPreference ?? 'sms',
        whatsappConsent: data.whatsappConsent ?? false,
      } as any)
      .returning({ id: recipients.id });

    return result[0].id;
  }

  /**
   * Find a recipient by phone number using HMAC hash lookup.
   */
  async findByPhone(phone: string) {
    const rows = await db
      .select({
        id: recipients.id,
        name: sql<string>`pgp_sym_decrypt(${recipients.nameEnc}::bytea, ${config.DEK})`,
        address: sql<string>`pgp_sym_decrypt(${recipients.addressEnc}::bytea, ${config.DEK})`,
        phone: sql<string>`pgp_sym_decrypt(${recipients.phoneEnc}::bytea, ${config.DEK})`,
        lat: recipients.lat,
        lng: recipients.lng,
        communicationPreference: recipients.communicationPreference,
        whatsappConsent: recipients.whatsappConsent,
        verified: recipients.verified,
        createdAt: recipients.createdAt,
      })
      .from(recipients)
      .where(
        eq(
          recipients.phoneHash,
          sql`encode(hmac(${phone}, ${config.HMAC_KEY}, 'sha256'), 'hex')`,
        ),
      );

    return rows[0] ?? null;
  }

  /**
   * Find a recipient by id, decrypting PII fields.
   */
  async findById(id: string) {
    const rows = await db
      .select({
        id: recipients.id,
        name: sql<string>`pgp_sym_decrypt(${recipients.nameEnc}::bytea, ${config.DEK})`,
        address: sql<string>`pgp_sym_decrypt(${recipients.addressEnc}::bytea, ${config.DEK})`,
        phone: sql<string>`pgp_sym_decrypt(${recipients.phoneEnc}::bytea, ${config.DEK})`,
        lat: recipients.lat,
        lng: recipients.lng,
        communicationPreference: recipients.communicationPreference,
        whatsappConsent: recipients.whatsappConsent,
        verified: recipients.verified,
        createdAt: recipients.createdAt,
      })
      .from(recipients)
      .where(eq(recipients.id, id));

    return rows[0] ?? null;
  }

  /**
   * List all recipients, decrypting PII fields.
   */
  async list() {
    return db
      .select({
        id: recipients.id,
        name: sql<string>`pgp_sym_decrypt(${recipients.nameEnc}::bytea, ${config.DEK})`,
        address: sql<string>`pgp_sym_decrypt(${recipients.addressEnc}::bytea, ${config.DEK})`,
        phone: sql<string>`pgp_sym_decrypt(${recipients.phoneEnc}::bytea, ${config.DEK})`,
        lat: recipients.lat,
        lng: recipients.lng,
        communicationPreference: recipients.communicationPreference,
        whatsappConsent: recipients.whatsappConsent,
        verified: recipients.verified,
        createdAt: recipients.createdAt,
      })
      .from(recipients);
  }

  /**
   * Check whether a phone number exists and is verified.
   */
  async verifyPhone(phone: string): Promise<boolean> {
    const rows = await db
      .select({ verified: recipients.verified })
      .from(recipients)
      .where(
        eq(
          recipients.phoneHash,
          sql`encode(hmac(${phone}, ${config.HMAC_KEY}, 'sha256'), 'hex')`,
        ),
      );

    return rows.length > 0 && rows[0].verified === true;
  }
}

export const recipientService = new RecipientService();
