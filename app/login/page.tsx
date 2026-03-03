"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Status = "idle" | "signedup" | "reset_sent" | "error";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const signUp = async () => {
    setLoading(true);
    setStatus("idle");
    setMessage("");

    const { error } = await supabase.auth.signUp({ email, password });

    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("signedup");
      setMessage(
        "Account created. If email confirmation is on, confirm via email once."
      );
    }
    setLoading(false);
  };

  const signIn = async () => {
    setLoading(true);
    setStatus("idle");
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setStatus("error");
      setMessage(error.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    router.push("/calendar");
  };

  const resetPassword = async () => {
    setLoading(true);
    setStatus("idle");
    setMessage("");

    if (!email.trim()) {
      setStatus("error");
      setMessage("Enter your email first, then click Forgot password.");
      setLoading(false);
      return;
    }

    const redirectTo = `${window.location.origin}/update-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("reset_sent");
      setMessage("Password reset email sent. Open it on the same device/browser.");
    }

    setLoading(false);
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
        autoComplete="email"
        style={{ width: "100%", marginBottom: 10 }}
      />

      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        type="password"
        autoComplete="current-password"
        onKeyDown={onKeyDown}
        style={{ width: "100%", marginBottom: 10 }}
      />

      <button
        onClick={signIn}
        disabled={loading}
        style={{ width: "100%", marginBottom: 10 }}
      >
        Sign in
      </button>

      <button
        onClick={signUp}
        disabled={loading}
        style={{ width: "100%", marginBottom: 10 }}
      >
        Sign up
      </button>

      <button
        onClick={resetPassword}
        disabled={loading}
        style={{ width: "100%" }}
      >
        Forgot password
      </button>

      {status !== "idle" && (
        <p style={{ marginTop: 10, color: status === "error" ? "red" : "black" }}>
          {message}
        </p>
      )}
    </div>
  );
}