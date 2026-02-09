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
  createdAt: number;
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
      createdAt: Date.now(),
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
   * Check if a controller is still usable
   */
  private isControllerValid(controller: SSEController): boolean {
    try {
      // Check if controller has desiredSize - if null, stream is closed
      return controller.desiredSize !== null;
    } catch {
      return false;
    }
  }

  /**
   * Broadcast status update to all connections for a user
   */
  broadcast(userId: string, data: Record<string, unknown>) {
    const userConnections = this.connections.get(userId);
    if (!userConnections || userConnections.size === 0) {
      return;
    }

    const message = `data: ${JSON.stringify(data)}\n\n`;
    const staleConnections: UserConnection[] = [];
    let successCount = 0;

    for (const connection of userConnections) {
      try {
        // Check if controller is still valid before trying to enqueue
        if (!this.isControllerValid(connection.controller)) {
          staleConnections.push(connection);
          continue;
        }

        connection.controller.enqueue(connection.encoder.encode(message));
        connection.lastStatus = data.status as string;
        successCount++;
      } catch (error) {
        console.error(`❌ Failed to send SSE message to user ${userId}:`, error);
        staleConnections.push(connection);
      }
    }

    // Clean up stale connections after iteration (avoid modifying set during iteration)
    for (const staleConnection of staleConnections) {
      this.removeConnection(userId, staleConnection);
    }

    if (successCount > 0) {
      console.log(`📡 Broadcasted to ${successCount} connection(s) for user ${userId}`);
    }
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

  /**
   * Clean up all stale connections across all users
   * Can be called periodically if needed
   */
  cleanupStaleConnections() {
    let totalCleaned = 0;

    for (const [userId, userConnections] of this.connections) {
      const staleConnections: UserConnection[] = [];

      for (const connection of userConnections) {
        if (!this.isControllerValid(connection.controller)) {
          staleConnections.push(connection);
        }
      }

      for (const staleConnection of staleConnections) {
        this.removeConnection(userId, staleConnection);
        totalCleaned++;
      }
    }

    if (totalCleaned > 0) {
      console.log(`🧹 Cleaned up ${totalCleaned} stale SSE connection(s)`);
    }

    return totalCleaned;
  }
}

// Global singleton instance
export const sseManager = new SSEManager();