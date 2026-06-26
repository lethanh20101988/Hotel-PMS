import type { RealtimeEnvelope } from "./eventTypes.js";
import type { StateChangedPayload } from "./eventTypes.js";
import { RoomManager } from "./roomManager.js";
import { realtimeBus } from "./redisEventBus.js";
import { bumpDelivered, initMonitor } from "./monitoring.js";

/** Chuyển envelope → JSON wire format (tương thích client cũ cho state). */
export function envelopeToWire(envelope: RealtimeEnvelope): string {
  if (envelope.type === "state_changed") {
    const p = envelope.payload as StateChangedPayload;
    return JSON.stringify({
      eventId: envelope.id,
      revision: p.revision,
      dataVersion: p.dataVersion,
      at: envelope.at,
      kinds: p.kinds,
      sourceClientId: p.sourceClientId,
      companyId: envelope.companyId,
      room: envelope.targetRooms[0],
      entity: p.entity,
      state: p.state,
      event: envelope.type,
    });
  }
  return JSON.stringify({
    eventId: envelope.id,
    event: envelope.type,
    at: envelope.at,
    companyId: envelope.companyId,
    payload: envelope.payload,
  });
}

export class RealtimeHub {
  readonly roomManager = new RoomManager();
  private wired = false;

  wire() {
    if (this.wired) return;
    initMonitor(realtimeBus.getInstanceId());
    realtimeBus.onEvent((envelope) => this.deliver(envelope));
    this.wired = true;
  }

  deliver(envelope: RealtimeEnvelope, opts?: { skipConnectionId?: string }) {
    const wire = envelopeToWire(envelope);
    this.roomManager.emitToRooms(envelope.targetRooms, wire, opts);
    bumpDelivered(envelope.targetRooms.length);
  }

  /** Local publish: Redis + deliver local (bus skips echo từ cùng instance trên Redis path). */
  async publishLocal<T>(envelope: Omit<RealtimeEnvelope<T>, "id" | "at" | "originInstanceId">) {
    this.wire();
    const full = await realtimeBus.publish(envelope);
    this.deliver(full);
    return full;
  }
}

export const realtimeHub = new RealtimeHub();
