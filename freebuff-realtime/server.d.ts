export function createRealtimeTicket(env: { REALTIME?: DurableObjectNamespace }, options: { room: string; userId: string; origin: string; publish: boolean; presence: boolean }): Promise<unknown>
export function publishRealtime(env: { REALTIME?: DurableObjectNamespace }, options: { room: string; event: string; data: unknown }): Promise<void>
