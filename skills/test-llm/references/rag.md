# Retrieval-augmented generation

A RAG answer can be wrong because the right text was not retrieved, or because the model
ignored, misread or embellished what was. Measure the two separately, or every regression looks
like a prompt problem.

## Retrieval

- **Labeled queries:** for each query, the ids of the chunks or documents that answer it
  (graded when some are better than others). Source queries from search logs and support
  questions; label with the people who know the corpus. 100-300 queries is a useful start.
- **Metrics:** recall@k at the k the generator actually receives (if the prompt gets 5 chunks,
  recall@5 is the number that matters), MRR for "is the best one near the top", nDCG when labels
  are graded. Report per slice: short queries, long queries, exact identifiers (SKUs, error
  codes), synonyms, other languages.
- **What it gates:** chunk size and overlap, embedding model, hybrid weights, filters, reranker,
  query rewriting. Run retrieval evals alone for these changes; they are cheap (no generation)
  and deterministic for a fixed index.
- **Index fixtures:** build a small index from a frozen corpus snapshot for tests, so a content
  change does not move retrieval scores. Rebuild it when the chunker or embedding model changes
  and compare per query, as with any baseline.
- **Deterministic tests around retrieval:** filters (tenant, permissions, locale, date) applied
  before ranking, not after; deleted and expired documents absent; deduplication; the token
  budget for context respected with the highest-ranked chunks kept.

## Generation, with retrieval fixed

Feed the generator fixed retrieved context from fixtures, so a prompt change is judged on the
same evidence:

| Property | Check |
| --- | --- |
| Faithfulness | Every claim in the answer is supported by the provided context. Judge per claim: split the answer into statements, ask whether each is entailed |
| Answer relevance | The answer addresses the question asked, not a neighboring one |
| Citation correctness | Every cited id was in the provided context (deterministic); the cited chunk supports the sentence it is attached to (judge) |
| Citation coverage | Claims that need a source have one |
| Abstention | Unanswerable questions (answer not in the corpus, or only in a document the user may not see) get "I don't know" or a handoff, not a guess |
| Conflict handling | When two chunks disagree, the answer says so or prefers the newer source by rule |
| Context position | The answer still uses the relevant chunk when it is placed in the middle of a long context |

Include 10-20% unanswerable questions in the set; a system that always answers scores well on
answerable-only sets.

## End to end

Run the full pipeline on a smaller set to catch interaction effects (a reranker that surfaces
chunks the prompt handles badly), and break results down: retrieval hit and answer correct,
retrieval hit and answer wrong (generation problem), retrieval miss and answer correct (the
model answered from its own knowledge, which is a faithfulness risk), retrieval miss and answer
wrong (retrieval problem).

## Metric libraries

Ragas, DeepEval and the RAG templates in promptfoo, Braintrust and LangSmith implement
faithfulness, context precision and recall, and answer relevance with judge models. Treat them as
judges: calibrate on your labeled cases before gating on their scores, and pin their versions.
