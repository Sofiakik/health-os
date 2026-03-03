"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  async function handleLogin() {
    setMessage("");

    // ключ: редиректим обратно на тот домен, откуда открыта страница (/login)
    const redirectTo = `${window.location.origin}/auth/callback`;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
      },
    });

    if (error) setMessage("Error: " + error.message);
    else setMessage("Check your email for the login link.");
  }

  return (
    <main style={{ padding: 24, maxWidth: 520 }}>
      <h1>Login</h1>

      <input
        type="email"
        placeholder="your@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ padding: 10, width: "100%", marginTop: 10 }}
      />

      <button onClick={handleLogin} style={{ padding: 10, marginTop: 12, width: "100%" }}>
        Send magic link
      </button>

      {message && <p style={{ marginTop: 12 }}>{message}</p>}
    </main>
  );
}