import { normalizeToken } from './gates.mjs';

export function parseSelfCheck(content) {
  const lines = String(content || '').split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const conclusion = parseConclusion(afterColon(findLine(lines, ['结论', 'conclusion', 'result'])));
  const allowsNextStage = parseBoolean(afterColon(findLine(lines, ['是否允许进入下一阶段', 'allows next stage', 'allows_next_stage', 'allowsnextstage'])));
  const parseErrors = [conclusion === null ? 'self_check_conclusion_parse_failed' : null, allowsNextStage === null ? 'allows_next_stage_parse_failed' : null].filter(Boolean);
  return { conclusion, allows_next_stage: allowsNextStage, parse_ok: parseErrors.length === 0, parse_errors: parseErrors };
}

export function validateSelfCheck({ content, requiredPatterns = [] }) {
  return { parsed: parseSelfCheck(content), missingRequirements: requiredPatterns.filter((pattern) => !String(content || '').includes(pattern)) };
}

function normalizeLine(value) { return String(value || '').replace(/^\s*[-*+]\s*/, '').replace(/\*\*|__/g, '').replace(/`/g, '').replace(/：/g, ':').replace(/\s+/g, ' ').trim(); }
function findLine(lines, labels) { return lines.find((line) => { const key = line.split(':', 1)[0].trim().toLowerCase().replace(/[ _-]/g, ''); return labels.some((label) => key === label.toLowerCase().replace(/[ _-]/g, '')); }); }
function afterColon(line) { return line?.slice(line.indexOf(':') + 1).trim() || ''; }
function leading(value) { return String(value || '').trim().split(/[（(—–，,；;]/, 1)[0].split(/—/, 1)[0].trim(); }
function parseConclusion(value) { const token = normalizeToken(leading(value)); if (['PASS', 'APPROVED', '通过'].includes(token)) return 'PASS'; if (['CHANGES_REQUESTED', 'NEEDS_FIX', '需要修改', '需修改', '修改后复查'].includes(token)) return 'CHANGES_REQUESTED'; if (['FAIL', 'FAILED', '不通过'].includes(token)) return 'FAIL'; if (['BLOCKED', '阻塞'].includes(token)) return 'BLOCKED'; return null; }
function parseBoolean(value) { const token = leading(value).toLowerCase(); return ['true', 'yes', 'y', '是', '允许', 'pass', 'approved'].includes(token) ? true : ['false', 'no', 'n', '否', '不允许', 'fail', 'blocked'].includes(token) ? false : null; }
