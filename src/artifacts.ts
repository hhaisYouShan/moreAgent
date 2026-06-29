import * as fs from 'fs';
import * as path from 'path';

const ARTIFACT_TEMPLATES: Record<string, string> = {
  'task.md': `# Task
## Objective
<!-- Task objective will be populated here -->
## Context
<!-- Background context from previous agents -->
## Requirements
<!-- Specific requirements for this agent -->
## Expected Output
<!-- What this agent should produce -->
`,
  'implementation-result.md': `# Implementation Result
## Summary
<!-- Brief summary of what was implemented -->
## Files Changed
| File | Action | Description |
|---|---|---|
| | | |
## Key Decisions
<!-- Important decisions made during implementation -->
## Issues Encountered
<!-- Problems encountered and how they were resolved -->
## Next Steps
<!-- Remaining work or suggestions -->
`,
  'test-report.md': `Result: PASS

# Test Report
<!-- Tester must change the Result line above to exactly one of:
Result: PASS
Result: FAIL
-->
## Summary
<!-- Overall test summary -->
## Test Results
| Test | Status | Duration | Notes |
|---|---|---|---|
| | | | |
## Coverage
<!-- Test coverage metrics -->
## Failures
<!-- Details of any test failures -->
## Recommendations
<!-- Suggestions for additional testing -->
`,
  'review-report.md': `Decision: APPROVED

# Review Report
<!-- Reviewer must change the Decision line above to exactly one of:
Decision: APPROVED
Decision: CHANGES_REQUESTED
-->
## Summary
<!-- Overall review summary -->
## Code Quality
<!-- Assessment of code quality -->
## Issues Found
| Severity | File | Line | Description |
|---|---|---|---|
| | | | |
## Test Coverage Review
<!-- Assessment of test quality and coverage -->
## Recommendations
<!-- Actionable feedback for improvements -->
`,
  'prd.md': `# Product Requirements Document
## Overview
<!-- Product overview and goals -->
## Scope
<!-- In scope / out of scope -->
## User Stories
1.
2.
3.
## Acceptance Criteria
1.
2.
3.
## Open Questions
<!-- Unresolved items -->
`,
  'frontend-plan.md': `# Frontend Implementation Plan
## Overview
<!-- Frontend architecture decisions -->
## Component Tree
<!-- Component hierarchy -->
## Route Design
<!-- Route structure -->
## State Management
<!-- State strategy -->
## Implementation Steps
1.
2.
3.
`,
  'backend-plan.md': `# Backend Implementation Plan
## Overview
<!-- Backend architecture decisions -->
## API Design
<!-- Endpoint specifications -->
## Data Model
<!-- Schema design -->
## Implementation Steps
1.
2.
3.
`,
  'test-plan.md': `# Test Plan
## Scope
<!-- What is being tested -->
## Test Strategy
<!-- Approach and tools -->
## Test Cases
| ID | Description | Expected Result |
|---|---|---|
| | | |
## Coverage Targets
<!-- Desired coverage levels -->
`,
  'product-review.md': `# Product Review
## Summary
<!-- Overall product review -->
## Requirement Completeness
<!-- Assessment of requirements -->
## Scope Alignment
<!-- Is the implementation aligned with PRD -->
## Issues
| Severity | Description |
|---|---|
| | |
`,
  'output.md': `# Output
<!-- Agent output placeholder -->
`,
  'brain-plan.md': `# Brain Plan
## Task Analysis
<!-- High-level analysis of the task -->
## Work Phases
1.
2.
3.
## Dependencies
<!-- Cross-cutting concerns -->
`,
  'frontend-prd-review.md': `Decision: CHANGES_REQUESTED

# Frontend PRD Review
## Feasibility
<!-- Technical feasibility assessment -->
## UI Concerns
<!-- UI/UX considerations -->
## Issues
| Severity | Description |
|---|---|
| | |
`,
  'backend-prd-review.md': `Decision: CHANGES_REQUESTED

# Backend PRD Review
## Feasibility
<!-- Technical feasibility assessment -->
## API / Data Concerns
<!-- API and data model considerations -->
## Issues
| Severity | Description |
|---|---|
| | |
`,
  'test-prd-review.md': `Decision: CHANGES_REQUESTED

# Test PRD Review
## Testability
<!-- Assessment of testability -->
## Coverage Concerns
<!-- Coverage gaps in the PRD -->
## Issues
| Severity | Description |
|---|---|
| | |
`,
  'prd-decision.md': `Decision: APPROVED

# PRD Gate Decision
## Verdict
<!-- APPROVED or CHANGES_REQUESTED -->
## Issues Addressed
<!-- Summary of resolved issues -->
## Remaining Concerns
<!-- Any unresolved items -->
`,
  'tech-review.md': `Decision: APPROVED

# Technical Review
## Verdict
<!-- APPROVED or CHANGES_REQUESTED -->
## Architecture Assessment
<!-- Overall architecture quality -->
## Issues
| Component | Severity | Description |
|---|---|---|
| | | |
`,
  'frontend-implementation.md': `# Frontend Implementation
## Summary
<!-- What was implemented -->
## Files Changed
| File | Action | Description |
|---|---|---|
| | | |
## Key Decisions
<!-- Important choices made -->
`,
  'backend-implementation.md': `# Backend Implementation
## Summary
<!-- What was implemented -->
## Files Changed
| File | Action | Description |
|---|---|---|
| | | |
## Key Decisions
<!-- Important choices made -->
`,

};

export function writeArtifactTemplate(
  artifactDir: string,
  name: string
): void {
  const template = ARTIFACT_TEMPLATES[name] || `# ${name}\n<!-- Agent output -->\n`;
  const filePath = path.join(artifactDir, name);
  fs.writeFileSync(filePath, template, 'utf-8');
}

export function writePrimaryArtifactTemplate(
  artifactDir: string,
  primaryArtifact: string
): void {
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }
  writeArtifactTemplate(artifactDir, primaryArtifact);
}

export function writeTaskMarkdown(
  artifactDir: string,
  agentName: string,
  agentRole: string,
  task: string,
  context: string
): void {
  const content = `# Task

## Agent: ${agentName} (${agentRole})

## Objective
${task}

## Context
${context || 'None — this is the first agent in the pipeline.'}

## Requirements
Refer to the agent prompt and role description for specific requirements.

## Expected Output
${getExpectedOutput(agentRole)}
`;
  fs.writeFileSync(path.join(artifactDir, 'task.md'), content, 'utf-8');
}

export function updateArtifact(
  artifactDir: string,
  name: string,
  content: string
): void {
  const filePath = path.join(artifactDir, name);
  fs.writeFileSync(filePath, content, 'utf-8');
}

function getExpectedOutput(role: string): string {
  switch (role) {
    case 'architect':
    case 'product':
      return 'A detailed plan document with design and implementation steps.';
    case 'implementer':
    case 'frontend':
    case 'backend':
      return 'Code changes documented with files changed and decisions made.';
    case 'tester':
      return 'Test results with Result: PASS or Result: FAIL near the top, plus coverage metrics.';
    case 'reviewer':
      return 'Review findings with Decision: APPROVED or Decision: CHANGES_REQUESTED near the top, plus issues and recommendations.';
    default:
      return 'Relevant artifacts based on the agent role.';
  }
}
