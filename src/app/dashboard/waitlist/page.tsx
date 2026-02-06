"use client";

import { useEffect, useState } from "react";

type WaitlistEntry = {
  id: string;
  email: string;
  name: string | null;
  note: string | null;
  source: string | null;
  createdAt: string;
};

export default function WaitlistDashboard() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/waitlist");
        const data = await res.json();
        setEntries(data);
      } catch (err) {
        console.error("Failed to load waitlist:", err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <h1 className="text-3xl font-bold mb-4">Alina Waitlist</h1>

      {loading && <p>Loading...</p>}

      {!loading && entries.length === 0 && (
        <p>No one has signed up yet.</p>
      )}

      {!loading && entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full border border-slate-800">
            <thead>
              <tr className="bg-slate-900">
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Source</th>
                <th className="px-4 py-2 text-left">Note</th>
                <th className="px-4 py-2 text-left">Date</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-slate-800">
                  <td className="px-4 py-2">{e.email}</td>
                  <td className="px-4 py-2">{e.name || "—"}</td>
                  <td className="px-4 py-2">{e.source || "—"}</td>
                  <td className="px-4 py-2">{e.note || "—"}</td>
                  <td className="px-4 py-2">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
