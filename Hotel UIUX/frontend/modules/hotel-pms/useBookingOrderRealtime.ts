import { useEffect, useRef } from 'react';
import {
  joinRealtimeRooms,
  leaveRealtimeRooms,
  orderRoomForBooking,
} from '../../services/realtimeClient';
import { getTabClientId } from '../../services/tabClientId';

/**
 * Join room order:{bookingId} khi xem chi tiết booking;
 * lắng nghe order_updated và gọi callback (refresh PMS slice only).
 */
export function useBookingOrderRealtime(
  bookingId: string | null | undefined,
  onOrderUpdated?: (orderId: string) => void,
) {
  const onUpdatedRef = useRef(onOrderUpdated);
  onUpdatedRef.current = onOrderUpdated;

  useEffect(() => {
    const id = String(bookingId || '').trim();
    if (!id) return;

    const room = orderRoomForBooking(id);
    joinRealtimeRooms([room]);

    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        eventId?: string;
        event?: string;
        payload?: { orderId?: string; sourceClientId?: string };
      }>).detail;
      // Duplicate eventId đã filter tại realtimeClient (idempotency)
      if (detail?.event !== 'order_updated') return;
      if (detail.payload?.sourceClientId && detail.payload.sourceClientId === getTabClientId()) return;
      const remoteId = String(detail.payload?.orderId || '').trim();
      if (remoteId && remoteId !== id) return;
      onUpdatedRef.current?.(id);
    };

    window.addEventListener('vtr:realtime-event', handler);
    return () => {
      leaveRealtimeRooms([room]);
      window.removeEventListener('vtr:realtime-event', handler);
    };
  }, [bookingId]);
}
