import { eq, and, sql, desc, ilike, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  referralProviders,
  referralVouches,
  referralLookups,
  adminUsers,
} from '../db/schema.js';
import { config } from '../config.js';
import { encryptField, decryptField, hmacField } from '../db/encryption.js';

export class ReferralService {
  // ========== Provider CRUD ==========

  /** Create a new referral provider with encrypted PII */
  async createProvider(adminId: string, data: {
    category: string;
    name: string;
    businessName?: string;
    phone?: string;
    email?: string;
    address?: string;
    neighborhoods?: string[];
    lat?: number;
    lng?: number;
    languages?: string[];
    lowBono?: boolean;
    slidingScale?: boolean;
    acceptsUninsured?: boolean;
    specialties?: string[];
    notes?: string;
  }) {
    const result = await db
      .insert(referralProviders)
      .values({
        category: data.category,
        nameEnc: sql`pgp_sym_encrypt(${data.name}, ${config.DEK})`,
        nameHash: sql`encode(hmac(${data.name}, ${config.HMAC_KEY}, 'sha256'), 'hex')`,
        businessNameEnc: data.businessName
          ? sql`pgp_sym_encrypt(${data.businessName}, ${config.DEK})`
          : null,
        phoneEnc: data.phone
          ? sql`pgp_sym_encrypt(${data.phone}, ${config.DEK})`
          : null,
        phoneHash: data.phone
          ? sql`encode(hmac(${data.phone}, ${config.HMAC_KEY}, 'sha256'), 'hex')`
          : null,
        emailEnc: data.email
          ? sql`pgp_sym_encrypt(${data.email}, ${config.DEK})`
          : null,
        addressEnc: data.address
          ? sql`pgp_sym_encrypt(${data.address}, ${config.DEK})`
          : null,
        neighborhoods: data.neighborhoods ?? [],
        lat: data.lat?.toString() ?? null,
        lng: data.lng?.toString() ?? null,
        languages: data.languages ?? ['en'],
        lowBono: data.lowBono ?? false,
        slidingScale: data.slidingScale ?? false,
        acceptsUninsured: data.acceptsUninsured ?? false,
        specialties: data.specialties ?? [],
        notes: data.notes ?? null,
        status: 'under_review',
        createdBy: adminId,
      })
      .returning({
        id: referralProviders.id,
        category: referralProviders.category,
        status: referralProviders.status,
        createdAt: referralProviders.createdAt,
      });

    // Auto-vouch by the creator
    if (result[0]) {
      await this.addVouch(result[0].id, adminId, 'personally_used');
    }

    return result[0];
  }

  /** Get a provider with decrypted fields */
  async getProvider(providerId: string) {
    const rows = await db
      .select({
        id: referralProviders.id,
        category: referralProviders.category,
        name: decryptField(referralProviders.nameEnc, config.DEK),
        businessName: decryptField(referralProviders.businessNameEnc, config.DEK),
        phone: decryptField(referralProviders.phoneEnc, config.DEK),
        email: decryptField(referralProviders.emailEnc, config.DEK),
        address: decryptField(referralProviders.addressEnc, config.DEK),
        neighborhoods: referralProviders.neighborhoods,
        lat: referralProviders.lat,
        lng: referralProviders.lng,
        languages: referralProviders.languages,
        lowBono: referralProviders.lowBono,
        slidingScale: referralProviders.slidingScale,
        acceptsUninsured: referralProviders.acceptsUninsured,
        specialties: referralProviders.specialties,
        notes: referralProviders.notes,
        status: referralProviders.status,
        createdBy: referralProviders.createdBy,
        createdAt: referralProviders.createdAt,
        updatedAt: referralProviders.updatedAt,
      })
      .from(referralProviders)
      .where(eq(referralProviders.id, providerId));

    if (!rows[0]) return null;

    // Get vouches
    const vouches = await this.getVouches(providerId);

    return {
      ...rows[0],
      vouchCount: vouches.length,
      vouches,
    };
  }

