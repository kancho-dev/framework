# Adapters

The memory service should be fed by adapters, not by one hardcoded platform.

## Adapter Responsibility

Each adapter converts platform-specific session artifacts into the common records:
- messages
- sessions
- work reports
- lessons

## Example Adapters

### OpenCode adapter

Input examples:
- JSONL session transcripts
- work logs exported as newline-delimited JSON
- command histories when they are emitted as transcript events

Current v1 implementation note:
- the first importer targets a single OpenCode JSONL transcript file
- it normalizes one session plus message and optional `work_report` records
- it preserves timestamps and source provenance where available
- it strips thinking/tool-only blocks from stored message content

### Pi adapter

Input examples:
- exported chat logs
- structured notes
- task outputs

### Manual adapter

Input examples:
- markdown logs
- JSON exports
- copied transcripts

## Adapter Rules

1. Preserve timestamps if available.
2. Preserve source type if available.
3. Strip hidden reasoning and irrelevant tool noise if that data exists.
4. Do not invent structure the source does not contain.
5. Make ingestion idempotent where possible.
