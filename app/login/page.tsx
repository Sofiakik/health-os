"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "signedup" | "error">("idle");
  const [error, setError] = useState("");

  const signUp = async () => {
    setLoading(true);
    setError("");
    setStatus("idle");

    const { error } = await supabase.auth.signUp({ email, password });

    if (error) {
      setError(error.message);
      setStatus("error");
    } else {
      setStatus("signedup");
    }
    setLoading(false);
  };

  const signIn = async () => {
    setLoading(true);
    setError("");
    setStatus("idle");

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setStatus("error");
      setLoading(false);
      return;
    }

    router.push("/calendar");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") signIn();
  };

  return (
    <div style={{ padding: 24, maxWidth: 420 }}>
      <h2>Login</h2>

      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        type="email"
        style={{ width: "100%", marginBottom: 10 }}
      />

      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        type="password"
        onKeyDown={onKeyDown}
        style={{ width: "100%", marginBottom: 10 }}
      />

      <button onClick={signIn} disabled={loading} style={{ width: "100%", marginBottom: 10 }}>
        Sign in
      </button>

      <button onClick={signUp} disabled={loading} style={{ width: "100%" }}>
        Sign up
      </button>

      {status === "signedup" && (
        <p style={{ marginTop: 10 }}>Account created. If email confirmation is on, confirm via email once.</p>
      )}

      {status === "error" && <p style={{ color: "red", marginTop: 10 }}>{error}</p>}
    </div>
  );
}