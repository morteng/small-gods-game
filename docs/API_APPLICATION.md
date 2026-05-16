# API Access Request — High-Speed Inference Provider

## Intended application

Developing an indie game inspired by Terry Pratchett's "Small Gods." The player is a minor deity who must cultivate genuine belief among NPC followers through indirect influence — whispers, omens, dreams, and miracles. NPCs run on a programmatic simulation layer (beliefs, needs, social relationships) that ticks continuously. The LLM layer activates on demand: when the player interacts with an NPC or observes a scene, the LLM generates rich in-character dialogue and narrative from the compact sim state, then returns structured state changes that feed back into the simulation. Rival spirits compete for the same followers with their own personalities and strategies.

## How will extreme low latency inference help?

When the player whispers to a village elder or answers a farmer's prayer, the NPC must respond in-character within ~200ms to feel alive. The LLM receives a ~500 token prompt (NPC personality, beliefs, recent events, interaction history) and returns ~200 tokens of dialogue plus a structured state delta. At 16k TPS this completes in roughly 12ms, well within the immersion threshold. High throughput is equally critical: when a miracle occurs, every witness NPC needs their reaction resolved in the same game tick — a village of 20 NPCs processing simultaneously rather than serially. The sim layer handles the bulk of NPC state cheaply, but every moment the player pays attention to must be narrated instantly.

## Which open model would be ideal and why?

Llama 3.1 8B. NPC dialogue needs strong instruction-following to maintain consistent character personas across many interactions, plus creative writing for authentic speech. The 8B parameter count hits the sweet spot: capable enough for personality-consistent dialogue and structured JSON output, compact enough to run at extreme speed. The context window supports per-NPC state injection without excessive token cost. We need the model to reliably return both freeform narrative and a JSON state delta in a single response — 8B handles this well with clear system prompts.
