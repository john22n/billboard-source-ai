import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import type { Brand, MockupImage } from './state'

/**
 * The wizard's reply streams as an AI SDK UI message. The image and brand the
 * tools captured ride along as message metadata on the final `finish` chunk.
 */
export type WizardReply = UIMessage<{
  image: MockupImage | null
  brand: Brand | null
}>

/** The reply text of a streaming or finished wizard message. */
export function replyText(message: WizardReply | undefined) {
  return (message?.parts ?? [])
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('')
}

/**
 * Reads a UI message stream response body, reporting every intermediate state
 * of the reply, and resolves with its final state. A streamed error chunk rejects
 * with that error, leaving the caller's conversation untouched.
 */
export async function readWizardReply(
  body: ReadableStream<Uint8Array>,
  onUpdate: (message: WizardReply) => void = () => {},
) {
  let message: WizardReply | undefined
  for await (const update of readUIMessageStream<WizardReply>({
    stream: uiMessageChunks(body),
    terminateOnError: true,
  })) {
    message = update
    onUpdate(update)
  }
  return message
}

/** Decodes the server-sent event body of an AI SDK UI message stream response. */
function uiMessageChunks(body: ReadableStream<Uint8Array>) {
  return parseJsonEventStream({
    stream: body,
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream<
      | { success: true; value: UIMessageChunk }
      | { success: false; error: Error },
      UIMessageChunk
    >({
      transform(part, controller) {
        if (!part.success) throw part.error
        controller.enqueue(part.value)
      },
    }),
  )
}
