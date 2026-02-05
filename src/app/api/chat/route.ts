import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const message = (body.message || "").trim();

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

    // Call OpenAI
    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are Asking Wrestlers AI. Be coach-like and practical. Include: Key Cues, 2-3 Drills (reps/time), Common Mistakes, and a short Safety note if relevant. Ask ONE clarifying question if needed.",
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

    return NextResponse.json({ conversationId, answer });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
