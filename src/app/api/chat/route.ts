import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

// --------- Rate limiting + daily cap (simple preview-safe) ----------
type Bucket = { count: number; resetAt: number };
const minuteBuckets = new Map<string, Bucket>();
const dayBuckets = new Map<string, Bucket>();

function getClientIp(req: Request) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

function bump(buckets: Map<string, Bucket>, key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);

  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  b.count += 1;
  if (b.count > limit) {
    const retryAfterSec = Math.ceil((b.resetAt - now) / 1000);
    const err: any = new Error("Rate limit exceeded. Please try again shortly.");
    err.status = 429;
    err.retryAfterSec = retryAfterSec;
    throw err;
  }
}
// -------------------------------------------------------------------

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

async function retrieveContext(query: string, matchCount = 5) {
  const emb = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });

  const queryEmbedding = emb.data[0].embedding;

  const { data, error } = await supabaseServer.rpc("match_document_chunks", {
    query_embedding: queryEmbedding,
    match_count: matchCount,
  });

  if (error) throw error;

  const chunks = (data ?? []) as { content: string; similarity: number }[];
  return chunks;
}


export async function POST(req: Request) {


  try {
    // Limits (adjust as you like)
    const ip = getClientIp(req);
    bump(minuteBuckets, `m:${ip}`, 10, 60_000); // 10/min/IP
    bump(dayBuckets, `d:${ip}`, 200, 24 * 60 * 60 * 1000); // 200/day/IP

    const body = await req.json();
    const message = (body.message || "").trim();

    // ---- RAG: retrieve relevant knowledge ----
const chunks = await retrieveContext(message, 5);

const sources = chunks.slice(0, 3).map((c, i) => ({
  index: i + 1,
  similarity: Number(c.similarity.toFixed(3)),
  preview: c.content.slice(0, 120),
}));

if (chunks.length) console.log("Top chunk:", chunks[0].content.slice(0, 120));

const contextBlock =
  chunks.length > 0
    ? `Wrestlers AI Knowledge (most relevant excerpts):\n\n` +
      chunks
        .map(
          (c, idx) =>
            `Source ${idx + 1} (score ${c.similarity.toFixed(3)}):\n${c.content}`
        )
        .join("\n\n---\n\n")
    : "";


    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // Create conversation if needed
    let conversationId: string | undefined = body.conversationId;
    if (!conversationId) {
      const { data, error } = await supabaseServer
        .from("conversations")
        .insert({ title: "Ask Wrestlers AI" })
        .select("id")
        .single();

      if (error) throw error;
      conversationId = data.id as string;
    }

    // Log user message
    const { error: userErr } = await supabaseServer.from("messages").insert({
      conversation_id: conversationId,
      role: "user",
      content: message,
    });
    if (userErr) throw userErr;

    // Call OpenAI (hard output cap)
    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      max_output_tokens: 500,
      input: [
        {
          role: "system",
          content:
             "You are Ask Wrestlers AI. Be coach-like and practical. Include: Key Cues, 2-3 Drills (reps/time), Common Mistakes, and a short Safety note if relevant. Ask ONE clarifying question if needed.\n\n" +
  "When Wrestlers AI Knowledge is provided, prefer it over general knowledge and do not invent details not supported by it.\n\n" +
  contextBlock,
        },
        { role: "user", content: message },
      ],
    });

    const answer = resp.output_text?.trim() || "Try rephrasing your question.";

    // Log assistant message
    const { error: asstErr } = await supabaseServer.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: answer,
    });
    if (asstErr) throw asstErr;

return NextResponse.json({ conversationId, answer, sources });
  } catch (err: any) {
    const status = err?.status ?? 500;
    const headers: Record<string, string> = {};
    if (status === 429 && err?.retryAfterSec) {
      headers["Retry-After"] = String(err.retryAfterSec);
    }
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status, headers }
    );
  }
}
