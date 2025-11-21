// app/api/analyze-transcript/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generateText, generateObject } from "ai"; // ✅ Vercel AI SDK
import { openai } from "@ai-sdk/openai"; // ✅ Vercel AI SDK OpenAI Provider
import { z } from "zod";
import { getSession } from "@/lib/auth";

// ============================================
// ZOD SCHEMAS FOR TYPE-SAFE OUTPUTS
// ============================================

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

const basicSentimentSchema = z.object({
  overall: z.enum(["positive", "neutral", "negative"]),
  engagement: z.enum(["high", "medium", "low"]),
});

const detailedSentimentSchema = z.object({
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

const recommendationsSchema = z.object({
  nextSteps: z.array(z.string()),
  talkingPoints: z.array(z.string()),
  concerns: z.array(z.string()),
  opportunities: z.array(z.string()),
  followUpEmail: z.string(),
});

// ============================================
// MAIN API ROUTE
// ============================================

export async function POST(req: NextRequest) {
  try {
    // ✅ SECURITY: Require authentication
    const session = await getSession();
    if (!session?.userId) {
      return NextResponse.json(
        { error: "Unauthorized - Please log in" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { transcript, mode = "full" } = body;

    if (!transcript || typeof transcript !== "string") {
      return NextResponse.json(
        { error: "Transcript text is required" },
        { status: 400 }
      );
    }

    // INCREMENTAL MODE: Fast, lightweight analysis for real-time updates
    if (mode === "incremental") {
      console.log("🔄 Running incremental analysis...");

      const [quickSummary, sentiment] = await Promise.all([
        // ✅ Using generateText from Vercel AI SDK
        generateText({
          model: openai("gpt-4o-mini"), // Fast & cheap
          system:
            "Provide a brief 2-3 sentence summary of the ongoing sales conversation. Focus on current topics being discussed.",
          prompt: transcript,
          temperature: 0.3,
        }),
        // ✅ Using generateObject from Vercel AI SDK
        generateObject({
          model: openai("gpt-4o-mini"),
          schema: basicSentimentSchema, // Type-safe with Zod
          system: "Quick sentiment analysis.",
          prompt: transcript,
          temperature: 0.2,
        }),
      ]);

      return NextResponse.json({
        mode: "incremental",
        analysis: {
          summary: quickSummary.text,
          sentiment: sentiment.object, // ✅ Fully typed
        },
      });
    }

    // FULL MODE: Comprehensive analysis for final results
    console.log("📊 Running full analysis...");

    const [
      summaryResult,
      keyPointsResult,
      actionItemsResult,
      sentimentResult,
      recommendationsResult,
    ] = await Promise.all([
      // ✅ Summary with generateText
      generateText({
        model: openai("gpt-4o"), // Detailed & accurate
        system: `You are a sales call analyst. Create a comprehensive summary of this sales call.

Structure your summary with:
1. **Overview**: What was this call about? (2-3 sentences)
2. **Key Discussion Points**: Main topics covered
3. **Client Needs**: What the client is looking for
4. **Proposed Solution**: What was offered or discussed
5. **Outcome**: How the call concluded and next steps`,
        prompt: transcript,
        temperature: 0.3,
      }),

      // ✅ Key Points with generateObject
      generateObject({
        model: openai("gpt-4o"),
        schema: keyPointsSchema,
        system:
          "Extract key information from this sales call. Only include information that was explicitly mentioned. Use null for missing fields.",
        prompt: transcript,
        temperature: 0.2,
      }),

      // ✅ Action Items with generateObject
      generateObject({
        model: openai("gpt-4o-mini"),
        schema: actionItemsSchema,
        system: "Extract action items from this sales call.",
        prompt: transcript,
        temperature: 0.2,
      }),

      // ✅ Detailed Sentiment with generateObject
      generateObject({
        model: openai("gpt-4o"),
        schema: detailedSentimentSchema,
        system: "Detailed sentiment analysis of this sales call.",
        prompt: transcript,
        temperature: 0.2,
      }),

      // ✅ Recommendations with generateObject
      generateObject({
        model: openai("gpt-4o"),
        schema: recommendationsSchema,
        system:
          "Based on this sales call, provide strategic recommendations.",
        prompt: transcript,
        temperature: 0.4,
      }),
    ]);

    console.log("✅ Full analysis complete");

    return NextResponse.json({
      mode: "full",
      analysis: {
        summary: summaryResult.text,
        keyPoints: keyPointsResult.object,
        actionItems: actionItemsResult.object.actionItems,
        sentiment: sentimentResult.object,
        recommendations: recommendationsResult.object,
      },
    });
  } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("❌ Analysis error:", error);
      return NextResponse.json(
        { error: "Failed to analyze transcript", details: errorMessage },
        { status: 500 }
      );
  }
}

// ============================================
// EXAMPLE USAGE
// ============================================

/*
// INCREMENTAL MODE (During Recording)
const response = await fetch("/api/analyze-transcript", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    transcript: "Current transcript text...",
    mode: "incremental"
  }),
});

const result = await response.json();
// result.analysis = { summary: "...", sentiment: { overall, engagement } }


// FULL MODE (After Recording)
const response = await fetch("/api/analyze-transcript", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    transcript: "Complete transcript text...",
    mode: "full"
  }),
});

const result = await response.json();
// result.analysis = {
//   summary,
//   keyPoints,
//   actionItems,
//   sentiment,
//   recommendations
// }
*/
