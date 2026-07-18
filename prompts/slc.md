---
description: Shape an idea as Simple, Lovable, and Complete before planning implementation
argument-hint: "[product|design|slice] [idea]"
---
Use the framework from this workspace as Overseer.

Invoke the `slc-product-concept` skill; it is the authoritative source for mode semantics, procedure, completion checks, validation, and output shape. Read only the framework-required base files and the smallest relevant workspace/project/task context.

Request: $ARGUMENTS

Treat an initial `product`, `design`, or `slice` argument as the requested mode. Otherwise infer the most likely mode and state the assumption. Ask one concise question only when ambiguity would materially change the result.

Do not create or edit files unless the user requests a durable artifact/task or current framework/task context requires it. For implementation or documentation changes, follow the framework task and engineering rules.
