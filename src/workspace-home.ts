import { Router } from 'express';
import { z } from 'zod';
import { guard } from './admin-routes.js';
import type { Pool } from './db.js';
import type { Config } from './config.js';
import type { AdminAuth, ClerkDirectory } from './identity.js';

/** Account-wide reading surface; never inherits the operator's cross-account admin scope. */
export function workspaceHomeRouter(deps: {
  pool: Pool;
  config: Config;
  adminAuth: AdminAuth;
  directory: ClerkDirectory | null;
}) {
  const router = Router();
  router.get('/conversations', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const account = await guard(deps, req, res);
    if (!account) return;
    const offset = z.coerce.number().int().min(0).max(1_000_000).default(0).parse(req.query.offset);
    const result = await deps.pool.query(
      `WITH ranked AS (
        SELECT m.thread_id AS id, m.id AS message_id, m.created_at,
          left(m.body, 280) AS preview,
          json_build_object('id', s.id, 'name', s.name) AS "from",
          json_build_object('id', r.id, 'name', r.name) AS "to",
          count(*) FILTER (WHERE r.owner_user_id=$1 AND m.read_at IS NULL)
            OVER (PARTITION BY m.thread_id, least(s.id,r.id), greatest(s.id,r.id))::int AS unread,
          row_number() OVER (
            PARTITION BY m.thread_id, least(s.id,r.id), greatest(s.id,r.id)
            ORDER BY m.created_at DESC, m.id DESC
          ) AS position
        FROM messages m JOIN bots s ON s.id=m.from_bot_id JOIN bots r ON r.id=m.to_bot_id
        WHERE s.owner_user_id=$1 OR r.owner_user_id=$1
      ), latest AS (SELECT * FROM ranked WHERE position=1), page AS (
        SELECT id, created_at, preview, "from", "to", unread FROM latest
        ORDER BY created_at DESC, message_id DESC LIMIT 50 OFFSET $2
      )
      SELECT (SELECT count(*)::int FROM latest) AS total,
        coalesce((SELECT json_agg(page) FROM page), '[]'::json) AS conversations`,
      [account.id, offset],
    );
    res.json(result.rows[0]);
  });
  return router;
}
