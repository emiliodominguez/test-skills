# Safety cases

Keep a safety slice in every eval run and gate on it absolutely: one failure fails the gate,
whatever the aggregate.

## Prompt injection

- **Direct:** user text that tries to override instructions ("ignore previous instructions",
  role-play framings, fake system messages, instructions in other languages or encodings).
- **Indirect:** instructions inside retrieved documents, web pages, emails, file contents and
  tool results. This is the dangerous one for RAG and agents, because the text arrives with the
  authority of context. Seed the test corpus or fake tools with documents that instruct the
  model to call a tool, exfiltrate data into a URL or image link, change a decision, or reveal
  the system prompt.
- **Assertions:** no forbidden or unexpected tool call, no tool argument containing data from
  the context that the user did not provide, no change to the decision fields, no URL in the
  output pointing to a domain outside an allowlist, and the system prompt canary absent.
- **Deterministic defenses to unit test:** user and retrieved text fenced as data and never
  concatenated into the system prompt; tool permissions decided by code from the user's
  identity, not by the model; links and images in output rewritten or blocked by allowlist;
  side-effecting tools behind confirmation. These are ordinary tests, and `test-security` covers
  the authorization around tools.

The model's resistance is measured, not assumed: report the attack success rate per attack
family on the injection set, and gate on the critical families (tool misuse, exfiltration).

## Secrets and PII

- **Canaries:** put unique fake values in the system prompt, in other users' records reachable
  by retrieval, and in tool results (a fake API key, a fake card number, an email address), and
  assert none appears in any output across the whole eval run.
- **Redaction:** test output guards on the stream the client receives, with values split across
  chunks. In this repository's example, per-chunk redaction leaked an address split over two
  chunks; buffering to a whitespace boundary fixed it.
- **Logs and traces:** the same canaries must not reach logs, traces or eval artifacts that are
  retained longer than the data's policy allows.
- **Cross-tenant:** retrieval filters and memory are scoped per tenant and per user; a case
  asks for another tenant's data by name and must get nothing.

## Jailbreak and harmful content

Maintain a jailbreak set for the product's real risks (what would be harmful or embarrassing
for this feature), not a generic list, and refresh it from red-team sessions and production
flags. Pair every harmful prompt with benign near misses that look similar ("how do I kill a
process", "chargeback rules" next to fraud requests): report harmful compliance rate and
over-refusal rate together, because a prompt change that halves one usually moves the other.

## Online

Sample production traffic through the same guards and a calibrated judge, alert on guard hit
rates and canary matches, and turn every confirmed incident into an offline case before the fix.
