# Workspace Name

Short description of what this workspace is for.

## Structure

- `projects/` — project coordination areas; each project's `project/` directory is expected to be its own code repository in the default setup
- `framework/` — the framework used as operating guidance in this workspace

## Notes

- use the workspace root for coordination files and default ownership of each project's `library/` and `work/`
- keep project-specific durable knowledge inside each project under `projects/[name]/library/`
- use `projects/[name]/library/deliverables/` only when the project benefits from a separate home for polished reusable outputs
