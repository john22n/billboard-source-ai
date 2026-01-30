/**
 * SSE Connection Manager
 *
 * In-memory manager for Server-Sent Events connections.
 * Maintains active connections and broadcasts status updates.
 */

type SSEController = ReadableStreamDefaultController<Uint8Array>;

interface UserConnection {
  controller: SSEController;
  encoder: TextEncoder;
  lastStatus: string | null;
}

class SSEManager {
  private connections: Map<string, Set<UserConnection>> = new Map();

  /**
   * Register a new SSE connection for a user
   */
  addConnection(userId: string, controller: SSEController): UserConnection {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }

    const connection: UserConnection = {
      controller,
      encoder: new TextEncoder(),
      lastStatus: null,
    };

    this.connections.get(userId)!.add(connection);
    console.log(`📡 SSE connected: user=${userId}, total=${this.connections.get(userId)!.size}`);

    return connection;
  }

  /**
   * Remove a connection for a user
   */
  removeConnection(userId: string, connection: UserConnection) {
    const userConnections = this.connections.get(userId);
    if (userConnections) {
      userConnections.delete(connection);
      console.log(`📡 SSE disconnected: user=${userId}, remaining=${userConnections.size}`);

      if (userConnections.size === 0) {
        this.connections.delete(userId);
      }
    }
  }

  /**
   * Broadcast status update to all connections for a user
   */
  broadcast(userId: string, data: any) {
    const userConnections = this.connections.get(userId);
    if (!userConnections || userConnections.size === 0) {
      return;
    }

    const message = `data: ${JSON.stringify(data)}\n\n`;

    for (const connection of userConnections) {
      try {
        connection.controller.enqueue(connection.encoder.encode(message));
        connection.lastStatus = data.status;
      } catch (error) {
        console.error(`❌ Failed to send SSE message to user ${userId}:`, error);
        this.removeConnection(userId, connection);
      }
    }

    console.log(`📡 Broadcasted to ${userConnections.size} connection(s) for user ${userId}`);
  }

  /**
   * Get all user IDs with active connections
   */
  getActiveUserIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get last known status for a user's first connection
   */
  getLastStatus(userId: string): string | null {
    const userConnections = this.connections.get(userId);
    if (!userConnections || userConnections.size === 0) {
      return null;
    }

    return Array.from(userConnections)[0].lastStatus;
  }

  /**
   * Check if user has any active connections
   */
  hasConnections(userId: string): boolean {
    const userConnections = this.connections.get(userId);
    return userConnections ? userConnections.size > 0 : false;
  }
}

// Global singleton instance
export const sseManager = new SSEManager();
