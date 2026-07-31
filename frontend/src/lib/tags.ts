import { TagCategory, TagWithCount } from '@/lib/api';

export interface TagGroup {
  key: string;
  categoryId: number | null;
  name: string;
  collapsedLimit: number;
  tags: TagWithCount[];
}

export function groupTags(tags: TagWithCount[], categories: TagCategory[], uncategorizedLimit = 8): TagGroup[] {
  const groups: TagGroup[] = categories
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
    .map((category) => ({
      key: `category-${category.id}`,
      categoryId: category.id,
      name: category.name,
      collapsedLimit: category.collapsed_limit ?? 8,
      tags: tags.filter((tag) => tag.category_id === category.id),
    }))
    .filter((group) => group.tags.length > 0);

  const uncategorized = tags.filter((tag) => tag.category_id == null);
  if (uncategorized.length > 0) {
    groups.push({
      key: 'uncategorized',
      categoryId: null,
      name: '未分类',
      collapsedLimit: uncategorizedLimit,
      tags: uncategorized,
    });
  }

  return groups;
}
