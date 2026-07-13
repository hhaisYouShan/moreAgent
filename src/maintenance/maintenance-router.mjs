const ROUTES = Object.freeze({
  INCIDENT: { targetPhase: 'IMPLEMENTATION', ownerRole: 'incident-response', requiredEvidence: ['incident-evidence', 'health-check', 'logs'], priority: 'P0' },
  SECURITY: { targetPhase: 'IMPLEMENTATION', ownerRole: 'security', requiredEvidence: ['security-finding', 'affected-components'], priority: 'P0' },
  BUG: { targetPhase: 'IMPLEMENTATION', ownerRole: 'developer', requiredEvidence: ['reproduction', 'expected-vs-actual'], priority: 'P1' },
  PERFORMANCE: { targetPhase: 'TECHNICAL_DESIGN', ownerRole: 'architecture', requiredEvidence: ['profile', 'baseline', 'target'], priority: 'P1' },
  DEPENDENCY_UPDATE: { targetPhase: 'IMPLEMENTATION', ownerRole: 'dependency-maintenance', requiredEvidence: ['advisory-or-release-notes', 'compatibility-impact'], priority: 'P2' },
  CHANGE_REQUEST: { targetPhase: 'PRODUCT_DESIGN', ownerRole: 'product', requiredEvidence: ['requested-outcome', 'business-rationale'], priority: 'P2' },
  EXPERIENCE: { targetPhase: 'PRODUCT_DESIGN', ownerRole: 'product-experience', requiredEvidence: ['user-feedback', 'affected-flow'], priority: 'P2' },
  OBSERVABILITY: { targetPhase: 'TECHNICAL_DESIGN', ownerRole: 'operations', requiredEvidence: ['missing-signal', 'operational-impact'], priority: 'P2' },
});

export function routeMaintenanceItem({ itemId, itemType, projectId, workflowId, summary, evidence = {}, severity = null, createdAt = new Date().toISOString() } = {}) {
  for (const [name, value] of Object.entries({ itemId, itemType, projectId, workflowId, summary })) {
    if (!value) throw new TypeError(`${name} is required`);
  }
  const normalizedType = String(itemType).trim().toUpperCase().replace(/[ -]/g, '_');
  const route = ROUTES[normalizedType];
  if (!route) throw maintenanceError('MAINTENANCE_TYPE_UNSUPPORTED', `Unsupported maintenance item type: ${itemType}.`);

  const missingEvidence = route.requiredEvidence.filter((key) => !evidence[key]);
  const priority = severity === 'BLOCKING' ? 'P0' : severity === 'MAJOR' && route.priority === 'P2' ? 'P1' : route.priority;
  const status = missingEvidence.length ? 'NEEDS_EVIDENCE' : 'READY';

  return Object.freeze({
    schemaVersion: '1.0',
    entityType: 'MAINTENANCE_ITEM',
    itemId,
    itemType: normalizedType,
    projectId,
    workflowId,
    summary,
    severity,
    priority,
    status,
    targetPhase: route.targetPhase,
    primaryOwnerRole: route.ownerRole,
    requiredEvidence: Object.freeze([...route.requiredEvidence]),
    missingEvidence: Object.freeze(missingEvidence),
    evidence: Object.freeze({ ...evidence }),
    createdAt,
    nextAction: status === 'READY' ? 'CREATE_MAINTENANCE_WORKFLOW' : 'COLLECT_REQUIRED_EVIDENCE',
  });
}

export function createMaintenanceWorkflowSeed(item) {
  if (item?.status !== 'READY') throw maintenanceError('MAINTENANCE_ITEM_NOT_READY', 'Maintenance item requires all evidence before workflow creation.');
  return Object.freeze({
    schemaVersion: '1.0',
    entityType: 'WORKFLOW_SEED',
    projectId: item.projectId,
    parentWorkflowId: item.workflowId,
    sourceItemId: item.itemId,
    goal: item.summary,
    initialPhase: item.targetPhase,
    ownerRole: item.primaryOwnerRole,
    priority: item.priority,
    evidence: item.evidence,
  });
}

export function maintenanceRoutes() {
  return ROUTES;
}

function maintenanceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
