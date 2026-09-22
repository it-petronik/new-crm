export function pageWindow(total: number, requested: number, size: number) {
  const pageSize = Math.max(1, Math.floor(size) || 10);
  const count = Math.max(0, Math.floor(total) || 0);
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const page = Math.min(pages, Math.max(1, Math.floor(requested) || 1));
  const start = (page - 1) * pageSize;
  return {
    page,
    pages,
    start,
    end: Math.min(start + pageSize, count),
    total: count,
    pageSize,
  };
}
