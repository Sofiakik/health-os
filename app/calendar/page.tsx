"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Entry = {
  id: string;
  date: string;
  note: string | null;
  image_url: string | null;
  created_at: string;
};

const BUCKET = "entry-images";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function SignedImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 3600);

      setUrl(data?.signedUrl ?? null);
    };

    load();
  }, [path]);

  if (!url) return null;

  return (
    <img
      src={url}
      alt="entry"
      style={{ maxWidth: "100%", borderRadius: 8 }}
    />
  );
}

export default function CalendarPage() {
  const router = useRouter();

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [userId, setUserId] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState(today());

  const [entries, setEntries] = useState<Entry[]>([]);

  const [note, setNote] = useState("");

  const [file, setFile] = useState<File | null>(null);

  const [insight, setInsight] = useState<any>(null);

  const [question, setQuestion] = useState("");

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();

      const uid = data.session?.user?.id;

      if (!uid) {
        router.replace("/login");
        return;
      }

      setUserId(uid);
    };

    init();
  }, [router]);

  const fetchEntries = async (uid: string, date: string) => {
    const { data } = await supabase
      .from("entries")
      .select("*")
      .eq("user_id", uid)
      .eq("date", date)
      .order("created_at", { ascending: false });

    setEntries(data ?? []);
  };

  const fetchInsight = async (uid: string, date: string) => {
    const { data } = await supabase
      .from("daily_insights")
      .select("*")
      .eq("user_id", uid)
      .eq("date", date)
      .single();

    setInsight(data);
  };

  useEffect(() => {
    if (!userId) return;

    fetchEntries(userId, selectedDate);

    fetchInsight(userId, selectedDate);

    setLoading(false);
  }, [userId, selectedDate]);

  const uploadIfAny = async (uid: string, date: string) => {
    if (!file) return null;

    const ext = file.name.split(".").pop();

    const path = `${uid}/${date}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file);

    if (error) throw error;

    return path;
  };

  const saveEntry = async () => {
    if (!userId) return;

    const imagePath = await uploadIfAny(userId, selectedDate);

    await supabase.from("entries").insert({
      user_id: userId,
      date: selectedDate,
      note,
      image_url: imagePath,
    });

    setNote("");
    setFile(null);

    fetchEntries(userId, selectedDate);
  };

  const sendQuestion = async () => {
    if (!insight || !question) return;

    await fetch("/api/insights/dialogue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: userId,
        insight_id: insight.id,
        role: "user",
        message: question,
      }),
    });

    setQuestion("");
  };

  const signOut = async () => {
    await supabase.auth.signOut();

    router.replace("/login");
  };

  if (loading) {
    return <p style={{ padding: 24 }}>Loading…</p>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2>Calendar</h2>

        <button onClick={signOut} style={{ marginLeft: "auto" }}>
          Sign out
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
        />
      </div>

      <textarea
        ref={textareaRef}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add note"
        style={{ width: "100%", marginTop: 16 }}
      />

      <div style={{ marginTop: 10 }}>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <button
        onClick={saveEntry}
        style={{ marginTop: 12 }}
      >
        Save
      </button>

      <h3 style={{ marginTop: 24 }}>
        Entries for {selectedDate}
      </h3>

      {entries.length === 0 ? (
        <p>No entries yet.</p>
      ) : (
        entries.map((e) => (
          <div
            key={e.id}
            style={{
              border: "1px solid #eee",
              borderRadius: 8,
              padding: 12,
              marginTop: 10,
            }}
          >
            {e.note && (
              <p style={{ whiteSpace: "pre-wrap" }}>
                {e.note}
              </p>
            )}

            {e.image_url && (
              <SignedImage path={e.image_url} />
            )}
          </div>
        ))
      )}

      {insight && (
        <div
          style={{
            marginTop: 30,
            padding: 16,
            border: "1px solid #ddd",
            borderRadius: 8,
            background: "#fafafa",
          }}
        >
          <h3>Daily Insight</h3>

          <p style={{ whiteSpace: "pre-wrap" }}>
            {insight.insight_text}
          </p>

          <small>
            Generated{" "}
            {new Date(insight.generated_at).toLocaleString()}
          </small>

          <div style={{ marginTop: 16 }}>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about today's insight"
              style={{ width: "100%" }}
            />

            <button
              onClick={sendQuestion}
              style={{ marginTop: 10 }}
            >
              Ask
            </button>
          </div>
        </div>
      )}
    </div>
  );
}