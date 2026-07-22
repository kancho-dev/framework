# Skills Index

Use this index only to choose relevant skills. Do not load every skill by default.

For skill precedence, local/project/workspace skill rules, collision handling, and skill format guidance, read `framework/SKILLS.md`.

| Skill | Use when | Path |
|---|---|---|
| `next-best-actions` | Prioritize the highest-value next actions from current workspace or project state, including work that needs Operator attention. | `framework/SKILLS/next-best-actions/SKILL.md` |
| `slc-product-concept` | Shape a product, design, or implementation idea as Simple, Lovable, and Complete before planning execution. | `framework/SKILLS/slc-product-concept/SKILL.md` |
| `create-workspace-skill` | Assess, create, or update workspace-custom skills for repeated local workflows without changing the reusable framework. | `framework/SKILLS/create-workspace-skill/SKILL.md` |
| `task-pickup` | Pick up an existing tracked task by recovering its authoritative state and choosing one bounded next action. | `framework/SKILLS/task-pickup/SKILL.md` |
| `task-closure` | Reconcile a tracked task after acceptance, deliberate pause, concrete blockage, or wontfix decision. | `framework/SKILLS/task-closure/SKILL.md` |
| `review-and-test` | Review a completed change against both its intended specification and repository standards, test the highest-risk claims, and return an evidence-backed verdict. | `framework/SKILLS/review-and-test/SKILL.md` |
| `docs-sync` | Repair a bounded documentation contradiction or synchronize docs to a completed implementation change; audit all project docs only when explicitly requested. | `framework/SKILLS/docs-sync/SKILL.md` |
| `self-check` | Audit workspace-level coordination health when shared state may have drifted. | `framework/SKILLS/self-check/SKILL.md` |
| `project-self-check` | Reconcile a named project inconsistency or active project state; run a full historical audit only when explicitly requested. | `framework/SKILLS/project-self-check/SKILL.md` |
| `update-framework` | Align an already framework-managed workspace with newer framework changes through an approval-gated update plan. | `framework/SKILLS/update-framework/SKILL.md` |
| `memory-search` | Use the memory system selectively to recover relevant prior context without turning every run into a full-history read. | `framework/SKILLS/memory-search/SKILL.md` |
