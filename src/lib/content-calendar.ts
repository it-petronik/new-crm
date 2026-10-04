import type { RecordItem } from './domain';
export const contentChannels = ['Instagram', 'Facebook', 'LinkedIn', 'WhatsApp', 'YouTube', 'TikTok'] as const;
export const contentStages = ['Idea', 'Draft', 'Ready', 'Published manually'] as const;
export const contentFormats = ['Image', 'Carousel', 'Video', 'Story', 'Text'] as const;
export function isContentPost(r: Pick<RecordItem, 'kind' | 'attributes'>) { return r.kind === 'marketing' && r.attributes?.contentType === 'social-post'; }
export function contentError(r: Pick<RecordItem, 'kind' | 'attributes' | 'title' | 'product' | 'due' | 'detail'>): string {
  if (!isContentPost(r)) return '';
  const a = r.attributes || {};
  if (r.title.trim().length < 2 || r.title.length > 160) return 'Add a post title between 2 and 160 characters.';
  if (!contentChannels.includes(r.product as typeof contentChannels[number])) return 'Choose a social channel.';
  if (!contentStages.includes(a.contentStage as typeof contentStages[number])) return 'Choose a planning stage.';
  if (!contentFormats.includes(a.contentFormat as typeof contentFormats[number])) return 'Choose a content format.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.due) || !Number.isFinite(Date.parse(r.due)) || new Date(r.due).toISOString().slice(0,10) !== r.due) return 'Choose a valid planned date.';
  if (a.contentTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.contentTime)) return 'Choose a valid posting time.';
  if (a.contentTimezone !== 'Asia/Dubai') return 'Posting times use Dubai time (GST).';
  if (r.detail.length > 5000) return 'Caption must be 5,000 characters or fewer.';
  if (a.contentAsset) { try { const url = new URL(a.contentAsset); if (!['https:', 'http:'].includes(url.protocol) || a.contentAsset.length > 300) return 'Use a web link of up to 300 characters for the asset.'; } catch { return 'Enter a valid asset link.'; } }
  return '';
}
export function calendarDays(month: string): (string | null)[] {
  const [year, m] = month.split('-').map(Number);
  const offset = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from({length: Math.ceil((offset + count) / 7) * 7}, (_, i) => i < offset || i >= offset + count ? null : `${month}-${String(i - offset + 1).padStart(2,'0')}`);
}
