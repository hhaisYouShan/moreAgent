const TRUE_VALUES = new Set(['true', 'yes', 'y', '是', '允许', 'pass', 'approved']);
const FALSE_VALUES = new Set(['false', 'no', 'n', '否', '不允许', 'fail', 'blocked']);

export function parseSelfCheck(content) {
  const normalizedLines = String(content || '')
    .split(/\r?\n/)
    .map(normalizeControlLine)
    .filter(Boolean);

  const conclusionLine = findLine(normalizedLines, ['结论', 'conclusion', 'result']);
  const allowsLine = findLine(normalizedLines, ['是否允许进入下一阶段', 'allows next stage', 'allows_next_stage', 'allowsnextstage']);
  const conclusion = parseConclusion(valueAfterColon(conclusionLine));
  const allowsNextStage = parseBoolean(valueAfterColon(allowsLine));
  const parseErrors = [];

  if (conclusionLine && !conclusion) parseErrors.push('self_check_conclusion_parse_failed');
  if (allowsLine && allowsNextStage === null) parseErrors.push('allows_next_stage_parse_failed');

  return {
    conclusion,
    allows_next_stage: allowsNextStage,
    parse_ok: parseErrors.length === 0,
    parse_errors: parseErrors,
    raw: {
      conclusion: conclusionLine || null,
      allows_next_stage: allowsLine || null,
    },
  };
}

export function normalizeControlLine(value) {
  return String(value ?? '')
    .replace(/^\s*[-*+]\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/：/g, ':')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeLeadingValue(value) {
  return String(value || '')
    .trim()
    .split(/[（(—–，,；;]/, 1)[0]
    .split(/—/, 1)[0]
    .trim();
}

export function parseConclusion(value) {
  const normalized = normalizeLeadingValue(value).toUpperCase();

  if (['PASS', 'APPROVED', '通过'].includes(normalized)) return 'PASS';

  if ([
    'CHANGES_REQUESTED',
    'NEEDS_FIX',
    '需要修改',
    '需修改',
    '修改后复查',
  ].includes(normalized)) {
    return 'CHANGES_REQUESTED';
  }

  if (['FAIL', 'FAILED', '不通过'].includes(normalized)) return 'FAIL';

  if (['BLOCKED', '阻塞'].includes(normalized)) return 'BLOCKED';

  return null;
}

export function parseBoolean(value) {
  const normalized = normalizeLeadingValue(value).toLowerCase();
  if (!normalized) return null;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

function findLine(lines, labels) {
  return lines.find((line) => {
    const key = String(line.split(':', 1)[0] || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const compactKey = key.replace(/[ _-]/g, '');
    return labels.some((label) => {
      const normalizedLabel = label.toLowerCase();
      return key === normalizedLabel || compactKey === normalizedLabel.replace(/[ _-]/g, '');
    });
  });
}

function valueAfterColon(line) {
  if (!line) return '';
  const index = line.indexOf(':');
  return index >= 0 ? line.slice(index + 1).trim() : '';
}
