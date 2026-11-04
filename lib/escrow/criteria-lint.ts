// Acceptance criteria the reviewer can't check from a delivery ("looks modern", "bug-free", "the
// client is happy") end with the deal handed back to the client, which is what escrow by proof is
// meant to avoid. This flags them while the deal is being written, with what to say instead. Plain
// rules, no model call, so it runs as the client types.

export type CriterionHint = { word: string; hint: string };

const RULES: [RegExp, string, RegExp?][] = [
  [/\b(modern|beautiful|nice|clean|sleek|stylish|attractive|appealing|polished|elegant|pretty|cool|amazing|awesome|perfect|great|good|warm|(?<!user[- ])friendly|fun|playful|bold|fresh|catchy|memorable|inviting|cozy|cosy|vibrant|eye[- ]catching)\b/i, 'is a matter of taste. Say what the reviewer can see: colours, fonts, sections, sizes.'],
  [/\b(professional|high[- ]quality|best|excellent|premium|top[- ]notch)\b/i, "can't be measured. Name what makes it so: a format, a resolution, a word count, a source."],
  [/\b(user[- ]friendly|intuitive|easy to use|simple to use|seamless)\b/i, 'needs a user to judge. Name a concrete check: "the booking form has at most 4 fields".'],
  // Fine once it has a number ("loads in under 2 s").
  [/\b(fast|quick|responsive|performant|snappy)\b/i, 'needs a number: "loads in under 2 s on the page test", "works at 375 px wide".', /\d/],
  [/\b(bug[- ]free|no bugs|without (any )?(bugs|errors)|works perfectly|fully tested|tested thoroughly)\b/i, "can't be proven from a delivery. Ask for tests that pass, or name the cases that must work."],
  [/\b(client|customer|we|i)\b.{0,20}\b(happy|satisfied|like|likes|love|loves|approve|approves)\b/i, "depends on the client's opinion, so the AI would hand it back. Write down what would make you happy."],
  [/\b(etc\.?|and so on|and more|as needed|if needed|where appropriate)\b/i, 'leaves the scope open. List every item instead.'],
  [/\b(all devices|every browser|all browsers|any device)\b/i, 'is not checkable as written. Name the browsers or screen widths.'],
];

/** The first thing in a criterion the reviewer couldn't verify, or null when it reads as checkable. */
export function criterionHint(text: string): CriterionHint | null {
  const t = text.trim();
  if (t.length < 3) return null;
  for (const [rule, hint, unless] of RULES) {
    const m = t.match(rule);
    if (m && !unless?.test(t)) return { word: m[0], hint };
  }
  if (!/\s/.test(t)) return { word: t, hint: 'is a single word. Say what has to be delivered and how the reviewer can tell.' };
  return null;
}

/**
 * Two criteria that can't both be met ("exactly 12 lines" and "at least 15 lines"): bounds on the same
 * counted thing that don't overlap. The deal would end in a dispute however good the work, so it's
 * refused while it's written. Null when the counts fit together.
 */
export function criteriaConflict(criteria: string[]): string | null {
  const bounds = new Map<string, { lo: number; hi: number; from: string[] }>();
  const unit = (w: string) => w.toLowerCase().replace(/(es|s)$/, '');
  const N = String.raw`(\d+)\s+([a-z]+)`;
  const forms: [RegExp, (a: number, b?: number) => [number, number]][] = [
    [new RegExp(String.raw`\bexactly\s+${N}`, 'gi'), (a) => [a, a]],
    [new RegExp(String.raw`\b(?:at least|no fewer than|minimum of|a minimum of)\s+${N}`, 'gi'), (a) => [a, Infinity]],
    // "no X is more than 30 words" is a negation the rules can't read, so a bare "more than" is left alone.
    [new RegExp(String.raw`\b(?:at most|no more than|not more than|maximum of|a maximum of|up to)\s+${N}`, 'gi'), (a) => [-Infinity, a]],
    [new RegExp(String.raw`\b(?:fewer|less) than\s+${N}`, 'gi'), (a) => [-Infinity, a - 1]],
  ];
  for (const text of criteria) {
    for (const [re, range] of forms) {
      for (const m of text.matchAll(re)) {
        const [lo, hi] = range(Number(m[1]));
        const key = unit(m[2]);
        const b = bounds.get(key) ?? { lo: -Infinity, hi: Infinity, from: [] };
        b.lo = Math.max(b.lo, lo);
        b.hi = Math.min(b.hi, hi);
        b.from.push(m[0]);
        bounds.set(key, b);
        if (b.lo > b.hi) return `"${b.from.join('" and "')}" can't both be true. Pick one number.`;
      }
    }
    // "40 to 80 words", "between 40 and 80 words"
    for (const m of text.matchAll(/\b(?:between\s+)?(\d+)\s*(?:to|and|-|–)\s*(\d+)\s+([a-z]+)/gi)) {
      const key = unit(m[3]);
      const b = bounds.get(key) ?? { lo: -Infinity, hi: Infinity, from: [] };
      b.lo = Math.max(b.lo, Number(m[1]));
      b.hi = Math.min(b.hi, Number(m[2]));
      b.from.push(m[0]);
      bounds.set(key, b);
      if (b.lo > b.hi) return `"${b.from.join('" and "')}" can't both be true. Pick one number.`;
    }
  }
  return null;
}
