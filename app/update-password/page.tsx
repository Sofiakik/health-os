"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    // If user is not in a recovery session, bounce to login
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
    });
  }, [router]);

  const save = async () => {
    setMsg("");
    if (pw1.length < 6) return setMsg("Password must be at least 6 characters.");
    if (pw1 !== pw2) return setMsg("Passwords do not match.");

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setLoading(false);

    if (error) return setMsg(error.message);

    setMsg("Password updated. Redirecting…");
    router.replace("/calendar");
  };

  return (
    <div style={{ padding: 24, maxWidth: 420 }}>
      <h2>Set new password</h2>

      <input
        value={pw1}
        onChange={(e) => setPw1(e.target.value)}
        placeholder="New password"
        type="password"
        style={{ width: "100%", marginBottom: 10 }}
      />

      <input
        value={pw2}
        onChange={(e) => setPw2(e.target.value)}
        placeholder="Repeat new password"
        type="password"
        style={{ width: "100%", marginBottom: 10 }}
      />

      <button onClick={save} disabled={loading} style={{ width: "100%" }}>
        Save new password
      </button>

      {msg && <p style={{ marginTop: 10 }}>{msg}</p>}
    </div>
  );
}