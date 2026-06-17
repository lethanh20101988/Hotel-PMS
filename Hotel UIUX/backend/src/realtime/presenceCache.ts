import type { RedisClientType } from "redis";

const ONLINE_USERS_KEY = "rt:online:users";
const ONLINE_DRIVERS_KEY = "rt:online:drivers";
const ACTIVE_ORDERS_PREFIX = "rt:orders:active:";

export class PresenceCache {
  constructor(private redis: RedisClientType | null) {}

  async markUserOnline(userId: string, ttlSec = 120) {
    if (!this.redis) return;
    await this.redis.sAdd(ONLINE_USERS_KEY, userId);
    await this.redis.setEx(`rt:presence:user:${userId}`, ttlSec, "1");
  }

  async markUserOffline(userId: string) {
    if (!this.redis) return;
    await this.redis.sRem(ONLINE_USERS_KEY, userId);
    await this.redis.del(`rt:presence:user:${userId}`);
  }

  async markDriverOnline(driverId: string, ttlSec = 120) {
    if (!this.redis) return;
    await this.redis.sAdd(ONLINE_DRIVERS_KEY, driverId);
    await this.redis.setEx(`rt:presence:driver:${driverId}`, ttlSec, "1");
  }

  async markDriverOffline(driverId: string) {
    if (!this.redis) return;
    await this.redis.sRem(ONLINE_DRIVERS_KEY, driverId);
    await this.redis.del(`rt:presence:driver:${driverId}`);
  }

  async cacheActiveOrder(companyId: string, orderId: string, json: string, ttlSec = 3600) {
    if (!this.redis) return;
    const key = `${ACTIVE_ORDERS_PREFIX}${companyId}`;
    await this.redis.hSet(key, orderId, json);
    await this.redis.expire(key, ttlSec);
  }

  async removeActiveOrder(companyId: string, orderId: string) {
    if (!this.redis) return;
    await this.redis.hDel(`${ACTIVE_ORDERS_PREFIX}${companyId}`, orderId);
  }

  async getOnlineDriverIds(): Promise<string[]> {
    if (!this.redis) return [];
    return await this.redis.sMembers(ONLINE_DRIVERS_KEY);
  }

  async getOnlineUserCount(): Promise<number> {
    if (!this.redis) return 0;
    return await this.redis.sCard(ONLINE_USERS_KEY);
  }
}
