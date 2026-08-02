-- Initialize database for first use
-- Run this with: wrangler d1 execute microblog-db-local --local --file=./scripts/init-db.sql

-- Users table (single user system)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    session_version INTEGER NOT NULL DEFAULT 0,
    nickname TEXT DEFAULT 'My Blog',
    bio TEXT DEFAULT '',
    email TEXT DEFAULT '',
    wechat TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '/default-avatar.png',
    header_url TEXT DEFAULT '/default-header.png',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Posts table
CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
    pinned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Appends table (follow-up notes to posts)
CREATE TABLE IF NOT EXISTS appends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_appends_post_id ON appends(post_id);
CREATE INDEX IF NOT EXISTS idx_appends_created_at ON appends(created_at);

-- Media table (images/videos)
CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER,
    type TEXT CHECK (type IN ('image', 'video')),
    url TEXT NOT NULL,
    size INTEGER DEFAULT 0,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_post_id ON media(post_id);

-- Tag categories table
CREATE TABLE IF NOT EXISTS tag_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    collapsed_limit INTEGER NOT NULL DEFAULT 8 CHECK (collapsed_limit BETWEEN 4 AND 20),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tag_categories_sort_order ON tag_categories(sort_order);

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    category_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES tag_categories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
CREATE INDEX IF NOT EXISTS idx_tags_category_id ON tags(category_id);

-- Post-Tag junction table
CREATE TABLE IF NOT EXISTS post_tags (
    post_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, tag_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_post_tags_tag_id ON post_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_post_id ON post_tags(post_id);

-- Login logs for security audit
CREATE TABLE IF NOT EXISTS login_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    user_agent TEXT,
    success BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_login_logs_created_at ON login_logs(created_at);

-- Global tag display settings (single row).
CREATE TABLE IF NOT EXISTS tag_display_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    collapsed_limit INTEGER NOT NULL DEFAULT 8 CHECK (collapsed_limit BETWEEN 4 AND 20),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO tag_display_settings (id, collapsed_limit) VALUES (1, 8);

-- Privacy-preserving aggregate page views. No visitor identifiers are stored.
CREATE TABLE IF NOT EXISTS page_view_daily (
    view_date TEXT PRIMARY KEY,
    views INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_posts_created_at_visibility ON posts(created_at, visibility);
CREATE INDEX IF NOT EXISTS idx_posts_visibility_created_at ON posts(visibility, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_pinned_visibility_created_at ON posts(pinned, visibility, created_at);
