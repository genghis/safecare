"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const AddressPickerMap = dynamic(
  () => import("@/components/address-picker-map"),
  { ssr: false }
);
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { apiGet, apiPost } from "@/lib/api";
import { useLocale } from "@/lib/locale";

interface Recipient {
  id: string;
  name: string;
  phone: string;
  address: string;
  verified: boolean;
  communicationPreference: string;
  createdAt: string;
}

export default function RecipientsPage() {
  const { t } = useLocale();
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Zones for map overlay
  const [zones, setZones] = useState<any[]>([]);

  // Org settings for default map center
  const [defaultCenter, setDefaultCenter] = useState<
    { lat: number; lng: number; zoom: number } | undefined
  >(undefined);

  // Add modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addAddress, setAddAddress] = useState("");
  const [addLat, setAddLat] = useState<number | null>(null);
  const [addLng, setAddLng] = useState<number | null>(null);
  const [addCommPref, setAddCommPref] = useState("sms");
  const [addLanguage, setAddLanguage] = useState("en");
  const [addSaving, setAddSaving] = useState(false);

  useEffect(() => {
    async function fetchData() {
      const [recipientsRes, zonesRes, settingsRes] = await Promise.all([
        apiGet<Recipient[]>("/api/recipients"),
        apiGet<any[]>("/api/zones"),
        apiGet<any>("/api/settings"),
      ]);
      if (recipientsRes.ok && Array.isArray(recipientsRes.data)) {
        setRecipients(recipientsRes.data);
      }
      if (zonesRes.ok && Array.isArray(zonesRes.data)) {
        setZones(zonesRes.data);
      }
      if (settingsRes.ok && settingsRes.data?.serviceArea) {
        const sa = settingsRes.data.serviceArea;
        setDefaultCenter({ lat: sa.lat, lng: sa.lng, zoom: sa.zoom });
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  const filtered = recipients.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.phone.includes(search) ||
      r.address.toLowerCase().includes(search.toLowerCase())
  );

  function openAddModal() {
    setAddName("");
    setAddPhone("");
    setAddAddress("");
    setAddLat(null);
    setAddLng(null);
    setAddCommPref("sms");
    setAddLanguage("en");
    setShowAddModal(true);
  }

  function closeAddModal() {
    setShowAddModal(false);
  }

  async function handleAddRecipient() {
    if (!addName || !addPhone || !addAddress) return;
    setAddSaving(true);

    const res = await apiPost<{ id: string }>(
      "/api/recipients",
      {
        name: addName,
        phone: addPhone,
        address: addAddress,
        lat: addLat,
        lng: addLng,
        communicationPreference: addCommPref,
        language: addLanguage,
      }
    );

    if (res.ok) {
      const newRecipient: Recipient = {
        id: (res.data as any)?.id ?? "",
        name: addName,
        phone: addPhone,
        address: addAddress,
        verified: false,
        communicationPreference: addCommPref,
        createdAt: new Date().toISOString(),
      };
      setRecipients((prev) => [...prev, newRecipient]);
      closeAddModal();
    } else {
      alert(res.error || t('dashboard.recipients.addFailed'));
    }
    setAddSaving(false);
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('dashboard.recipients.title')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('dashboard.recipients.subtitle')}
          </p>
        </div>
        <Button onClick={openAddModal}>{t('dashboard.recipients.addRecipient')}</Button>
      </div>

      <div className="mb-4">
        <Input
          placeholder={t('dashboard.recipients.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('dashboard.recipients.colName')}</TableHead>
              <TableHead>{t('dashboard.recipients.colPhone')}</TableHead>
              <TableHead>{t('dashboard.recipients.colAddress')}</TableHead>
              <TableHead>{t('dashboard.recipients.colStatus')}</TableHead>
              <TableHead>{t('dashboard.recipients.colCommunication')}</TableHead>
              <TableHead>{t('dashboard.recipients.colAdded')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  {t('dashboard.recipients.loadingRecipients')}
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  {search ? t('dashboard.recipients.noMatch') : t('dashboard.recipients.noRecipients')}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((recipient) => (
                <TableRow key={recipient.id}>
                  <TableCell className="font-medium">{recipient.name}</TableCell>
                  <TableCell>{recipient.phone}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{recipient.address}</TableCell>
                  <TableCell>
                    <StatusBadge status={recipient.verified ? "verified" : "unverified"} />
                  </TableCell>
                  <TableCell>{recipient.communicationPreference === "sms" ? "SMS" : recipient.communicationPreference === "signal" ? "Signal" : recipient.communicationPreference === "whatsapp" ? "WhatsApp" : recipient.communicationPreference}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(recipient.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add Recipient modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-y-auto py-8"
        >
          <div
            className="w-full max-w-2xl rounded-lg border bg-card p-6 shadow-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-4">{t('dashboard.recipients.addRecipient')}</h2>
            <div className="space-y-4">
              {/* Name + Phone row */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">{t('dashboard.common.name')} {t('dashboard.common.required')}</label>
                  <Input
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder={t('dashboard.common.placeholderFullName')}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">{t('dashboard.common.phone')} {t('dashboard.common.required')}</label>
                  <Input
                    value={addPhone}
                    onChange={(e) => setAddPhone(e.target.value)}
                    placeholder={t('dashboard.common.placeholderPhone')}
                  />
                </div>
              </div>

              {/* Address + Map */}
              <div className="space-y-1">
                <label className="text-sm font-medium">{t('dashboard.recipients.deliveryLocation')} {t('dashboard.common.required')}</label>
                <AddressPickerMap
                  lat={addLat}
                  lng={addLng}
                  address={addAddress}
                  onLocationChange={(lat, lng, address) => {
                    setAddLat(lat);
                    setAddLng(lng);
                    setAddAddress(address);
                  }}
                  onAddressChange={setAddAddress}
                  zones={zones}
                  defaultCenter={defaultCenter}
                />
                <div className="mt-2">
                  <label className="text-xs text-muted-foreground">
                    {t('dashboard.recipients.addressAutoFilled')}
                  </label>
                  <Input
                    value={addAddress}
                    onChange={(e) => setAddAddress(e.target.value)}
                    placeholder={t('dashboard.recipients.addressMapPlaceholder')}
                    className="mt-1"
                  />
                </div>
              </div>

              {/* Communication + Language row */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">{t('dashboard.recipients.notificationChannel')}</label>
                  <select
                    value={addCommPref}
                    onChange={(e) => setAddCommPref(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="sms">SMS</option>
                    <option value="signal">Signal</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">{t('dashboard.recipients.language')}</label>
                  <select
                    value={addLanguage}
                    onChange={(e) => setAddLanguage(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="en">English</option>
                    <option value="es">Español</option>
                    <option value="ar">العربية (Arabic)</option>
                    <option value="so">Soomaali (Somali)</option>
                    <option value="fr">Français (French)</option>
                    <option value="zh">中文 (Chinese)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={closeAddModal}>
                {t('dashboard.common.cancel')}
              </Button>
              <Button
                onClick={handleAddRecipient}
                disabled={addSaving || !addName || !addPhone || !addAddress}
              >
                {addSaving ? t('dashboard.common.adding') : t('dashboard.recipients.addRecipient')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
