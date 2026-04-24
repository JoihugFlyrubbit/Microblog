import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { Env } from '../types';

export const exportRouter = new Hono<{ Bindings: Env }>();

// Validation schema
const exportSchema = z.object({
  format: z.enum(['json', 'csv', 'html', 'markdown']).default('json'),
  includePrivate: z.boolean().default(true),
});

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeMarkdown = (value: string) =>
  value.replace(/\\/g, '\\\\');

const formatMarkdownDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

// Export all data
exportRouter.post('/', authMiddleware, zValidator('json', exportSchema), async (c) => {
  const db = c.env.DB;
  const { format, includePrivate } = c.req.valid('json');

  try {
    // Build visibility filter
    const visibilityFilter = includePrivate ? '' : "WHERE visibility = 'public'";

    // Get posts
    const posts = await db.prepare(`
      SELECT * FROM posts
      ${visibilityFilter}
      ORDER BY created_at DESC
    `).all();

    // Get appends
    const appends = await db.prepare(`
      SELECT a.* FROM appends a
      JOIN posts p ON a.post_id = p.id
      ${visibilityFilter}
      ORDER BY a.created_at DESC
    `).all();

    // Get media
    const mediaWhere = includePrivate
      ? ''
      : "WHERE m.post_id IS NULL OR p.visibility = 'public'";
    const media = await db.prepare(`
      SELECT m.* FROM media m
      LEFT JOIN posts p ON m.post_id = p.id
      ${mediaWhere}
      ORDER BY m.created_at DESC
    `).all();

    // Get tags with post associations
    const tags = await db.prepare(`
      SELECT
        t.*,
        GROUP_CONCAT(p.id) as post_ids
      FROM tags t
      LEFT JOIN post_tags pt ON t.id = pt.tag_id
      LEFT JOIN posts p ON pt.post_id = p.id
      ${includePrivate ? '' : "WHERE p.visibility = 'public' OR p.id IS NULL"}
      GROUP BY t.id
      ORDER BY t.name ASC
    `).all();

    const exportData = {
      exported_at: new Date().toISOString(),
      include_private: includePrivate,
      posts: posts.results,
      appends: appends.results,
      media: media.results,
      tags: tags.results,
    };

    if (format === 'csv') {
      // Generate CSV for posts
      const csvHeaders = ['id', 'content', 'visibility', 'created_at', 'updated_at'];
      const csvRows = (posts.results as any[]).map(post =>
        csvHeaders.map(h => {
          const val = post[h];
          // Escape quotes and wrap in quotes if needed
          if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        }).join(',')
      );
      const csv = [csvHeaders.join(','), ...csvRows].join('\n');

      return c.body(csv, 200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="microblog-export-${new Date().toISOString().split('T')[0]}.csv"`,
      });
    }

    if (format === 'html') {
      const postTags = new Map<number, string[]>();
      for (const tag of tags.results as Array<{ name: string; post_ids: string | null }>) {
        if (!tag.post_ids) continue;
        for (const postId of tag.post_ids.split(',').map((id) => Number(id)).filter(Boolean)) {
          const current = postTags.get(postId) || [];
          current.push(tag.name);
          postTags.set(postId, current);
        }
      }

      const appendsByPost = new Map<number, any[]>();
      for (const append of appends.results as Array<{ post_id: number }>) {
        const current = appendsByPost.get(append.post_id) || [];
        current.push(append);
        appendsByPost.set(append.post_id, current);
      }

      const mediaByPost = new Map<number, any[]>();
      for (const mediaItem of media.results as Array<{ post_id: number | null }>) {
        if (!mediaItem.post_id) continue;
        const current = mediaByPost.get(mediaItem.post_id) || [];
        current.push(mediaItem);
        mediaByPost.set(mediaItem.post_id, current);
      }

      const dateOptions = Array.from(
        new Set(
          (posts.results as Array<{ created_at: string }>)
            .map((post) => String(post.created_at).slice(0, 10))
        )
      );
      const tagOptions = Array.from(
        new Set(
          (tags.results as Array<{ name: string }>)
            .map((tag) => tag.name)
            .filter(Boolean)
        )
      );

      const cards = (posts.results as Array<{ id: number; content: string; visibility: string; created_at: string }>)
        .map((post) => {
          const postMedia = mediaByPost.get(post.id) || [];
          const postAppends = appendsByPost.get(post.id) || [];
          const postTagNames = postTags.get(post.id) || [];
          const postDate = String(post.created_at).slice(0, 10);

          const mediaHtml = postMedia.map((item) => {
            if (item.type === 'image') {
              return `<img src="${escapeHtml(item.url)}" alt="" loading="lazy" />`;
            }
            return `<video src="${escapeHtml(item.url)}" controls preload="metadata"></video>`;
          }).join('');

          const tagsHtml = postTagNames.map((tagName) =>
            `<span class="tag">#${escapeHtml(tagName)}</span>`
          ).join('');

          const appendsHtml = postAppends.map((append) => `
            <div class="append">
              <div class="append-time">${escapeHtml(String(append.created_at))}</div>
              <div>${escapeHtml(String(append.content || ''))}</div>
            </div>
          `).join('');

          return `
            <article class="card" data-date="${escapeHtml(postDate)}" data-tags="${escapeHtml(postTagNames.join(','))}">
              <div class="meta">
                <span>${escapeHtml(String(post.created_at))}</span>
                <span class="visibility">${post.visibility === 'private' ? '私密' : '公开'}</span>
              </div>
              ${post.content ? `<div class="content">${escapeHtml(post.content)}</div>` : ''}
              ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ''}
              ${mediaHtml ? `<div class="media">${mediaHtml}</div>` : ''}
              ${appendsHtml ? `<div class="appends">${appendsHtml}</div>` : ''}
            </article>
          `;
        })
        .join('');

      const dateButtons = dateOptions
        .map((date) => `<button class="filter-btn" data-filter-type="date" data-filter-value="${escapeHtml(date)}">${escapeHtml(date)}</button>`)
        .join('');
      const tagButtons = tagOptions
        .map((tag) => `<button class="filter-btn" data-filter-type="tag" data-filter-value="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`)
        .join('');

      const html = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Microblog Export</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f5f7fb; color: #1f2937; }
      .page { max-width: 1120px; margin: 0 auto; padding: 32px 16px 64px; }
      .hero { margin-bottom: 24px; }
      .hero h1 { margin: 0 0 8px; font-size: 32px; }
      .hero p { margin: 0; color: #6b7280; }
      .layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 20px; align-items: start; }
      .sidebar { position: sticky; top: 24px; }
      .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; padding: 18px; margin-bottom: 16px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04); }
      .panel h2 { margin: 0 0 12px; font-size: 18px; }
      .filters { display: flex; flex-wrap: wrap; gap: 10px; }
      .filter-btn { border: 0; border-radius: 999px; background: #eff6ff; color: #1d4ed8; padding: 8px 12px; cursor: pointer; font-size: 14px; }
      .filter-btn.active { background: #1d4ed8; color: #fff; }
      .filter-btn.clear { background: #111827; color: #fff; }
      .results-note { margin-bottom: 14px; color: #6b7280; font-size: 14px; }
      .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; padding: 20px; margin-bottom: 16px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04); }
      .meta { display: flex; justify-content: space-between; gap: 12px; color: #6b7280; font-size: 14px; margin-bottom: 12px; }
      .visibility { background: #f3f4f6; border-radius: 999px; padding: 4px 10px; }
      .content { white-space: pre-wrap; font-size: 18px; line-height: 1.7; }
      .tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
      .tag { background: #eff6ff; color: #1d4ed8; border-radius: 999px; padding: 6px 10px; font-size: 14px; }
      .media { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 14px; }
      .media img, .media video { width: 100%; border-radius: 14px; background: #e5e7eb; }
      .appends { margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
      .append { background: #f9fafb; border-radius: 12px; padding: 12px; margin-top: 10px; }
      .append-time { color: #6b7280; font-size: 12px; margin-bottom: 6px; }
      @media (max-width: 900px) {
        .layout { grid-template-columns: 1fr; }
        .sidebar { position: static; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <h1>Microblog Export</h1>
        <p>导出时间：${escapeHtml(exportData.exported_at)} · ${includePrivate ? '包含全部内容' : '仅公开内容'}</p>
      </section>
      <div class="layout">
        <aside class="sidebar">
          <section class="panel">
            <h2>日期筛选</h2>
            <div class="filters" id="date-filters">
              <button class="filter-btn clear" data-filter-type="date" data-filter-value="">全部日期</button>
              ${dateButtons}
            </div>
          </section>
          <section class="panel">
            <h2>标签筛选</h2>
            <div class="filters" id="tag-filters">
              <button class="filter-btn clear" data-filter-type="tag" data-filter-value="">全部标签</button>
              ${tagButtons}
            </div>
          </section>
        </aside>
        <section>
          <div class="results-note" id="results-note">共 ${posts.results.length} 条内容</div>
          <div id="cards-root">
            ${cards || '<p>暂无可导出的内容。</p>'}
          </div>
        </section>
      </div>
    </main>
    <script>
      (() => {
        const state = { date: '', tag: '' };
        const cards = Array.from(document.querySelectorAll('.card'));
        const note = document.getElementById('results-note');
        const buttons = Array.from(document.querySelectorAll('.filter-btn'));

        function syncButtons() {
          buttons.forEach((button) => {
            const type = button.dataset.filterType;
            const value = button.dataset.filterValue || '';
            const active = type && state[type] === value;
            button.classList.toggle('active', !!active);
          });
        }

        function render() {
          let visible = 0;
          cards.forEach((card) => {
            const dateMatch = !state.date || card.dataset.date === state.date;
            const tags = (card.dataset.tags || '').split(',').filter(Boolean);
            const tagMatch = !state.tag || tags.includes(state.tag);
            const show = dateMatch && tagMatch;
            card.style.display = show ? '' : 'none';
            if (show) visible += 1;
          });
          if (note) {
            note.textContent = '当前显示 ' + visible + ' / ${posts.results.length} 条内容';
          }
          syncButtons();
        }

        buttons.forEach((button) => {
          button.addEventListener('click', () => {
            const type = button.dataset.filterType;
            const value = button.dataset.filterValue || '';
            if (!type) return;
            state[type] = value;
            render();
          });
        });

        render();
      })();
    </script>
  </body>
</html>`;

      return c.body(html, 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="microblog-export-${new Date().toISOString().split('T')[0]}.html"`,
      });
    }

    if (format === 'markdown') {
      const postTags = new Map<number, string[]>();
      for (const tag of tags.results as Array<{ name: string; post_ids: string | null }>) {
        if (!tag.post_ids) continue;
        for (const postId of tag.post_ids.split(',').map((id) => Number(id)).filter(Boolean)) {
          const current = postTags.get(postId) || [];
          current.push(tag.name);
          postTags.set(postId, current);
        }
      }

      const appendsByPost = new Map<number, any[]>();
      for (const append of appends.results as Array<{ post_id: number }>) {
        const current = appendsByPost.get(append.post_id) || [];
        current.push(append);
        appendsByPost.set(append.post_id, current);
      }

      const mediaByPost = new Map<number, any[]>();
      for (const mediaItem of media.results as Array<{ post_id: number | null }>) {
        if (!mediaItem.post_id) continue;
        const current = mediaByPost.get(mediaItem.post_id) || [];
        current.push(mediaItem);
        mediaByPost.set(mediaItem.post_id, current);
      }

      const markdownPosts = (posts.results as Array<{
        id: number;
        content: string;
        visibility: string;
        pinned?: number;
        created_at: string;
        updated_at: string;
      }>)
        .map((post) => {
          const postMedia = mediaByPost.get(post.id) || [];
          const postAppends = appendsByPost.get(post.id) || [];
          const postTagNames = postTags.get(post.id) || [];

          const frontmatter = [
            '```yaml',
            `post_id: ${post.id}`,
            `created_at: "${post.created_at}"`,
            `updated_at: "${post.updated_at}"`,
            `visibility: "${post.visibility}"`,
            `pinned: ${post.pinned === 1 ? 'true' : 'false'}`,
            'tags:',
            ...(postTagNames.length > 0 ? postTagNames.map((tagName) => `  - "${tagName.replace(/"/g, '\\"')}"`) : ['  - "microblog"']),
            `media_count: ${postMedia.length}`,
            `append_count: ${postAppends.length}`,
            '```',
          ].join('\n');

          const contentBlock = post.content?.trim()
            ? escapeMarkdown(post.content)
            : '_这条动态没有正文内容_';

          const tagsBlock = postTagNames.length > 0
            ? `\n### 标签\n${postTagNames.map((tagName) => `- #${escapeMarkdown(tagName)}`).join('\n')}\n`
            : '';

          const mediaBlock = postMedia.length > 0
            ? `\n### 媒体\n${postMedia.map((item) =>
                item.type === 'image'
                  ? `- ![](${escapeMarkdown(String(item.url))})`
                  : `- [视频](${escapeMarkdown(String(item.url))})`
              ).join('\n')}\n`
            : '';

          const appendBlock = postAppends.length > 0
            ? `\n### 补充\n${postAppends.map((append) => [
                `#### ${formatMarkdownDate(String(append.created_at))}`,
                '',
                escapeMarkdown(String(append.content || '')),
              ].join('\n')).join('\n\n')}\n`
            : '';

          return [
            `## ${formatMarkdownDate(post.created_at)} · ${post.visibility === 'private' ? '私密' : '公开'}`,
            '',
            frontmatter,
            '',
            contentBlock,
            tagsBlock.trimEnd(),
            mediaBlock.trimEnd(),
            appendBlock.trimEnd(),
          ].filter(Boolean).join('\n\n');
        })
        .join('\n\n---\n\n');

      const markdown = [
        '# Joi 的 Microblog 导出',
        '',
        `导出时间：${formatMarkdownDate(exportData.exported_at)}`,
        `导出范围：${includePrivate ? '包含全部内容' : '仅公开内容'}`,
        '',
        '> 这是 Obsidian 友好的 Markdown 汇总导出。每条动态都带元数据、标签、媒体链接和补充内容。',
        '',
        markdownPosts || '_暂无可导出的内容_',
        '',
      ].join('\n');

      return c.body(markdown, 200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="microblog-export-${new Date().toISOString().split('T')[0]}.md"`,
      });
    }

    // Return JSON
    return c.json({
      success: true,
      data: exportData,
    });

  } catch (error) {
    console.error('Export error:', error);
    return c.json({
      success: false,
      error: { code: 'EXPORT_FAILED', message: 'Failed to export data' },
    }, 500);
  }
});

// Export single post
exportRouter.get('/post/:id', authMiddleware, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));

  if (isNaN(id)) {
    return c.json({
      success: false,
      error: { code: 'INVALID_ID', message: 'Invalid post ID' },
    }, 400);
  }

  try {
    // Get post with all relations
    const post = await db.prepare(
      'SELECT * FROM posts WHERE id = ?'
    ).bind(id).first();

    if (!post) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Post not found' },
      }, 404);
    }

    const appends = await db.prepare(
      'SELECT * FROM appends WHERE post_id = ? ORDER BY created_at'
    ).bind(id).all();

    const media = await db.prepare(
      'SELECT * FROM media WHERE post_id = ? ORDER BY created_at'
    ).bind(id).all();

    const tags = await db.prepare(`
      SELECT t.* FROM tags t
      JOIN post_tags pt ON t.id = pt.tag_id
      WHERE pt.post_id = ?
    `).bind(id).all();

    return c.json({
      success: true,
      data: {
        post: {
          ...post,
          appends: appends.results,
          media: media.results,
          tags: tags.results,
        },
      },
    });

  } catch (error) {
    console.error('Export post error:', error);
    return c.json({
      success: false,
      error: { code: 'EXPORT_FAILED', message: 'Failed to export post' },
    }, 500);
  }
});
