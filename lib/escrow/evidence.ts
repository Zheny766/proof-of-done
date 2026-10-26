// Small helpers for handling what a freelancer submits. Everything in a submission is chosen by the
// person who wants to get paid, so it is treated as untrusted on the way into the reviewer.

/**
 * Wrap text in <tag>...</tag> so the reviewer can tell evidence from instructions. A closing tag
 * inside the text would end the block early, so it is defused first.
 */
export function fence(tag: string, text: string, attrs = ''): string {
  const safe = text.replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1');
  return `<${tag}${attrs ? ` ${attrs}` : ''}>\n${safe}\n</${tag}>`;
}

/** A file name as it may appear in the prompt: one line, no quotes or angle brackets, bounded. */
export const cleanName = (name: string) => name.replace(/[\r\n\t"<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file';

export const normalHost = (host: string) => host.toLowerCase().replace(/\.+$/, '');

/**
 * Hosts the reviewer may open: those of the submitted links and of any URL written in the notes.
 * Without this, a prompt-injected reviewer could be told to "check" https://attacker.example/?q=...
 * and leak the brief through the URL.
 */
export function submittedHosts(links: string[], notes: string): Set<string> {
  const hosts = new Set<string>();
  for (const candidate of [...links, ...(notes.match(/https?:\/\/[^\s<>"')]+/gi) ?? [])]) {
    try {
      // "see https://site.example." - the sentence's full stop is not part of the host.
      hosts.add(normalHost(new URL(candidate.replace(/[.,;:!?]+$/, '')).hostname));
    } catch {
      // not a URL after all
    }
  }
  return hosts;
}

/**
 * The type of an upload, decided from its first bytes rather than from what the browser claimed:
 * a text file renamed to .png would otherwise be sent to Claude as an image and fail the review.
 */
export function sniffType(bytes: Uint8Array, claimed: string): string {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (claimed.startsWith('image/') || claimed === 'application/pdf') return 'application/octet-stream';
  return claimed || 'application/octet-stream';
}

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/**
 * Visible text of an HTML page, in one forward pass. (A regex like /<script[\s\S]*?<\/script>/ goes
 * quadratic on a page full of unclosed <script> tags: a hostile site could stall the server.)
 */
export function htmlToText(html: string): string {
  const parts: string[] = [];
  const closing = { script: /<\/script/gi, style: /<\/style/gi };
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      parts.push(html.slice(i));
      break;
    }
    parts.push(html.slice(i, lt), ' ');
    const head = html.slice(lt, lt + 7).toLowerCase();
    const raw = head.startsWith('<script') ? 'script' : head.startsWith('<style') ? 'style' : null;
    let from = lt;
    if (raw) {
      // Skip the element's contents; an unclosed one runs to the end of the page.
      const re = closing[raw];
      re.lastIndex = lt;
      const close = re.exec(html);
      if (!close) break;
      from = close.index;
    }
    const gt = html.indexOf('>', from);
    if (gt === -1) break;
    i = gt + 1;
  }
  return parts
    .join('')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim();
}
