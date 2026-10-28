// Acceptance criteria the reviewer can't check from a delivery ("looks modern", "bug-free", "the
// client is happy") end with the deal handed back to the client, which is what escrow by proof is
// meant to avoid. This flags them while the deal is being written, with what to say instead. Plain
// rules, no model call, so it runs as the client types.

export type CriterionHint = { word: string; hint: string };

const RULES: [RegExp, string, RegExp?][] = [
  [/\b(modern|beautiful|nice|clean|sleek|stylish|attractive|appealing|polished|elegant|pretty|cool|amazing|awesome|perfect|great|good)\b/i, 'is a matter of taste. Say what the reviewer can see: colours, fonts, sections, sizes.'],
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
