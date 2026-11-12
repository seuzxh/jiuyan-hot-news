/** Web 端数据访问：查询函数在 @jyc/core（repos/queries），此处绑定连接单例并保持原签名 */
import { join } from "node:path";
import {
  findRepoRoot,
  openDb,
  latestEvents as latestEventsDb,
  hotEvents as hotEventsDb,
  getEvent as getEventDb,
  eventMembers as eventMembersDb,
  searchAll as searchAllDb,
  pushHistory as pushHistoryDb,
  type Db,
  type EventView,
  type MemberView,
} from "@jyc/core";

export type { EventView, MemberView };
export { availableDates, eventsOnDate } from "@jyc/core";

let dbSingleton: Db | undefined;

export function db(): Db {
  if (!dbSingleton) {
    const root = findRepoRoot();
    dbSingleton = openDb(join(root, "data", "jycgs.db"), join(root, "database", "migrations"));
  }
  return dbSingleton;
}

export function latestEvents(limit = 300): EventView[] {
  return latestEventsDb(db(), limit);
}

export function hotEvents(limit = 20): EventView[] {
  return hotEventsDb(db(), limit);
}

export function getEvent(id: string): EventView | undefined {
  return getEventDb(db(), id);
}

export function eventMembers(eventId: string): MemberView[] {
  return eventMembersDb(db(), eventId);
}

export function searchAll(q: string, limit = 40): ReturnType<typeof searchAllDb> {
  return searchAllDb(db(), q, limit);
}

export function pushHistory(limit = 30): ReturnType<typeof pushHistoryDb> {
  return pushHistoryDb(db(), limit);
}
