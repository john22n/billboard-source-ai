/**
 * Worker Status SSE Stream
 *
 * Server-Sent Events endpoint for real-time worker status updates.
 * Clients subscribe here and receive status changes immediately.
 * 
 * IMPORTANT: Uses getSessionWithoutRefresh() so SSE reconnections
 * don't keep extending the user's session indefinitely.
 */
import { getSessionWithoutRefresh } from "@/lib/auth";
import { sseManager } from "@/lib/sse-manager";
import { db } from "@/db";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes (Pro plan)

export async function GET() {
  // Use getSessionWithoutRefresh so SSE reconnections don't extend the session
  const session = await getSessionWithoutRefresh();

  // Return auth error as SSE format so client can handle gracefully
  // instead of returning 401 JSON which triggers infinite reconnect loop
  if (!session) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: "unauthorized", code: 401 })}\n\n`)
        );
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  }

  const userId = session.userId;

  const currentUser = await db
    .select({
      workerActivity: user.workerActivity,
      taskRouterWorkerSid: user.taskRouterWorkerSid,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
    .then((rows) => rows[0]);

  const initialStatus = currentUser?.workerActivity || "offline";
  const hasWorker = !!currentUser?.taskRouterWorkerSid;

  const stream = new ReadableStream({
    start(controller) {
      const connection = sseManager.addConnection(userId, controller);
      const encoder = new TextEncoder();

      const initialMessage = `data: ${JSON.stringify({ status: initialStatus, hasWorker })}\n\n`;
      controller.enqueue(encoder.encode(initialMessage));

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepalive);
        }
      }, 30000);

      const cleanup = () => {
        clearInterval(keepalive);
        sseManager.removeConnection(userId, connection);
      };

      controller.close = new Proxy(controller.close, {
        apply(target, thisArg) {
          cleanup();
          return Reflect.apply(target, thisArg, []);
        },
      });
    },
    cancel() {
      console.log(`📡 SSE stream ended for user ${userId} (normal timeout)`);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}