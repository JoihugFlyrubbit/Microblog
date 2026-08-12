ALTER TABLE tag_categories
ADD COLUMN collapsed_limit INTEGER NOT NULL DEFAULT 8
CHECK (collapsed_limit BETWEEN 4 AND 20);
