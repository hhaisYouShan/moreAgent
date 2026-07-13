import { parseAllowsNextStage, parseSelfCheckConclusion } from './gate.mjs';

const sample = `## Self Check

- **结论**：**PASS**
- **是否允许进入下一阶段**：**是**
`;

const result = {
  self_check_conclusion_parsed: parseSelfCheckConclusion(sample),
  allows_next_stage_parsed: parseAllowsNextStage(sample),
};

console.log(JSON.stringify(result, null, 2));
