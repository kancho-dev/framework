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
- session transcripts
- work logs
- command histories

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
