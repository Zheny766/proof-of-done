/** Whether the reviewer actually reached the expected *decision*.
 * A technical API failure must never masquerade as a successful refusal to pay.
 */
export function casePass(expected: 'release' | 'hold', released: boolean, decision: string): boolean {
  return decision !== 'error' && (expected === 'release') === released;
}
