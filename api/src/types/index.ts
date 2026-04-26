// API Types

// Extend Hono Context Variables
declare module 'hono' {
  interface ContextVariableMap {
    userId: number;
    username: string;
  }
}

export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  SESSION_SECRET: string;
  ALLOW_ADMIN_BOOTSTRAP?: string;
  ALLOWED_ORIGINS?: string;
  SESSION_SAME_SITE?: 'lax' | 'strict' | 'none';
  ENV_LOCATION_LABEL?: string;
  ENV_LATITUDE?: string;
  ENV_LONGITUDE?: string;
  ENV_TIMEZONE?: string;
  QWEATHER_PRIVATE_KEY?: string;
  QWEATHER_KEY_ID?: string;
  QWEATHER_PROJECT_ID?: string;
  QWEATHER_API_HOST?: string;
  ENVIRONMENT?: string;
}

export interface User {
  id: number;
  username: string;
  password_hash: string;
  nickname: string;
  bio: string;
  email: string;
  wechat: string;
  avatar_url: string;
  header_url: string;
  created_at: string;
  updated_at: string;
}

export interface Post {
  id: number;
  content: string;
  visibility: 'public' | 'private';
  pinned?: number;
  created_at: string;
  updated_at: string;
}

export interface Append {
  id: number;
  post_id: number;
  content: string;
  created_at: string;
}

export interface Media {
  id: number;
  post_id: number;
  type: 'image' | 'video';
  url: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  created_at: string;
}

export interface Tag {
  id: number;
  name: string;
  created_at: string;
}

export interface PostWithRelations extends Post {
  appends: Append[];
  media: Media[];
  tags: Tag[];
}

export interface SessionData {
  userId: number;
  username: string;
  isLoggedIn: boolean;
}
