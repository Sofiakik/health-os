"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Dialogue = {
  role: string;
  message: string;
};

type Insight = {
  id: string;
  insight: {
    text: string;
  };
};

function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export default function CalendarPage() {

  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(today());

  const [insight, setInsight] = useState<Insight | null>(null);
  const [dialogue, setDialogue] = useState<Dialogue[]>([]);

  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);

  /*
  -------------------------
  INIT USER
  -------------------------
  */

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

  /*
  -------------------------
  LOAD INSIGHT + DIALOGUE
  -------------------------
  */

  const loadDay = async (uid: string, date: string) => {

    const { data: insightData } = await supabase
      .from("daily_insights")
      .select("*")
      .eq("user_id", uid)
      .eq("date", date)
      .maybeSingle();

    setInsight(insightData ?? null);

    if (insightData?.id) {

      const { data: dialogueData } = await supabase
        .from("insight_dialogue")
        .select("role,message")
        .eq("insight_id", insightData.id)
        .order("created_at", { ascending: true });

      setDialogue(dialogueData ?? []);

    } else {

      setDialogue([]);

    }

  };

  useEffect(() => {

    if (!userId) return;

    loadDay(userId, selectedDate);

  }, [userId, selectedDate]);

  /*
  -------------------------
  SEND QUESTION
  -------------------------
  */

  const sendQuestion = async () => {

    if (!question.trim() || !insight) return;

    const userMessage = {
      role: "user",
      message: question
    };

    // optimistic update
    setDialogue(prev => [...prev, userMessage]);

    const q = question;

    setQuestion("");
    setLoading(true);

    try {

      const res = await fetch("/api/insights/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          user_id: userId,
          insight_id: insight.id,
          message: q
        })
      });

      const data = await res.json();

      const assistantMessage = {
        role: "assistant",
        message: data.reply
      };

      setDialogue(prev => [...prev, assistantMessage]);

    } catch (e) {

      console.error(e);

    } finally {

      setLoading(false);

    }

  };

  /*
  -------------------------
  SIGN OUT
  -------------------------
  */

  const signOut = async () => {

    await supabase.auth.signOut();

    router.replace("/login");

  };

  /*
  -------------------------
  UI
  -------------------------
  */

  return (

    <div style={{ padding: 24, maxWidth: 700 }}>

      <div style={{ display: "flex", alignItems: "center" }}>
        <h2>Calendar</h2>

        <button
          onClick={signOut}
          style={{ marginLeft: "auto" }}
        >
          Sign out
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) =>
            setSelectedDate(e.target.value)
          }
        />
      </div>

      {insight && (

        <div style={{
          marginTop: 20,
          padding: 16,
          border: "1px solid #eee",
          borderRadius: 8,
          background: "#fafafa"
        }}>

          <h3>Daily Insight</h3>

          <p style={{ whiteSpace: "pre-wrap" }}>
            {insight.insight?.text}
          </p>

        </div>

      )}

      {insight && (

        <div style={{
          marginTop: 20,
          padding: 16,
          border: "1px solid #eee",
          borderRadius: 8
        }}>

          <h3>Conversation</h3>

          {dialogue.map((m, i) => (

            <div
              key={i}
              style={{
                marginBottom: 10,
                padding: 10,
                background:
                  m.role === "assistant"
                    ? "#f5f5f5"
                    : "#e8f3ff",
                borderRadius: 6
              }}
            >

              <strong>
                {m.role === "assistant"
                  ? "Assistant"
                  : "You"}
              </strong>

              <p
                style={{
                  whiteSpace: "pre-wrap",
                  marginTop: 4
                }}
              >
                {m.message}
              </p>

            </div>

          ))}

          <textarea
            value={question}
            onChange={(e) =>
              setQuestion(e.target.value)
            }
            placeholder="Ask a follow-up question..."
            style={{
              width: "100%",
              minHeight: 70,
              marginTop: 10
            }}
          />

          <button
            onClick={sendQuestion}
            disabled={loading}
            style={{ marginTop: 10 }}
          >
            {loading ? "Thinking..." : "Ask"}
          </button>

        </div>

      )}

    </div>

  );

}