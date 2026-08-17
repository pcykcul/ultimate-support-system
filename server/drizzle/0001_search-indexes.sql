-- Search infrastructure: classic IR done properly — no embeddings, no AI.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
-- Full-text expression indexes (kept as expressions so the ORM schema stays clean).
CREATE INDEX IF NOT EXISTS kb_articles_fts_idx ON kb_articles
  USING GIN (to_tsvector('english', title || ' ' || body));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS kb_articles_trgm_idx ON kb_articles
  USING GIN ((title || ' ' || body) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tickets_fts_idx ON tickets
  USING GIN (to_tsvector('english', subject));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ticket_messages_fts_idx ON ticket_messages
  USING GIN (to_tsvector('english', body));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sops_fts_idx ON sops
  USING GIN (to_tsvector('english', title || ' ' || body));
--> statement-breakpoint
-- Ticket number sequence seed.
INSERT INTO counters (name, value) VALUES ('ticket_number', 0) ON CONFLICT DO NOTHING;
