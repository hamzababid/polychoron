"""Embedding generation for the regulatory knowledge base's pgvector
store. Used both at ingestion time (seeding/hand-loading a document's
chunks) and at retrieval time (embedding the Pattern Matching Agent's
query string).

Note on constitution rule 11 ("no agent node may instantiate an LLM
SDK client directly... every node calls the model inference router"):
this module is platform infrastructure analogous to the router itself
(specs/platform/10-regulatory-knowledge-base-spec.md frames embeddings
as something "platform provides", the same tier as the router), not a
node hardcoding its own provider choice — so it calls OpenAI directly
via settings, the same way router.py's FoundationAPIInferenceClient
does, rather than routing embedding calls through the completion-only
InferenceClient interface. Revisit if a future tenant needs a
self-hosted embedding model — today's single-tenant Phase 1/2 demo
doesn't require that flexibility yet.
"""

from __future__ import annotations

from app.config import settings

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536


def get_embedding(text: str) -> list[float]:
    if not settings.openai_api_key:
        raise RuntimeError(
            "Regulatory knowledge base retrieval requires OPENAI_API_KEY — failing closed "
            "rather than silently skipping the embedding call."
        )
    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    response = client.embeddings.create(model=EMBEDDING_MODEL, input=text)
    return response.data[0].embedding
