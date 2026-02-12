"use client";

import { useState } from "react";

type Source = {
  index: number;
  similarity: number;
  preview: string;
};

export default function AskPage() {
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState<string>("");
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setAnswer("");
    setSources([]);

    const trimmed = message.trim();
    if (!trimmed) return;

    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      const data = await res.json();
      
      setAnswer(data.answer || "");
      setSources(data.sources || []);

      if (!res.ok) {
        setError(data?.error || "Request failed");
        return;
      }

      setAnswer(data?.answer || "");
      setSources(Array.isArray(data?.sources) ? data.sources : []);
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ marginBottom: 8 }}>Ask Wrestlers AI</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Ask about technique, drills, practice plans, match strategy, and rules.
      </p>

      <form onSubmit={onAsk} style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g., How do I defend a single leg?"
          style={{
            flex: 1,
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid #333",
            background: "transparent",
            color: "inherit",
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid #333",
            background: loading ? "#222" : "#111",
            color: "inherit",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Thinking..." : "Ask"}
        </button>
      </form>

      {error && (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #552", borderRadius: 10 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ✅ ANSWER SECTION */}
      {answer && (
  <div style={{ marginTop: 18, padding: 14, border: "1px solid #333", borderRadius: 12, whiteSpace: "pre-wrap" }}>
    {answer}
  </div>
)}

{sources.length > 0 && (
  <div style={{ marginTop: 14, padding: 14, border: "1px solid #333", borderRadius: 12 }}>
    <div style={{ fontWeight: 700, marginBottom: 10 }}>Sources used</div>
    {sources.map((s, idx) => (
      <div key={idx} style={{ marginBottom: 12, opacity: 0.9 }}>
        <div style={{ fontWeight: 600 }}>
          Source {s.index ?? idx + 1} (similarity {s.similarity})
        </div>
        <div style={{ fontSize: 14, opacity: 0.85 }}>{s.preview}...</div>
      </div>
    ))}
  </div>
)}
 </main>
  );
}