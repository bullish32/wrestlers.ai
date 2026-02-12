import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function chunkText(text: string, maxChars = 900) {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  const paragraphs = cleaned.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  for (const p of paragraphs) {
    const block = p.trim();
    if (!block) continue;

    if ((current + "\n\n" + block).length <= maxChars) {
      current = current ? current + "\n\n" + block : block;
    } else {
      if (current) chunks.push(current);
      current = block.length <= maxChars ? block : block.slice(0, maxChars);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function POST(req: Request) {
  try {
    // Simple shared secret to prevent public ingest
    const key = req.headers.get("x-admin-key");
    if (!process.env.RAG_ADMIN_KEY || key !== process.env.RAG_ADMIN_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { title, source, text } = await req.json();
    if (!title || !text) {
      return NextResponse.json({ error: "title and text are required" }, { status: 400 });
    }

    const { data: doc, error: docErr } = await supabaseServer
      .from("documents")
      .insert({ title, source: source ?? null })
      .select("id")
      .single();

    if (docErr) throw docErr;

    const chunks = chunkText(text, 900);

    // Embed all chunks (batch)
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: chunks,
    });

    const rows = chunks.map((content, i) => ({
      document_id: doc.id,
      chunk_index: i,
      content,
      embedding: emb.data[i].embedding,
    }));

    const { error: chunkErr } = await supabaseServer.from("document_chunks").insert(rows);
    if (chunkErr) throw chunkErr;

    return NextResponse.json({ ok: true, documentId: doc.id, chunks: chunks.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
}
