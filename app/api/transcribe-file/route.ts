// app/api/transcribe-file/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { generateText, generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Zod schemas for structured outputs
const keyPointsSchema = z.object({
  clientName: z.string().nullable(),
  companyName: z.string().nullable(),
  industry: z.string().nullable(),
  companySize: z.string().nullable(),
  painPoints: z.array(z.string()),
  budget: z.string().nullable(),
  timeline: z.string().nullable(),
  competitors: z.array(z.string()),
  decisionMakers: z.array(z.string()),
  currentSolution: z.string().nullable(),
  objections: z.array(z.string()),
  requirements: z.array(z.string()),
});

const actionItemsSchema = z.object({
  actionItems: z.array(
    z.object({
      action: z.string(),
      owner: z.enum(["Sales Rep", "Customer", "Both"]),
      deadline: z.string().nullable(),
      priority: z.enum(["high", "medium", "low"]),
    })
  ),
});

const sentimentSchema = z.object({
  overall: z.enum(["positive", "neutral", "negative"]),
  clientEngagement: z.enum(["high", "medium", "low"]),
  buyingSignals: z.array(z.string()),
  concerns: z.array(z.string()),
  dealLikelihood: z.enum(["high", "medium", "low"]),
  confidenceScore: z.number().min(0).max(100),
  emotionalTone: z.enum([
    "enthusiastic",
    "interested",
    "skeptical",
    "resistant",
    "neutral",
  ]),
  reasoning: z.string(),
});

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    console.log("📁 Transcribing file:", file.name, `(${(file.size / 1024 / 1024).toFixed(2)} MB)`);

    // Step 1: Transcribe the audio file using OpenAI Whisper
    const transcription = await openaiClient.audio.transcriptions.create({
      file: file,
      model: "whisper-1",
      language: "en",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });

    const transcript = transcription.text;
    console.log("✅ Transcription complete, analyzing...");

    // Step 2: Perform parallel analysis using Vercel AI SDK
    const [summaryResult, keyPointsResult, actionItemsResult, sentimentResult] =
      await Promise.all([
        generateText({
          model: openai("gpt-4o"),
          system: `You are a sales call analyst. Summarize this sales call in 2-3 concise paragraphs.
Focus on:
- Main discussion points and topics covered
- Client needs and pain points mentioned
- Solutions or products discussed
- Overall outcome and next steps`,
          prompt: transcript,
          temperature: 0.3,
        }),
        generateObject({
          model: openai("gpt-4o"),
          schema: keyPointsSchema,
          system: `Extract key information from this sales call. Only include information that was explicitly mentioned. Use null for missing fields.`,
          prompt: transcript,
          temperature: 0.2,
        }),
        generateObject({
          model: openai("gpt-4o-mini"),
          schema: actionItemsSchema,
          system: `Extract all action items and next steps from this sales call.`,
          prompt: transcript,
          temperature: 0.2,
        }),
        generateObject({
          model: openai("gpt-4o-mini"),
          schema: sentimentSchema,
          system: `Analyze the sentiment and engagement of this sales call.`,
          prompt: transcript,
          temperature: 0.2,
        }),
      ]);

    console.log("✅ Analysis complete");

    return NextResponse.json({
      text: transcript,
      segments: transcription.segments,
      analysis: {
        summary: summaryResult.text,
        keyPoints: keyPointsResult.object,
        actionItems: actionItemsResult.object.actionItems,
        sentiment: sentimentResult.object,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ Transcription error:", error);
    return NextResponse.json(
      { error: "Failed to transcribe file", details: errorMessage },
      { status: 500 }
    );
  }
}








/*
import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const runtime = "nodejs"; // ensure Node runtime for file uploads

export async function POST(req: Request) {
  const instructions = `
You are transcribing a sales call. Please:
- Transcribe all speech accurately
- Identify different speakers (e.g., "Sales Rep:", "Customer:")
- Include natural pauses and emphasis
- Note any important background information mentioned
- Label speakers clearly`.trim();
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Request speaker diarization with GPT-4o-transcribe
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-transcribe",
      language: "en",
      prompt: instructions,
      response_format: "json", // gives structured timestamps & speaker data
      speaker_diarization: true, // 👈 enables speaker separation
    });

    // The model returns structured segments like:
    // {
    //   text: "...",
    //   diarization: [
    //     { speaker: "spk_0", text: "Hello..." },
    //     { speaker: "spk_1", text: "Hi..." }
    //   ]
    // }

    // Format the output neatly for display
    let formattedText = "";
    if (transcription.diarization && Array.isArray(transcription.diarization)) {
      formattedText = transcription.diarization
        .map((seg, i) => {
          const speakerNum = seg.speaker?.replace("spk_", "Speaker ") || `Speaker ${i + 1}`;
          return `${speakerNum}: ${seg.text.trim()}`;
        })
        .join("\n\n");
    } else {
      formattedText = transcription.text || "";
    }
    console.log(formattedText, transcription.diarization)

    return NextResponse.json({ text: formattedText });
  } catch (error: any) {
    console.error("Transcription error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
*/
