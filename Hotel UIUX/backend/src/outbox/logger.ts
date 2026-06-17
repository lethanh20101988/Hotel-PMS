/** Structured logging cho outbox pipeline. */

export function logOutboxEnqueue(eventId: string, eventType: string) {
  console.log(JSON.stringify({ level: "info", component: "outbox", action: "enqueue", eventId, eventType }));
}

export function logOutboxDispatchSuccess(eventId: string, eventType: string, rooms: string[]) {
  console.log(
    JSON.stringify({
      level: "info",
      component: "outbox-dispatch",
      action: "publish_ok",
      eventId,
      eventType,
      rooms,
    }),
  );
}

export function logOutboxDispatchFail(eventId: string, eventType: string, error: string) {
  console.error(
    JSON.stringify({
      level: "error",
      component: "outbox-dispatch",
      action: "publish_fail",
      eventId,
      eventType,
      error,
    }),
  );
}

export function logOutboxWorkerRetry(eventId: string, attempts: number, maxAttempts: number) {
  console.warn(
    JSON.stringify({
      level: "warn",
      component: "outbox-worker",
      action: "retry",
      eventId,
      attempts,
      maxAttempts,
    }),
  );
}

export function logOutboxRecovery(count: number) {
  console.warn(
    JSON.stringify({ level: "warn", component: "outbox-worker", action: "recover_stale_processing", count }),
  );
}
