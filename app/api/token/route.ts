import { NextResponse } from "next/server";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

export async function GET() {

  const instructions = `
You are transcribing a live sales call in real time.
Your tasks:
- Accurately transcribe everything said by both speakers.
- Identify and label speakers clearly (e.g., "Sales Rep:", "Customer:").
- Update form fields dynamically as the conversation progresses, based on what is being discussed.
- Use JSON updates to represent progress (e.g., {"field": "customer_needs", "value": "They are interested in premium support"}).
- Do NOT summarize — keep context incremental.
- Use Spanish ("es") for transcription text if the call is in Spanish.
`.trim();

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "transcription",
          audio: {
            input: {
              transcription: {
                language: "es",
                model: "gpt-4o-transcribe",
                prompt: instructions
              },
              noise_reduction: {
                type: "near_field"
              }
            }
          }
        }
      })
    })


    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI error:", errorText);
      return NextResponse.json(
        { error: "Failed to generate token", details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Token generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate token", details: String(error) },
      { status: 500 }
    );
  }
}