  /** Update a provider */
  async updateProvider(providerId: string, data: {
    category?: string;
    name?: string;
    businessName?: string;
    phone?: string;
    email?: string;
    address?: string;
    neighborhoods?: string[];
    lat?: number;
    lng?: number;
    languages?: string[];
    lowBono?: boolean;
    slidingScale?: boolean;
    acceptsUninsured?: boolean;
    specialties?: string[];
    notes?: string;
    status?: string;
  }) {
    const updates: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (data.category !== undefined) updates.category = data.category;
    if (data.neighborhoods !== undefined) updates.neighborhoods = data.neighborhoods;
    if (data.lat !== undefined) updates.lat = data.lat.toString();
    if (data.lng !== undefined) updates.lng = data.lng.toString();
    if (data.languages !== undefined) updates.languages = data.languages;
    if (data.lowBono !== undefined) updates.lowBono = data.lowBono;
    if (data.slidingScale !== undefined) updates.slidingScale = data.slidingScale;
    if (data.acceptsUninsured !== undefined) updates.acceptsUninsured = data.acceptsUninsured;
    if (data.specialties !== undefined) updates.specialties = data.specialties;
    if (data.notes !== undefined) updates.notes = data.notes;
    if (data.status !== undefined) updates.status = data.status;

    // Encrypted fields need raw SQL
    if (data.name !== undefined) {
      updates.nameEnc = sql`pgp_sym_encrypt(${data.name}, ${config.DEK})`;
      updates.nameHash = sql`encode(hmac(${data.name}, ${config.HMAC_KEY}, 'sha256'), 'hex')`;
    }
    if (data.businessName !== undefined) {
      updates.businessNameEnc = sql`pgp_sym_encrypt(${data.businessName}, ${config.DEK})`;
    }
    if (data.phone !== undefined) {
      updates.phoneEnc = sql`pgp_sym_encrypt(${data.phone}, ${config.DEK})`;
      updates.phoneHash = sql`encode(hmac(${data.phone}, ${config.HMAC_KEY}, 'sha256'), 'hex')`;
    }
    if (data.email !== undefined) {
      updates.emailEnc = sql`pgp_sym_encrypt(${data.email}, ${config.DEK})`;
    }
    if (data.address !== undefined) {
      updates.addressEnc = sql`pgp_sym_encrypt(${data.address}, ${config.DEK})`;
    }

    const result = await db
      .update(referralProviders)
      .set(updates)
      .where(eq(referralProviders.id, providerId))
      .returning({ id: referralProviders.id });

    return result[0] ?? null;
  }

  // ========== Search ==========

  /** Search the referral directory — the core feature that replaces Signal group chatter */
  async search(adminId: string, opts: {
    query?: string;
    category?: string;
    neighborhood?: string;
    lowBono?: boolean;
    languages?: string[];
  }) {
    // Build conditions
    const conditions = [
      eq(referralProviders.status, 'active'),
    ];

    if (opts.category) {
      conditions.push(eq(referralProviders.category, opts.category));
    }

    // Get all matching providers with decrypted fields
    let rows = await db
      .select({
        id: referralProviders.id,
        category: referralProviders.category,
        name: decryptField(referralProviders.nameEnc, config.DEK),
        businessName: decryptField(referralProviders.businessNameEnc, config.DEK),
        phone: decryptField(referralProviders.phoneEnc, config.DEK),
        email: decryptField(referralProviders.emailEnc, config.DEK),
        address: decryptField(referralProviders.addressEnc, config.DEK),
        neighborhoods: referralProviders.neighborhoods,
        lat: referralProviders.lat,
        lng: referralProviders.lng,
        languages: referralProviders.languages,
        lowBono: referralProviders.lowBono,
        slidingScale: referralProviders.slidingScale,
        acceptsUninsured: referralProviders.acceptsUninsured,
        specialties: referralProviders.specialties,
        notes: referralProviders.notes,
        status: referralProviders.status,
        createdBy: referralProviders.createdBy,
        createdAt: referralProviders.createdAt,
        updatedAt: referralProviders.updatedAt,
      })
      .from(referralProviders)
      .where(and(...conditions))
      .orderBy(desc(referralProviders.createdAt));

    // Post-query filtering (for fields that need decryption or array matching)
    if (opts.neighborhood) {
      const needle = opts.neighborhood.toLowerCase();
      rows = rows.filter(r =>
        (r.neighborhoods as string[] | null)?.some(n => n.toLowerCase().includes(needle)),
      );
    }

    if (opts.lowBono) {
      rows = rows.filter(r => r.lowBono);
    }

    if (opts.languages && opts.languages.length > 0) {
      rows = rows.filter(r =>
        opts.languages!.some(lang => (r.languages as string[] | null)?.includes(lang)),
      );
    }

    if (opts.query) {
      const needle = opts.query.toLowerCase();
      rows = rows.filter(r =>
        (r.name as string)?.toLowerCase().includes(needle) ||
        (r.businessName as string)?.toLowerCase().includes(needle) ||
        (r.specialties as string[] | null)?.some(s => s.toLowerCase().includes(needle)) ||
        (r.notes as string)?.toLowerCase().includes(needle),
      );
    }

    // Get vouch counts for results
    const providerIds = rows.map(r => r.id);
    const vouchCounts = new Map<string, number>();

    if (providerIds.length > 0) {
      const vouchRows = await db
        .select({
          providerId: referralVouches.providerId,
          count: sql<number>`count(*)::int`,
        })
        .from(referralVouches)
        .where(inArray(referralVouches.providerId, providerIds))
        .groupBy(referralVouches.providerId);

      for (const v of vouchRows) {
        vouchCounts.set(v.providerId, v.count);
      }
    }

    // Log the lookup
    await db.insert(referralLookups).values({
      adminId,
      query: opts.query ?? null,
      category: opts.category ?? null,
      neighborhood: opts.neighborhood ?? null,
      resultCount: rows.length,
    });

    // Score by vouches (personally_used weighted highest)
    return rows
      .map(r => ({
        ...r,
        vouchCount: vouchCounts.get(r.id) ?? 0,
      }))
      .sort((a, b) => b.vouchCount - a.vouchCount);
  }

