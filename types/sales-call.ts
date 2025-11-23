// types/sales-call.ts
// Shared types for SalesCallTranscriber components

export interface TranscriptItem {
  id: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface TwilioState {
  twilioReady: boolean;
  callActive: boolean;
  userEmail: string;
}
