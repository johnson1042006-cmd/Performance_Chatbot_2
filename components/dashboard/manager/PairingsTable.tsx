"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { Plus, Trash2 } from "lucide-react";

interface Pairing {
  id: string;
  primarySku: string;
  pairedSku: string;
  pairingType: string;
  primaryName?: string;
  pairedName?: string;
}

export default function PairingsTable() {
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    primarySku: "",
    pairedSku: "",
    pairingType: "matching_pants",
  });

  const fetchPairings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/pairings");
      const data = await res.json();
      if (data.pairings) setPairings(data.pairings);
    } catch (error) {
      console.error("Failed to fetch pairings:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPairings();
  }, [fetchPairings]);

  const addPairing = async () => {
    try {
      await fetch("/api/admin/pairings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm({ primarySku: "", pairedSku: "", pairingType: "matching_pants" });
      setShowAdd(false);
      fetchPairings();
    } catch (error) {
      console.error("Failed to add pairing:", error);
    }
  };

  const deletePairing = async (id: string) => {
    if (!confirm("Delete this pairing?")) return;
    try {
      await fetch(`/api/admin/pairings?id=${id}`, { method: "DELETE" });
      fetchPairings();
    } catch (error) {
      console.error("Failed to delete pairing:", error);
    }
  };

  const typeLabel = (type: string) => type.replace(/_/g, " ");

  return (
    <Card padding={false}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h3 className="font-semibold text-text-primary">Product Pairings</h3>
        <Button size="sm" onClick={() => setShowAdd(!showAdd)}>
          <Plus size={14} className="mr-1.5" />
          Add Pairing
        </Button>
      </div>

      {showAdd && (
        <div className="px-6 py-4 bg-background border-b border-border">
          <div className="grid grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="Primary SKU"
              value={form.primarySku}
              onChange={(e) =>
                setForm((f) => ({ ...f, primarySku: e.target.value }))
              }
              className="px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <input
              type="text"
              placeholder="Paired SKU"
              value={form.pairedSku}
              onChange={(e) =>
                setForm((f) => ({ ...f, pairedSku: e.target.value }))
              }
              className="px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <select
              value={form.pairingType}
              onChange={(e) =>
                setForm((f) => ({ ...f, pairingType: e.target.value }))
              }
              className="px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              <option value="matching_pants">Matching Pants</option>
              <option value="matching_jacket">Matching Jacket</option>
              <option value="accessory">Accessory</option>
              <option value="frequently_bought">Frequently Bought Together</option>
            </select>
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={addPairing}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background">
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                Primary SKU
              </th>
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                Product Name
              </th>
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                Paired SKU
              </th>
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                Paired Name
              </th>
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                Type
              </th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-text-secondary">
                  Loading...
                </td>
              </tr>
            ) : pairings.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-text-secondary">
                  No pairings configured
                </td>
              </tr>
            ) : (
              pairings.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-border hover:bg-background/50 transition-colors"
                >
                  <td className="px-6 py-3 font-mono text-xs">
                    {p.primarySku}
                  </td>
                  <td className="px-6 py-3">{p.primaryName}</td>
                  <td className="px-6 py-3 font-mono text-xs">
                    {p.pairedSku}
                  </td>
                  <td className="px-6 py-3">{p.pairedName}</td>
                  <td className="px-6 py-3">
                    <Badge variant="info">{typeLabel(p.pairingType)}</Badge>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <button
                      onClick={() => deletePairing(p.id)}
                      className="text-text-secondary hover:text-accent transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
