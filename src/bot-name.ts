const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** Turn a client label into a bot name, or null when nothing usable remains. */
export function slugBotName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+/, '')
    .replace(/[-_]+$/, '');
  if (value.length > 63) value = value.slice(0, 63).replace(/[-_]+$/, '');
  if (!NAME_RE.test(value)) return null;
  return value;
}

/**
 * Prefer clientInfo.name. When title is present and not the same slug, fold
 * it in so two apps that share a client id can still differ (`cursor` + `Inbox`).
 */
export function originFromClientInfo(info: { name?: string | null; title?: string | null } | null | undefined): string | null {
  if (!info) return null;
  const name = slugBotName(info.name);
  const title = slugBotName(info.title);
  if (name && title && title !== name) return slugBotName(`${name}-${title}`);
  return name ?? title;
}

/** `cursor`, then `cursor-2`, `cursor-3`, staying inside the 63-character name limit. */
export function suffixedBotName(base: string, n: number): string {
  if (n <= 1) return base;
  const extra = `-${n}`;
  const trimmed = base.slice(0, 63 - extra.length).replace(/[-_]+$/, '');
  return `${trimmed}${extra}`;
}
