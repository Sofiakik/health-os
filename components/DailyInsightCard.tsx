"use client";
import { ReactNode } from "react";

type InsightCardData = {
  insight_text: string | null;
  hypothesis: string | null;
  confidence: number | null;
};

type DailyInsightCardProps = {
  loading: boolean;
  hasMealsForDate: boolean;
  insight: InsightCardData | null;
};

function formatConfidence(confidence: number | null): string {
  if (confidence == null) return "—";
  return `${Math.round(Number(confidence) * 100)}%`;
}

export default function DailyInsightCard({
  loading,
  hasMealsForDate,
  insight,
}: DailyInsightCardProps) {
  let content: ReactNode;

  if (loading) {
    content = <p style={{ margin: 0, fontSize: 15, color: "#b0b5be" }}>Loading daily insight...</p>;
  } else if (!hasMealsForDate) {
    content = <p style={{ margin: 0, fontSize: 15, color: "#888c94" }}>No meal+WHOOP insights today</p>;
  } else if (!insight) {
    content = <p style={{ margin: 0, fontSize: 15, color: "#9da4af" }}>Insight is being generated</p>;
  } else {
    content = (
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#f0f0f0", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
          {insight.insight_text ?? "No insight text available."}
        </div>
        <div style={{ fontSize: 14, color: "#9ca3af", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {insight.hypothesis ?? "No hypothesis available."}
        </div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Confidence: {formatConfidence(insight.confidence)}
        </div>
      </div>
    );
  }

  return (
    <section style={{ marginTop: 24 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 600, letterSpacing: "-0.3px", color: "#e5e7eb" }}>Daily insight</h3>
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 12,
          padding: 18,
          background: "#232325",
        }}
      >
        {content}
      </div>
    </section>
  );
}
