import type { UserDirectoryRecord } from "@gadgets/workshop-shared/api";
import { DurableObject } from "cloudflare:workers";

const SEARCH_RESULT_LIMIT = 10;
// Every authenticated user can reach this one DO, so a search bounds what it is asked to scan.
const MAX_QUERY_LENGTH = 1000;
const MAX_EXCLUDE_IDS = 1000;
// How many members of an erased tenant are erased at once.
const ERASE_BATCH = 10;

/**
 * Deployment-wide directory of user profiles, so a user can find collaborators
 * by name or id. Each user DO mirrors updates to its own profile here
 * (`UserDurableObject.#syncDirectory`).
 */
export class UserDirectoryDurableObject extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      search_text TEXT NOT NULL,
      rev INTEGER NOT NULL
    ) STRICT`);
  }

  /**
   * Insert or update one user's record. `rev` is the user DO's profile revision: a record already
   * at a higher revision is left alone, so syncs that arrive out of order still converge on the
   * newest profile.
   */
  syncUser(record: UserDirectoryRecord, rev: number): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO users (id, name, search_text, rev) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, search_text = excluded.search_text,
         rev = excluded.rev
       WHERE excluded.rev > users.rev`,
      record.id, record.name, `${record.id}\n${record.name}`.toLowerCase(), rev);
  }

  /** Removes one user's record, for an erased account. Idempotent. */
  removeUser(id: string): void {
    this.ctx.storage.sql.exec(`DELETE FROM users WHERE id = ?`, id);
  }

  /** The ids of every user recorded in this directory. */
  listUserIds(): string[] {
    return this.ctx.storage.sql.exec<{ id: string }>(`SELECT id FROM users ORDER BY id`)
        .toArray().map(row => row.id);
  }

  /**
   * Erases the tenant this directory belongs to (the Durable Object is named by the tenant id):
   * every user recorded here is erased (see `UserDurableObject.eraseAccount`), leaving each only a
   * membership end at `endedAt`, and then the directory is emptied. Members are found here, so one
   * whose sign-in never reached the directory is not. A failure leaves the directory as it was and
   * throws, so a retry finds the same members; every step is idempotent.
   *
   * Refused on the legacy directory (named ""), which belongs to every account that predates
   * tenants and is not a tenant to erase.
   */
  async eraseTenant(endedAt: number): Promise<void> {
    if (!this.ctx.id.name) throw new Error("Only a named tenant can be erased.");
    const users = this.ctx.exports.UserDurableObject;
    const ids = this.listUserIds();
    for (let start = 0; start < ids.length; start += ERASE_BATCH) {
      const outcomes = await Promise.allSettled(
          ids.slice(start, start + ERASE_BATCH).map(id => users.getByName(id).eraseAccount(endedAt)));
      const failure = outcomes.find(outcome => outcome.status === "rejected");
      if (failure) throw failure.reason;
    }
    this.ctx.storage.sql.exec(`DELETE FROM users`);
  }

  /**
   * Case-insensitive substring search over name and id, excluding every id in `excludeIds`.
   * The id is indexed first so an exact id starts at position one; ties sort by id then name.
   * Rejects a query over `MAX_QUERY_LENGTH` characters or containing a line break, and more than
   * `MAX_EXCLUDE_IDS` distinct exclusions.
   */
  searchUsers(query: string, excludeIds: string[]): UserDirectoryRecord[] {
    // Name and id are joined by a newline in search_text, so a needle containing one could match
    // across the two fields.
    if (query.length > MAX_QUERY_LENGTH || /[\r\n]/.test(query)) {
      throw new Error(
        `Search query must be at most ${MAX_QUERY_LENGTH} characters with no line breaks.`);
    }
    const excluded = [...new Set(excludeIds)];
    if (excluded.length > MAX_EXCLUDE_IDS) {
      throw new Error(`At most ${MAX_EXCLUDE_IDS} users can be excluded from a search.`);
    }
    const needle = query.trim().toLowerCase();
    if (needle === "") return [];
    return this.ctx.storage.sql.exec<UserDirectoryRecord>(
      `SELECT id, name FROM users
       WHERE id NOT IN (SELECT value FROM json_each(?)) AND instr(search_text, ?) > 0
       ORDER BY instr(search_text, ?), id, name COLLATE NOCASE
       LIMIT ${SEARCH_RESULT_LIMIT}`,
      JSON.stringify(excluded), needle, needle,
    ).toArray();
  }
}
