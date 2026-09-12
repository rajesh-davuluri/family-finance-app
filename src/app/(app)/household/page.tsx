"use client";

import { useEffect, useState } from "react";

type Member = { id: string; name: string; email: string; role: string; mfaEnabled: boolean };
type Household = { id: string; name: string; inviteCode: string; users: Member[] };

export default function HouseholdPage() {
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/household")
      .then((r) => r.json())
      .then((data) => {
        setHousehold(data);
        setLoading(false);
      });
  }, []);

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;
  if (!household) return <p className="text-sm text-red-600">Couldn't load household info.</p>;

  function copyCode() {
    navigator.clipboard.writeText(household!.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{household.name}</h1>

      <div className="rounded-lg border bg-white p-4">
        <h2 className="mb-1 text-sm font-medium text-gray-700">Invite code</h2>
        <p className="mb-3 text-sm text-gray-500">
          Share this with family members so they can join your household during signup ("Join household" tab).
        </p>
        <div className="flex items-center gap-2">
          <code className="rounded bg-gray-100 px-3 py-1.5 text-sm">{household.inviteCode}</code>
          <button onClick={copyCode} className="text-sm text-brand-600 hover:underline">
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <h2 className="mb-3 text-sm font-medium text-gray-700">Members</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="pb-2">Name</th>
              <th className="pb-2">Email</th>
              <th className="pb-2">Role</th>
              <th className="pb-2">MFA</th>
            </tr>
          </thead>
          <tbody>
            {household.users.map((u) => (
              <tr key={u.id} className="border-b last:border-0">
                <td className="py-2">{u.name}</td>
                <td className="py-2 text-gray-500">{u.email}</td>
                <td className="py-2">{u.role === "ADMIN" ? "Admin" : "Member"}</td>
                <td className="py-2">{u.mfaEnabled ? "Enabled" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
