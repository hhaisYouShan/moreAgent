export function explainMergePolicy() {
  return {
    autoMerge: false,
    policy: [
      'Do not merge agent branches automatically in MVP.',
      'Run project checks before any merge.',
      'Review diff scope against PRD, tech plan, and assigned issue.',
      'Require user confirmation before merging into master.',
    ],
  };
}
