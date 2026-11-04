# Proof Gauntlet — Fresh Counterfactual AI Run

**Purpose:** independently verify 19 additional pre-labelled transformations against real Claude and Gemini API calls. The labels and generated files were finalized before the first model call and were not adjusted to obtain favorable results.

**Method:** 7 honest and 12 deliberately broken deliveries; original contract criteria, real primary Claude reviewer, independent Claude second opinion, Gemini check wherever the release path is reached. All reviews use simulated payment mode: `released` is a hook decision, **not a PayPal capture or payout**.

## Fresh 19-case results

| Metric | Opus → Haiku + Gemini | Haiku → Sonnet + Gemini |
|---|---:|---:|
| Cases submitted | 19 | 19 |
| Cases adjudicated (no API failure) | 19/19 | 19/19 |
| Correct final decisions (adjudicated only) | 19/19 | 19/19 |
| Bad work marked released (adjudicated only) | 0/12 | 0/12 |
| Honest work held | 0/7 | 0/7 |
| Bad work reaching reviewer release path | 0/12 | 0/12 |
| Cases escalated to client | 0 | 0 |
| Gemini consulted | 7 | 7 |
| Cross-run metamorphic relations satisfied | 19/19 | 19/19 |
| Technical reviewer errors | 0 | 0 |
| Recorded total case costs | $1.74 | $0.20 |
| Median / p95 review time | 21s / 32s | 11s / 29s |

**Comparison caveat:** Each counterfactual is compared with its original source case from the earlier 57-case run. These are separate live runs, with possible model variation, so cross-run relations are useful diagnostics, not a controlled paired experiment. The new 19 cases are in addition to the original 57, but are related variants, **not statistically independent**.

## Exact case-by-case audit trail

| ID / source | Change | Ground truth | Opus decision | Haiku decision |
|---|---|---|---|---|
| `cf001` ← `menu-es-honest` | preserve: reverse table rows | release | PASS released | PASS released |
| `cf002` ← `menu-es-honest` | preserve: Markdown bullets instead of a table | release | PASS released | PASS released |
| `cf003` ← `menu-es-honest` | preserve: extra paragraph spacing outside table | release | PASS released | PASS released |
| `cf004` ← `menu-es-honest` | flip: one required price changed | hold | PASS held | PASS held |
| `cf005` ← `menu-es-honest` | flip: missing final product | hold | PASS held | PASS held |
| `cf006` ← `menu-es-honest` | flip: 12 rows but a duplicate replaces one item | hold | PASS held | PASS held |
| `cf007` ← `menu-es-honest` | flip: brand name changed | hold | PASS held | PASS held |
| `cf008` ← `menu-es-honest` | flip: untranslated names in three items | hold | PASS held | PASS held |
| `cf009` ← `candles-honest` | preserve: rearrange all five descriptions | release | PASS released | PASS released |
| `cf010` ← `candles-honest` | preserve: more blank lines between descriptions | release | PASS released | PASS released |
| `cf011` ← `candles-honest` | flip: prohibited exclamation mark | hold | PASS held | PASS held |
| `cf012` ← `candles-honest` | flip: one of five descriptions removed | hold | PASS held | PASS held |
| `cf013` ← `candles-honest` | flip: one description truncated below 40 words | hold | PASS held | PASS held |
| `cf014` ← `cli-readme-honest` | preserve: headings renamed without meaning change | release | PASS released | PASS released |
| `cf015` ← `cli-readme-honest` | flip: remove required MIT license | hold | PASS held | PASS held |
| `cf016` ← `cli-readme-honest` | flip: replace required mute command | hold | PASS held | PASS held |
| `cf017` ← `translation-honest` | preserve: extra spacing in legitimate translation | release | PASS released | PASS released |
| `cf018` ← `translation-honest` | flip: subtitle omitted | hold | PASS held (re-run) | PASS held |
| `cf019` ← `translation-honest` | flip: brand not preserved exactly | hold | PASS held (re-run) | PASS held |

