export const BEIJING_TIME_ZONE = 'Asia/Shanghai';
export const BEIJING_UTC_OFFSET = '+08:00';
export const BEIJING_TIME_LABEL = '北京时间 / Asia/Shanghai';

export function formatBeijingRunId(date = new Date()) {
  const value = beijingParts(date);
  return `${value.year}-${value.month}-${value.day}T${value.hour}-${value.minute}-${value.second}`;
}

export function formatBeijingTimestamp(date = new Date()) {
  const value = beijingParts(date);
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}:${value.second}`;
}

export function formatBeijingDateTime(date = new Date()) {
  const value = beijingParts(date);
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}:${value.second}`;
}

function beijingParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}
