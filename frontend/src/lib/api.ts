// API client for calling Workers API
export function getApiBase() {
  if (typeof window !== 'undefined') {
    const { hostname, protocol } = window.location;
    return `${protocol}//${hostname}:8787`;
  }

  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const url = `${getApiBase()}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // Handle HTTP errors
    if (!response.ok) {
      // Try to parse error response
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        errorData.error?.code || 'HTTP_ERROR',
        errorData.error?.message || `HTTP error! status: ${response.status}`,
        response.status
      );
    }

    const data = await response.json();
    return data;
  } catch (error) {
    // Network errors or JSON parsing errors
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new ApiError(
        'NETWORK_ERROR',
        '网络错误，请检查连接。'
      );
    }

    throw new ApiError(
      'UNKNOWN_ERROR',
      error instanceof Error ? error.message : '发生未知错误'
    );
  }
}

// Auth types
export interface User {
  id: number;
  username: string;
  nickname: string;
  avatar_url: string;
}

export interface SessionData {
  isLoggedIn: true;
  user: User;
}

export interface GuestSession {
  isLoggedIn: false;
}

// Auth API
export const authApi = {
  login: (password: string) =>
    apiClient<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  logout: () =>
    apiClient<Record<string, never>>('/auth/logout', { method: 'POST' }),

  getSession: () =>
    apiClient<SessionData | GuestSession>('/auth/session'),
};

// Posts API
export interface Post {
  id: number;
  content: string;
  visibility: 'public' | 'private';
  pinned?: number;
  created_at: string;
  updated_at: string;
  append_count?: number;
  media_count?: number;
  preview_media_url?: string;
  preview_media_type?: 'image' | 'video';
  preview_tags?: string;
}

export interface PostWithRelations extends Post {
  appends: Append[];
  media: Media[];
  tags: Tag[];
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

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PostsListResponse {
  posts: Post[];
  pagination: Pagination;
}

export const postsApi = {
  list: (params?: { page?: number; date?: string; tag?: string; visibility?: 'all' | 'public' | 'private'; pinned?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.date) query.set('date', params.date);
    if (params?.tag) query.set('tag', params.tag);
    if (params?.visibility) query.set('visibility', params.visibility);
    if (params?.pinned !== undefined) query.set('pinned', String(params.pinned));
    return apiClient<PostsListResponse>(`/posts?${query}`);
  },

  get: (id: number) =>
    apiClient<{ post: PostWithRelations }>(`/posts/${id}`),

  create: (data: { content: string; visibility?: 'public' | 'private'; tagNames?: string[]; mediaIds?: string[] }) =>
    apiClient<{ post: Post }>('/posts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: number, data: { content: string; visibility: 'public' | 'private'; tagNames?: string[]; mediaIds?: string[] }) =>
    apiClient<{ post: Post }>(`/posts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: number) =>
    apiClient<{ message: string }>(`/posts/${id}`, {
      method: 'DELETE',
    }),

  setPinned: (id: number, pinned: boolean) =>
    apiClient<{ post: Post }>(`/posts/${id}/pin`, {
      method: 'POST',
      body: JSON.stringify({ pinned }),
    }),

  setVisibility: (id: number, visibility: 'public' | 'private') =>
    apiClient<{ post: Post }>(`/posts/${id}/visibility`, {
      method: 'POST',
      body: JSON.stringify({ visibility }),
    }),

  addAppend: (postId: number, content: string) =>
    apiClient<{ append: Append }>(`/posts/${postId}/appends`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  deleteAppend: (postId: number, appendId: number) =>
    apiClient<{ message: string }>(`/posts/${postId}/appends/${appendId}`, {
      method: 'DELETE',
    }),
};

// Upload API
export interface PresignedUrlResponse {
  key: string;
  url: string;
  authorization: string;
  expireTime: number;
  headers: {
    'Content-Type': string;
    'x-cos-content-type': string;
  };
  mode?: 'local' | 'cos';
}

export interface UploadConfirmData {
  key: string;
  url: string;
  type: 'image' | 'video';
  size: number;
  width?: number;
  height?: number;
  duration?: number;
}

export const uploadApi = {
  getPresignedUrl: (data: { filename: string; contentType: string; size: number }) =>
    apiClient<PresignedUrlResponse>('/upload/presigned', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  confirmUpload: (data: UploadConfirmData) =>
    apiClient<{ mediaId: number; key: string; url: string }>('/upload/confirm', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteMedia: (id: number) =>
    apiClient<{ message: string }>(`/upload/${id}`, {
      method: 'DELETE',
    }),
};

// Export API
export interface ExportData {
  exported_at: string;
  include_private: boolean;
  posts: Post[];
  appends: Append[];
  media: Media[];
  tags: (Tag & { post_ids: string })[];
}

export const exportApi = {
  exportAll: (data: { format?: 'json' | 'csv' | 'html' | 'markdown'; includePrivate?: boolean }) =>
    apiClient<ExportData>('/export', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  exportPost: (id: number) =>
    apiClient<{ post: PostWithRelations }>(`/export/post/${id}`),
};

// Tags API
export interface TagWithCount extends Tag {
  post_count: number;
}

export interface CalendarDate {
  date: string;
  count: number;
}

export const tagsApi = {
  list: (params?: { includePrivate?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.includePrivate) query.set('includePrivate', 'true');
    return apiClient<{ tags: TagWithCount[] }>(`/tags?${query}`);
  },

  getPosts: (name: string) =>
    apiClient<{ posts: Post[] }>(`/tags/${encodeURIComponent(name)}/posts`),

  getCalendarDates: (params?: { year?: string; month?: string; includePrivate?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.year) query.set('year', params.year);
    if (params?.month) query.set('month', params.month);
    if (params?.includePrivate) query.set('includePrivate', 'true');
    return apiClient<{ dates: CalendarDate[] }>(`/tags/calendar/dates?${query}`);
  },
};