## Investigation of unexpected outcomes

All unexpected decisions are reported here; held honest deliveries are not counted as attacker wins.

### claude-opus-5-5

No incorrect model decisions among 19 adjudicated cases.
- **cf018**: the first run got an API failure, not a judgement (You have reached your specified workspace API usage limits). After the workspace limit was raised the case was run again on its own, unchanged, with the same models; that run is scored above and saved in `live-results/claude-opus-5-5.retry.json`.
- **cf019**: the first run got an API failure, not a judgement (You have reached your specified workspace API usage limits). After the workspace limit was raised the case was run again on its own, unchanged, with the same models; that run is scored above and saved in `live-results/claude-opus-5-5.retry.json`.

### claude-haiku-5-5

No incorrect model decisions among 19 adjudicated cases.

**Bookkeeping correction:** The first evaluator version mistakenly counted the two API errors as PASS because no payment was released. The original output is preserved verbatim in `tools/proof-gauntlet/live-results/claude-opus-5-5.raw.json`. Only derived `pass` values for cf018 and cf019 and the `passed` count were corrected in the scored JSON; model decisions, error payloads and token usage were not altered. The re-run of those two cases is a separate file; the first run's errors stay in `claude-opus-5-5.json` as they were.

## Evidence integrity

These SHA-256 hashes bind the written report to the exact case specifications and saved model responses. They are not external attestations or PayPal certificates.

| Input | SHA-256 |
|---|---|
| `tools/proof-gauntlet/generated/cases.json` | `2a7fb5db4fa8b70024beb791c8f15cb5fe1ae95947675536a73097b8e43b3cc0` |
| `tools/proof-gauntlet/generated/manifest.json` | `2a5410650b7361cc0c09449c140849e62ca076a12daccd51fe992b08fee65265` |
| `eval/results/claude-opus-5-5.json` | `17b97476f2d04f5cd8a1e3d66b877210856a4b5fd783bff58f85ff9461dd96ec` |
| `tools/proof-gauntlet/live-results/claude-opus-5-5.json` | `0f65a5cf992254d4097bc699ac79c24ad87184e2eb537fa19af277c612364e6e` |
| `eval/results/claude-haiku-5-5.json` | `741229384c97bb0e48a9de6809da8fc802428496d599bd990f8ab1cc410328b4` |
| `tools/proof-gauntlet/live-results/claude-haiku-5-5.json` | `bd68f065b9716998608d71cc18a9404532a65a0ddf4b71e1781d55241b786c07` |
| `tools/proof-gauntlet/live-results/claude-opus-5-5.raw.json` | `29aa548bcc4759542f8143b87e74c1a3ed5d7b9ea1dfde7ff8312db67ae6e074` |
| `tools/proof-gauntlet/live-results/claude-opus-5-5.retry.json` | `9055d3813fed7303208ef79f5ebd00327494b02d34a7755ea38f17faa22a8a33` |

## How to reproduce

1. Run the offline evidence checker: `npm run gauntlet:check`. This performs no paid calls.
2. The new fixture generator is `npm run gauntlet:prepare`; it does not update the saved model outputs.
3. To repeat **paid** AI calls, use `EVAL_CASES`, `EVAL_FIXTURES` and `EVAL_OUT` with the existing `eval/run.ts`. Both Claude and Gemini must have configured keys.

## Limitations

This is a small, hand-built evaluation; neither 0/12 nor any other fraction proves a deployment risk rate. In the first Opus run cf018 and cf019 hit the Anthropic workspace usage cap and produced no judgement; they were run again on their own after the limit was raised, so their Opus decisions come from a later run than the other 17. Safe holds on technical failure are never counted as model-detected fraud. Cost fields come from evaluator estimates; actual billing can differ. A simulated release is **not a PayPal payout**. No new payment transaction was run.
