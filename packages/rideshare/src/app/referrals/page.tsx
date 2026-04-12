"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost } from "@/lib/api";
import { REFERRAL_CATEGORIES, VOUCH_LEVELS } from "@safecare/shared";

interface Provider {
  id: string;
  category: string;
  name: string;
  businessName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  neighborhoods: string[];
  languages: string[];
  lowBono: boolean;
  slidingScale: boolean;
  acceptsUninsured: boolean;
  specialties: string[];
  notes: string | null;
  status: string;
  vouchCount: number;
  createdAt: string;
}

interface NewProviderForm {
  category: string;
  name: string;
  businessName: string;
  phone: string;
  email: string;
  address: string;
  neighborhoods: string;
  languages: string;
  specialties: string;
  lowBono: boolean;
  slidingScale: boolean;
  acceptsUninsured: boolean;
  notes: string;
}

const emptyForm: NewProviderForm = {
  category: "medical",
  name: "",
  businessName: "",
  phone: "",
  email: "",
  address: "",
  neighborhoods: "",
  languages: "en",
  specialties: "",
  lowBono: false,
  slidingScale: false,
  acceptsUninsured: false,
  notes: "",
};

export default function ReferralsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [neighborhoodFilter, setNeighborhoodFilter] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<NewProviderForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchProviders = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (searchQuery) params.set("query", searchQuery);
    if (categoryFilter) params.set("category", categoryFilter);
    if (neighborhoodFilter) params.set("neighborhood", neighborhoodFilter);

    const url = searchQuery || categoryFilter || neighborhoodFilter
      ? `/api/referrals/search?${params}`
      : "/api/referrals/providers";

    const res = await apiGet<Provider[]>(url);
    if (res.ok) setProviders(res.data);
    setLoading(false);
  };

  useEffect(() => {
    fetchProviders();
  }, [categoryFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchProviders();
  };

  const handleVouch = async (providerId: string) => {
    await apiPost(`/api/referrals/providers/${providerId}/vouch`, {
      level: "trusted_referral",
    });
    fetchProviders();
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await apiPost("/api/referrals/providers", {
      ...form,
      neighborhoods: form.neighborhoods.split(",").map(s => s.trim()).filter(Boolean),
      languages: form.languages.split(",").map(s => s.trim()).filter(Boolean),
      specialties: form.specialties.split(",").map(s => s.trim()).filter(Boolean),
    });
    setSaving(false);
    setShowAddForm(false);
    setForm(emptyForm);
    fetchProviders();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Referral Directory</h1>
          <p className="text-muted-foreground mt-1">
            Vetted service providers — search here instead of asking in Signal chats.
          </p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? "Cancel" : "Add Provider"}
        </Button>
      </div>

      {showAddForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Add a Vetted Provider</CardTitle>
            <CardDescription>
              Adding a provider automatically counts as your vouch. Providers need 2+ vouches to become active.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAdd} className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {Object.entries(REFERRAL_CATEGORIES).map(([key, val]) => (
                    <option key={key} value={key}>{val.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Contact Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Business Name</label>
                <Input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Phone</label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Email</label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Address</label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Neighborhoods (comma-separated)</label>
                <Input value={form.neighborhoods} onChange={(e) => setForm({ ...form, neighborhoods: e.target.value })} placeholder="Phillips, Seward, Powderhorn" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Languages (comma-separated)</label>
                <Input value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })} placeholder="en, es, so" />
              </div>
              <div className="col-span-2">
                <label className="text-sm font-medium mb-1 block">Specialties (comma-separated)</label>
                <Input value={form.specialties} onChange={(e) => setForm({ ...form, specialties: e.target.value })} placeholder="family law, immigration, low-bono" />
              </div>
              <div className="col-span-2 flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.lowBono} onChange={(e) => setForm({ ...form, lowBono: e.target.checked })} className="rounded" />
                  Low-bono / Free
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.slidingScale} onChange={(e) => setForm({ ...form, slidingScale: e.target.checked })} className="rounded" />
                  Sliding scale
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.acceptsUninsured} onChange={(e) => setForm({ ...form, acceptsUninsured: e.target.checked })} className="rounded" />
                  Accepts uninsured
                </label>
              </div>
              <div className="col-span-2">
                <label className="text-sm font-medium mb-1 block">Notes</label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any additional context for other coordinators..." />
              </div>
              <div className="col-span-2">
                <Button type="submit" disabled={saving || !form.name}>
                  {saving ? "Saving..." : "Add Provider & Vouch"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Search & Filter */}
      <div className="flex items-center gap-4 mb-6">
        <form onSubmit={handleSearch} className="flex-1 flex gap-2">
          <Input
            placeholder="Search providers, specialties, notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1"
          />
          <Input
            placeholder="Neighborhood"
            value={neighborhoodFilter}
            onChange={(e) => setNeighborhoodFilter(e.target.value)}
            className="w-48"
          />
          <Button type="submit" variant="outline">Search</Button>
        </form>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">All categories</option>
          {Object.entries(REFERRAL_CATEGORIES).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>
      </div>

      {/* Results */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : providers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No providers found. Try a different search or add one.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => (
            <Card key={p.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline">
                        {REFERRAL_CATEGORIES[p.category]?.label ?? p.category}
                      </Badge>
                      <span className="font-semibold">{p.name}</span>
                      {p.businessName && (
                        <span className="text-muted-foreground">- {p.businessName}</span>
                      )}
                      <Badge variant={p.status === "active" ? "success" : p.status === "under_review" ? "warning" : "secondary"}>
                        {p.status.replace("_", " ")}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mt-1">
                      {p.phone && <span>{p.phone}</span>}
                      {p.email && <span>{p.email}</span>}
                      {p.neighborhoods?.length > 0 && (
                        <span>{p.neighborhoods.join(", ")}</span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1 mt-2">
                      {p.lowBono && <Badge variant="success" className="text-xs">Low-bono</Badge>}
                      {p.slidingScale && <Badge variant="secondary" className="text-xs">Sliding scale</Badge>}
                      {p.acceptsUninsured && <Badge variant="secondary" className="text-xs">Accepts uninsured</Badge>}
                      {p.specialties?.map((s) => (
                        <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                      ))}
                      {p.languages?.filter(l => l !== "en").map((l) => (
                        <Badge key={l} variant="outline" className="text-xs">{l.toUpperCase()}</Badge>
                      ))}
                    </div>

                    {p.notes && (
                      <p className="text-sm text-muted-foreground mt-2">{p.notes}</p>
                    )}
                  </div>

                  <div className="flex flex-col items-center gap-1 ml-4">
                    <div className="text-2xl font-bold">{p.vouchCount}</div>
                    <div className="text-xs text-muted-foreground">vouches</div>
                    <Button size="sm" variant="outline" onClick={() => handleVouch(p.id)} className="mt-1">
                      +1 Vouch
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
