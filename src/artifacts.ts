import * as fs from 'fs';
import * as path from 'path';
import { ARTIFACT_NAMES, ArtifactName } from './types';

const ARTIFACT_TEMPLATES: Record<ArtifactName, string> = {
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
  'brain-plan.md': `# Brain Plan

## Analysis
<!-- Architecture analysis and design decisions -->

## Architecture Overview
<!-- High-level architecture diagram/description -->

## Implementation Plan
<!-- Step-by-step implementation plan -->

1. 
2. 
3. 

## Dependencies
<!-- Dependencies and prerequisites -->

## Risks
<!-- Potential risks and mitigations -->
`,
  'implementation-result.md': `# Implementation Result

## Summary
<!-- Brief summary of what was implemented -->

## Files Changed
<!-- List of files modified/created -->
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
};

export function writeArtifactTemplate(
  artifactDir: string,
  name: ArtifactName
): void {
  const template = ARTIFACT_TEMPLATES[name];
  const filePath = path.join(artifactDir, name);
  fs.writeFileSync(filePath, template, 'utf-8');
}

export function writeAllArtifactTemplates(artifactDir: string): void {
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }
  for (const name of ARTIFACT_NAMES) {
    writeArtifactTemplate(artifactDir, name);
  }
}

export function writePrimaryArtifactTemplate(
  artifactDir: string,
  primaryArtifact: string
): void {
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }
  writeArtifactTemplate(artifactDir, primaryArtifact as ArtifactName);
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
  name: ArtifactName,
  content: string
): void {
  const filePath = path.join(artifactDir, name);
  fs.writeFileSync(filePath, content, 'utf-8');
}

function getExpectedOutput(role: string): string {
  switch (role) {
    case 'architect':
      return 'A detailed brain-plan.md with architecture design and implementation steps.';
    case 'implementer':
      return 'Code changes documented in implementation-result.md with files changed and decisions made.';
    case 'tester':
      return 'Test results in test-report.md with Result: PASS or Result: FAIL near the top, plus coverage metrics.';
    case 'reviewer':
      return 'Review findings in review-report.md with Decision: APPROVED or Decision: CHANGES_REQUESTED near the top, plus issues and recommendations.';
    default:
      return 'Relevant artifacts based on the agent role.';
  }
}
