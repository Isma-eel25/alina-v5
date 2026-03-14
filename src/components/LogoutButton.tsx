"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const logout = async () => {
    if (loading) return;
    setLoading(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } catch (err) {
      console.error(err);
    }

    router.push("/login");
    router.refresh();
  };

  return (
    <button
      onClick={logout}
      className="text-xs px-3 py-2 border border-white/20 rounded hover:bg-white/10"
    >
      {loading ? "Signing out..." : "Logout"}
    </button>
  );
}