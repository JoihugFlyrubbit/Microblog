ALTER TABLE posts ADD COLUMN pinned INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_posts_pinned_visibility_created_at ON posts(pinned, visibility, created_at);
