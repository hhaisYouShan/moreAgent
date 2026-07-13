# Profiles

Profiles express project and delivery differences without changing AI Software Company OS Core semantics.

This directory will contain:

- Workflow Profiles: lifecycle stages, transition policies, and required Gates.
- Agent Profiles: roles, capabilities, permissions, and output contracts.
- Project Profiles: repository layout, technology stack, commands, environments, and protected paths.
- Policy Profiles: budget, concurrency, security, retry, recovery, and approval rules.
- Acceptance Profiles: product, user, release, and maintenance acceptance requirements.

Rules:

- Profiles may configure Core behavior but cannot introduce new Core state semantics.
- Business PRDs, business code, runtime state, and user decisions do not belong here.
- Project-specific values must be validated against stable schemas before use.
