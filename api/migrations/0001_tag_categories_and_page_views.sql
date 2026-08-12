CREATE TABLE IF NOT EXISTS tag_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tag_categories_sort_order ON tag_categories(sort_order);

ALTER TABLE tags ADD COLUMN category_id INTEGER REFERENCES tag_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tags_category_id ON tags(category_id);

CREATE TABLE IF NOT EXISTS tag_display_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    collapsed_limit INTEGER NOT NULL DEFAULT 8 CHECK (collapsed_limit BETWEEN 4 AND 20),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO tag_display_settings (id, collapsed_limit) VALUES (1, 8);

CREATE TABLE IF NOT EXISTS page_view_daily (
    view_date TEXT PRIMARY KEY,
    views INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