  /** List all providers (admin view, not filtered by active status) */
  async listProviders(opts?: { category?: string; status?: string }) {
    const conditions = [];
    if (opts?.category) conditions.push(eq(referralProviders.category, opts.category));
    if (opts?.status) conditions.push(eq(referralProviders.status, opts.status));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        id: referralProviders.id,
        category: referralProviders.category,
        name: decryptField(referralProviders.nameEnc, config.DEK),
        businessName: decryptField(referralProviders.businessNameEnc, config.DEK),
        neighborhoods: referralProviders.neighborhoods,
        languages: referralProviders.languages,
        lowBono: referralProviders.lowBono,
        slidingScale: referralProviders.slidingScale,
        acceptsUninsured: referralProviders.acceptsUninsured,
        specialties: referralProviders.specialties,
        status: referralProviders.status,
        createdAt: referralProviders.createdAt,
      })
      .from(referralProviders)
      .where(where)
      .orderBy(desc(referralProviders.createdAt));

    // Attach vouch counts
    const providerIds = rows.map(r => r.id);
    const vouchCounts = new Map<string, number>();

    if (providerIds.length > 0) {
      const vouchRows = await db
        .select({
          providerId: referralVouches.providerId,
          count: sql<number>`count(*)::int`,
        })
        .from(referralVouches)
        .where(inArray(referralVouches.providerId, providerIds))
        .groupBy(referralVouches.providerId);

      for (const v of vouchRows) {
        vouchCounts.set(v.providerId, v.count);
      }
    }

    return rows.map(r => ({
      ...r,
      vouchCount: vouchCounts.get(r.id) ?? 0,
    }));
  }

  // ========== Vouches ==========

  async addVouch(providerId: string, adminId: string, level?: string, notes?: string) {
    const result = await db
      .insert(referralVouches)
      .values({
        providerId,
        adminId,
        level: level ?? 'community_known',
        notes: notes ?? null,
      })
      .onConflictDoUpdate({
        target: [referralVouches.providerId, referralVouches.adminId],
        set: {
          level: level ?? 'community_known',
          notes: notes ?? null,
        },
      })
      .returning();

    // Auto-activate providers with 2+ vouches
    const vouches = await this.getVouches(providerId);
    if (vouches.length >= 2) {
      await db
        .update(referralProviders)
        .set({ status: 'active' })
        .where(
          and(
            eq(referralProviders.id, providerId),
            eq(referralProviders.status, 'under_review'),
          ),
        );
    }

    return result[0];
  }

  async removeVouch(providerId: string, adminId: string) {
    await db
      .delete(referralVouches)
      .where(
        and(
          eq(referralVouches.providerId, providerId),
          eq(referralVouches.adminId, adminId),
        ),
      );
  }

  async getVouches(providerId: string) {
    return db
      .select({
        id: referralVouches.id,
        providerId: referralVouches.providerId,
        adminId: referralVouches.adminId,
        adminEmail: adminUsers.email,
        level: referralVouches.level,
        notes: referralVouches.notes,
        createdAt: referralVouches.createdAt,
      })
      .from(referralVouches)
      .leftJoin(adminUsers, eq(referralVouches.adminId, adminUsers.id))
      .where(eq(referralVouches.providerId, providerId))
      .orderBy(desc(referralVouches.createdAt));
  }

  // ========== Stats ==========

  async getStats() {
    const allProviders = await db
      .select({
        id: referralProviders.id,
        status: referralProviders.status,
        category: referralProviders.category,
      })
      .from(referralProviders);

    const activeCount = allProviders.filter(p => p.status === 'active').length;
    const reviewCount = allProviders.filter(p => p.status === 'under_review').length;

    // Category breakdown
    const categories = new Map<string, number>();
    for (const p of allProviders.filter(p => p.status === 'active')) {
      categories.set(p.category, (categories.get(p.category) ?? 0) + 1);
    }

    return {
      totalProviders: allProviders.length,
      activeProviders: activeCount,
      underReview: reviewCount,
      categoryBreakdown: Object.fromEntries(categories),
    };
  }
}

export const referralService = new ReferralService();
