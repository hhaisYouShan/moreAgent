export interface ReportModel {
  report: {
    run: {
      id: string;
      task: string;
      status: string;
      createdAt: string;
      profile: string;
    };
    workflow: {
      completedPhases: string[];
      failedPhase: string | null;
      totalPhases: number;
      completedCount: number;
    };
    gates: {
      prdGate: string;
      techGate: string;
    };
    quality: {
      test: string;
      review: string;
      hasRepair: boolean;
      repairCount: number;
      repairRounds: number;
    };
    worktree: {
      hasWorktree: boolean;
      exists: boolean;
      path: string;
      branch: string;
      dirty: string;
    };
    merge: {
      canMerge: boolean;
      blockedReason: string;
      mainClean: boolean;
      mainDirtyFiles: string[];
    };
    decision: {
      canResume: boolean;
      overallStatus: string;
      recommendation: string;
    };
  };
}

export function printReportText(model: ReportModel): void {
  const r = model.report;
  console.log('Workflow Report');
  console.log(`Run ID:       ${r.run.id}`);
  console.log(`Task:         ${r.run.task}`);
  console.log(`Status:       ${r.run.status}`);
  console.log(`Profile:      ${r.run.profile}`);
  console.log(`Created At:   ${r.run.createdAt}`);
  console.log('');
  console.log(`Workflow Progress: ${r.workflow.completedCount}/${r.workflow.totalPhases} phases completed`);
  if (r.workflow.completedPhases.length > 0) {
    console.log(`  ${r.workflow.completedPhases.join(' → ')}`);
  }
  if (r.workflow.failedPhase) {
    console.log(`  Failed Phase: ${r.workflow.failedPhase}`);
  }
  console.log('');
  console.log('Gate Decisions:');
  console.log(`  PRD Gate:     ${r.gates.prdGate}`);
  console.log(`  Tech Gate:    ${r.gates.techGate}`);
  console.log('');
  console.log('Quality:');
  console.log(`  Test:         ${r.quality.test}`);
  console.log(`  Review:       ${r.quality.review}`);
  console.log(`  Repairs:      ${r.quality.repairCount}`);
  console.log('');
  console.log('Merge Readiness:');
  console.log(`  Can Merge:    ${r.merge.canMerge ? 'yes' : 'no'}${r.merge.blockedReason ? ' (' + r.merge.blockedReason + ')' : ''}`);
  console.log(`  Worktree:     ${r.worktree.path || 'none'}${r.worktree.branch ? ' (branch: ' + r.worktree.branch + ')' : ''}`);
  console.log(`  Main Clean:   ${r.merge.mainClean ? 'yes' : 'no'}${r.merge.mainDirtyFiles.length ? ' (' + r.merge.mainDirtyFiles.join(', ') + ')' : ''}`);
  console.log('');
  console.log('Decision:');
  console.log(`  Overall:      ${r.decision.overallStatus}`);
  console.log(`  Recommend:    ${r.decision.recommendation}`);
}
