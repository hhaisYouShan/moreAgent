import { spawnSync } from 'node:child_process';

export function createReleaseService({ runCommand = defaultRunCommand, now = () => new Date().toISOString() } = {}) {
  return Object.freeze({
    async release({
      releaseId,
      projectId,
      workflowId,
      integrationCommit,
      targetEnvironment,
      userAcceptance,
      migrationCommands = [],
      releaseCommands = [],
      healthChecks = [],
      rollbackCommands = [],
      rollbackPlan,
      highRisk = false,
      riskApproval = null,
      autoRollback = true,
    } = {}) {
      for (const [name, value] of Object.entries({ releaseId, projectId, workflowId, integrationCommit, targetEnvironment, rollbackPlan })) {
        if (!value) throw new TypeError(`${name} is required`);
      }
      assertUserAcceptance(userAcceptance, integrationCommit);
      if (highRisk && riskApproval?.status !== 'APPROVED') {
        throw releaseError('SECURITY_APPROVAL_REQUIRED', 'High-risk release requires explicit security/risk approval.');
      }

      const startedAt = timestamp(now);
      const migrationResults = [];
      const releaseResults = [];
      const healthResults = [];
      const rollbackResults = [];
      let sideEffectsStarted = false;
      let failureStage = null;
      let failureReason = null;

      try {
        for (const specification of migrationCommands) {
          sideEffectsStarted = true;
          const result = await executeEvidence(runCommand, specification, integrationCommit, targetEnvironment, now, 'migration', migrationResults.length + 1);
          migrationResults.push(result);
          if (result.exitCode !== 0) {
            failureStage = 'MIGRATION';
            failureReason = 'migration_failed';
            break;
          }
        }

        if (!failureStage) {
          for (const specification of releaseCommands) {
            sideEffectsStarted = true;
            const result = await executeEvidence(runCommand, specification, integrationCommit, targetEnvironment, now, 'release', releaseResults.length + 1);
            releaseResults.push(result);
            if (result.exitCode !== 0) {
              failureStage = 'RELEASE';
              failureReason = 'release_command_failed';
              break;
            }
          }
        }

        if (!failureStage) {
          for (const specification of healthChecks) {
            const result = await executeEvidence(runCommand, specification, integrationCommit, targetEnvironment, now, 'health', healthResults.length + 1);
            healthResults.push(result);
            if (result.exitCode !== 0) {
              failureStage = 'HEALTH_CHECK';
              failureReason = 'health_check_failed';
              break;
            }
          }
        }
      } catch (error) {
        failureStage ||= 'SYSTEM';
        failureReason = error?.message || String(error);
      }

      let releaseStatus = failureStage ? 'FAILED' : 'RELEASED';
      let rollbackFailure = null;
      if (failureStage && autoRollback && sideEffectsStarted) {
        for (const specification of rollbackCommands) {
          try {
            const result = await executeEvidence(runCommand, specification, integrationCommit, targetEnvironment, now, 'rollback', rollbackResults.length + 1);
            rollbackResults.push(result);
            if (result.exitCode !== 0) {
              rollbackFailure = 'rollback_command_failed';
              break;
            }
          } catch (error) {
            rollbackFailure = error?.message || String(error);
            break;
          }
        }
        if (!rollbackFailure && rollbackCommands.length) releaseStatus = 'ROLLED_BACK';
      }

      const finishedAt = timestamp(now);
      const evidence = Object.freeze({
        schemaVersion: '1.0',
        entityType: 'RELEASE_EVIDENCE',
        releaseEvidenceId: `release-evidence-${releaseId}`,
        releaseId,
        projectId,
        workflowId,
        integrationCommit,
        targetEnvironment,
        userAcceptanceId: userAcceptance.acceptanceId,
        riskApprovalId: riskApproval?.decisionId || null,
        migrationResults: Object.freeze(migrationResults),
        releaseResults: Object.freeze(releaseResults),
        healthChecks: Object.freeze(healthResults),
        rollbackPlan,
        rollbackResults: Object.freeze(rollbackResults),
        status: releaseStatus,
        failureStage,
        failureReason,
        rollbackFailure,
        createdAt: startedAt,
        finishedAt,
      });

      const incident = failureStage
        ? Object.freeze({
            schemaVersion: '1.0',
            entityType: 'INCIDENT',
            incidentId: `incident-${releaseId}`,
            projectId,
            workflowId,
            releaseId,
            integrationCommit,
            targetEnvironment,
            severity: failureStage === 'HEALTH_CHECK' ? 'MAJOR' : 'BLOCKING',
            status: releaseStatus === 'ROLLED_BACK' ? 'MITIGATED' : 'OPEN',
            failureStage,
            failureReason,
            rollbackFailure,
            evidenceId: evidence.releaseEvidenceId,
            createdAt: finishedAt,
          })
        : null;

      return Object.freeze({
        released: releaseStatus === 'RELEASED',
        rolledBack: releaseStatus === 'ROLLED_BACK',
        status: releaseStatus,
        evidence,
        incident,
      });
    },
  });
}

function assertUserAcceptance(acceptance, integrationCommit) {
  if (!acceptance || acceptance.acceptanceType !== 'USER' || acceptance.status !== 'APPROVED') {
    throw releaseError('USER_ACCEPTANCE_REQUIRED', 'Release requires approved USER acceptance.');
  }
  const acceptedCommit = acceptance.integrationCommit || acceptance.baselineCommit;
  if (acceptedCommit && acceptedCommit !== integrationCommit) {
    throw releaseError('USER_ACCEPTANCE_BASELINE_MISMATCH', `User accepted ${acceptedCommit}, release targets ${integrationCommit}.`);
  }
}

async function executeEvidence(runCommand, specification, integrationCommit, environment, now, kind, index) {
  if (!specification?.command) throw new TypeError(`${kind} command is required`);
  const executedAt = timestamp(now);
  const result = await runCommand(specification);
  return Object.freeze({
    verificationId: specification.verificationId || `${kind}-${index}`,
    command: [specification.command, ...(specification.args || [])].join(' '),
    cwd: specification.cwd || '.',
    exitCode: result.exitCode,
    environment: specification.environment || environment,
    commitSha: integrationCommit,
    executedAt,
    logPath: specification.logPath || `logs/release/${kind}-${index}.log`,
    result: result.exitCode === 0 ? 'PASS' : 'FAIL',
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  });
}

function defaultRunCommand({ command, args = [], cwd, env = {} }) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', shell: false });
  return Promise.resolve({
    exitCode: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || result.error?.message || '').trim(),
  });
}

function timestamp(now) {
  const date = new Date(now());
  if (Number.isNaN(date.getTime())) throw new TypeError('now() must return a valid date value');
  return date.toISOString();
}

function releaseError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
