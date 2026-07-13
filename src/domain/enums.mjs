function defineEnum(values) {
  return Object.freeze(Object.fromEntries(values.map((value) => [value, value])));
}

export const ProjectType = defineEnum(['NEW_PROJECT', 'EXISTING_REFACTOR']);

export const WorkflowPhase = defineEnum([
  'INTAKE',
  'PRODUCT_DESIGN',
  'MULTI_ROLE_REVIEW',
  'TECHNICAL_DESIGN',
  'TASK_PLANNING',
  'IMPLEMENTATION',
  'REVIEW',
  'INTEGRATION',
  'SYSTEM_TEST',
  'PRODUCT_ACCEPTANCE',
  'USER_ACCEPTANCE',
  'RELEASE',
  'MAINTENANCE',
  'ARCHIVED',
]);

export const WorkflowStatus = defineEnum([
  'DRAFT',
  'READY',
  'RUNNING',
  'WAITING',
  'BLOCKED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'ARCHIVED',
]);

export const TaskStatus = defineEnum([
  'DRAFT',
  'BLOCKED',
  'READY',
  'RUNNING',
  'WAITING_REVIEW',
  'WAITING_RECHECK',
  'APPROVED',
  'FAILED',
  'CANCELLED',
  'SUPERSEDED',
]);

export const RunStatus = defineEnum([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
  'STALE',
]);

export const GateConclusion = defineEnum([
  'APPROVED',
  'CHANGES_REQUESTED',
  'BLOCKED',
  'FAILED',
]);

export const IssueSeverity = defineEnum(['BLOCKING', 'MAJOR', 'MINOR']);
export const IssueStatus = defineEnum(['OPEN', 'IN_PROGRESS', 'READY_FOR_RECHECK', 'CLOSED', 'DEFERRED']);
export const DecisionType = defineEnum([
  'AUTO_FIXABLE',
  'HUMAN_DECISION_REQUIRED',
  'SYSTEM_RECOVERY_REQUIRED',
  'SECURITY_APPROVAL_REQUIRED',
  'DEFERRED',
]);

export const ArtifactStatus = defineEnum(['DRAFT', 'ACTIVE', 'SUPERSEDED', 'REJECTED', 'ARCHIVED']);
export const AcceptanceType = defineEnum(['PRODUCT', 'USER']);
export const AcceptanceStatus = defineEnum(['PENDING', 'APPROVED', 'REJECTED']);

export const CANONICAL_ENUMS = Object.freeze({
  ProjectType,
  WorkflowPhase,
  WorkflowStatus,
  TaskStatus,
  RunStatus,
  GateConclusion,
  IssueSeverity,
  IssueStatus,
  DecisionType,
  ArtifactStatus,
  AcceptanceType,
  AcceptanceStatus,
});

export function enumValues(enumObject) {
  return Object.freeze(Object.values(enumObject));
}

export function assertEnumValue(enumObject, value, name = 'value') {
  if (!Object.values(enumObject).includes(value)) {
    throw new TypeError(`${name} must be one of: ${Object.values(enumObject).join(', ')}`);
  }
  return value;
}
