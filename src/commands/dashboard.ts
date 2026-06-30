import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

export interface DashboardOptions {
  run?: string;
  limit?: number;
  output?: string;
}

interface DashboardError {
  message: string;
  code?: string;
}

interface RunDetailEntry {
  status: any | null;
  statusError?: DashboardError;
  report: any | null;
  reportError?: DashboardError;
  workflow: any | null;
  workflowError?: DashboardError;
}

interface DashboardModel {
  generatedAt: string;
  selectedRunId: string | null;
  runs: any[];
  runDetailsById: Record<string, RunDetailEntry>;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_OUTPUT = '.moreagent/dashboard/index.html';

export function dashboardCommand(options: DashboardOptions): void {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const outputPath = options.output ?? path.resolve(DEFAULT_OUTPUT);

  const model = buildDashboardModel(options.run, limit);

  if (!model) {
    process.exit(1);
  }

  const html = renderDashboardHtml(model);
  writeDashboardHtml(outputPath, html);
  console.log(`Dashboard written to ${outputPath}`);
}

function getCliPath(): string {
  if (__filename.endsWith('.ts')) {
    return path.resolve(__dirname, '..', '..', 'dist', 'cli.js');
  }
  return process.argv[1];
}

function callMoreagentJson(args: string[]): { data: any } | { error: string; errorCode?: string } {
  const cliPath = getCliPath();
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf-8',
    timeout: 30000,
  });

  if (result.error) {
    return { error: result.error.message };
  }

  try {
    const data = JSON.parse(result.stdout.trim());
    if (data.error) {
      return { error: data.error.message, errorCode: data.error.code };
    }
    return { data };
  } catch {
    return { error: `JSON parse failed: ${result.stdout.slice(0, 200)}` };
  }
}

function buildDashboardModel(selectedRun?: string, limit: number = DEFAULT_LIMIT): DashboardModel | null {
  const listResult = callMoreagentJson(['status', '--json']);
  if ('error' in listResult) {
    console.error(`Error fetching runs: ${listResult.error}`);
    return null;
  }

  const allRuns: any[] = (listResult.data.runs || []);
  if (allRuns.length === 0) {
    console.log('No runs found.');
    return null;
  }

  const prefetchedRuns = allRuns.slice(0, limit);
  let matchedRunId: string | null = null;

  if (selectedRun) {
    const matched = prefetchedRuns.find(
      (r) => r.id === selectedRun || r.id.startsWith(selectedRun)
    );
    if (!matched) {
      console.error(`Run not found in prefetched range (limit=${limit}): ${selectedRun}`);
      return null;
    }
    matchedRunId = matched.id;
  } else {
    matchedRunId = prefetchedRuns[0]?.id ?? null;
  }

  const runDetailsById: Record<string, RunDetailEntry> = {};

  for (const run of prefetchedRuns) {
    const details: RunDetailEntry = {
      status: null,
      report: null,
      workflow: null,
    };

    const statusResult = callMoreagentJson(['status', '--run', run.id, '--json']);
    if ('data' in statusResult) {
      details.status = statusResult.data;
    } else {
      details.statusError = {
        message: statusResult.error,
        code: statusResult.errorCode,
      };
    }

    const reportResult = callMoreagentJson(['report', '--run', run.id, '--json']);
    if ('data' in reportResult) {
      details.report = reportResult.data;
    } else {
      details.reportError = {
        message: reportResult.error,
        code: reportResult.errorCode,
      };
    }

    const workflowResult = callMoreagentJson(['inspect', '--run', run.id, '--workflow', '--json']);
    if ('data' in workflowResult) {
      details.workflow = workflowResult.data;
    } else {
      details.workflow = null;
      details.workflowError = {
        message: workflowResult.error,
        code: workflowResult.errorCode,
      };
    }

    runDetailsById[run.id] = details;
  }

  return {
    generatedAt: new Date().toISOString(),
    selectedRunId: matchedRunId,
    runs: prefetchedRuns,
    runDetailsById,
  };
}

function serializeJsonForScript(value: any): string {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function renderDashboardHtml(model: DashboardModel): string {
  const dataJson = serializeJsonForScript(model);
  const selectedId = model.selectedRunId || (model.runs[0]?.id ?? '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MoreAgent Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,monospace;background:#0d1117;color:#c9d1d9;display:flex;height:100vh;overflow:hidden}
#sidebar{width:280px;min-width:280px;background:#161b22;border-right:1px solid #30363d;display:flex;flex-direction:column;overflow:hidden}
#sidebar h2{padding:16px;font-size:16px;border-bottom:1px solid #30363d;color:#58a6ff}
#filters{padding:8px 12px;display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid #30363d}
#filters button{background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px}
#filters button.active{background:#1f6feb;border-color:#1f6feb;color:#fff}
#run-list{flex:1;overflow-y:auto;padding:4px 0}
.run-item{padding:10px 16px;cursor:pointer;border-bottom:1px solid #21262d;font-size:13px;transition:background .15s}
.run-item:hover{background:#1c2128}
.run-item.selected{background:#0d419d;border-left:3px solid #58a6ff}
.run-item .id{font-size:11px;color:#8b949e;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.run-item .task{font-weight:600;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.run-item .meta{display:flex;gap:6px;align-items:center;font-size:11px}
.badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;text-transform:uppercase}
.badge-PASSED{background:#238636;color:#fff}
.badge-FAILED{background:#da3633;color:#fff}
.badge-RUNNING{background:#d29922;color:#000}
.badge-PARTIAL{background:#a371f7;color:#fff}
.badge-UNKNOWN{background:#30363d;color:#8b949e}
.badge-MERGE_READY{background:#238636;color:#fff}
.badge-BLOCKED{background:#d29922;color:#000}
.badge-NEEDS_REPAIR{background:#da3633;color:#fff}
.badge-NEEDS_REVIEW{background:#a371f7;color:#fff}
#main{flex:1;overflow-y:auto;padding:24px 32px}
.section{margin-bottom:24px;background:#161b22;border:1px solid #30363d;border-radius:6px;overflow:hidden}
.section-title{background:#21262d;padding:10px 16px;font-size:14px;font-weight:600;color:#58a6ff;border-bottom:1px solid #30363d}
.section-body{padding:16px}
.row{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:8px}
.col{flex:1;min-width:200px}
.label{font-size:11px;color:#8b949e;text-transform:uppercase;margin-bottom:4px}
.value{font-size:13px;color:#c9d1d9;word-break:break-all}
.error-box{background:#da363320;border:1px solid #da3633;border-radius:4px;padding:12px;color:#f85149;font-size:12px}
.empty-box{background:#21262d;border:1px solid #30363d;border-radius:4px;padding:12px;color:#8b949e;font-size:12px;font-style:italic}
.gate-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
.gate-card{background:#0d1117;border:1px solid #30363d;border-radius:4px;padding:12px;text-align:center}
.gate-card .gate-label{font-size:11px;color:#8b949e;text-transform:uppercase;margin-bottom:6px}
.gate-card .gate-value{font-size:18px;font-weight:700}
.gate-APPROVED,.gate-PASS{color:#3fb950}
.gate-CHANGES_REQUESTED,.gate-FAIL{color:#f85149}
.gate-unknown{color:#d29922}
.phase-bar{display:flex;gap:4px;flex-wrap:wrap;margin:12px 0}
.phase-pill{padding:4px 10px;border-radius:12px;font-size:11px;font-weight:600}
.phase-done{background:#238636;color:#fff}
.phase-failed{background:#da3633;color:#fff}
.phase-pending{background:#21262d;color:#8b949e}
.tabs{display:flex;border-bottom:1px solid #30363d;margin-bottom:0}
.tab{padding:8px 16px;cursor:pointer;font-size:12px;color:#8b949e;border-bottom:2px solid transparent}
.tab.active{color:#58a6ff;border-bottom-color:#58a6ff}
.tab-content{padding:16px}
.tab-panel{display:none}
.tab-panel.active{display:block}
.json-block{background:#0d1117;border:1px solid #30363d;border-radius:4px;padding:12px;max-height:400px;overflow:auto;font-size:11px;white-space:pre-wrap;color:#7ee787}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:6px 8px;background:#21262d;color:#8b949e;font-weight:600;text-transform:uppercase;font-size:10px;border-bottom:1px solid #30363d}
td{padding:6px 8px;border-bottom:1px solid #21262d}
.mvp-banner{background:#d2992220;border:1px solid #d29922;border-radius:4px;padding:8px 12px;color:#d29922;font-size:12px;margin-bottom:16px}
.merge-ok{color:#3fb950}
.merge-no{color:#f85149}
.run-failed{border-left:3px solid #f85149}
.run-running{border-left:3px solid #d29922}
.run-merge_ready{border-left:3px solid #3fb950}
.summary-hero{display:flex;gap:20px;align-items:center;margin-bottom:12px}
.summary-hero .hero-status{font-size:28px;font-weight:700}
.summary-hero .hero-recommendation{font-size:18px;font-weight:600}
.summary-pills{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.status-pill{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600;background:#21262d;border:1px solid #30363d}
.status-pill.good{background:#23863620;border-color:#238636;color:#3fb950}
.status-pill.bad{background:#da363320;border-color:#da3633;color:#f85149}
.status-pill.warn{background:#d2992220;border-color:#d29922;color:#d29922}
.merge-explain{background:#0d1117;border:1px solid #30363d;border-radius:4px;padding:12px;font-size:12px;margin-top:12px}
.merge-explain.ready{border-color:#238636;background:#23863610}
.merge-explain.blocked{border-color:#da3633;background:#da363310}
.debug-toggle{cursor:pointer;color:#58a6ff;font-size:13px;padding:8px 16px;user-select:none}
.debug-toggle:hover{color:#79c0ff}
.debug-collapsed .section-body,.debug-collapsed .tabs,.debug-collapsed .tab-content{display:none}
.debug-expanded .section-body,.debug-expanded .tabs,.debug-expanded .tab-content{display:block}
</style>
</head>
<body>
<div id="sidebar">
  <h2>MoreAgent Dashboard</h2>
  <div id="filters">
    <button class="active" data-filter="all">All</button>
    <button data-filter="failed">Failed</button>
    <button data-filter="running">Running</button>
    <button data-filter="completed">Completed</button>
    <button data-filter="full">Full WF</button>
  </div>
  <div id="run-list"></div>
</div>
<div id="main">
  <div id="main-content"></div>
</div>

<script>
window.__MOREAGENT_DASHBOARD_DATA__ = ${dataJson};

(function(){
  var D = window.__MOREAGENT_DASHBOARD_DATA__;
  var currentRunId = '${selectedId}';
  var currentFilter = 'all';

  var FULL_PHASES = ['brain','prd','prd-review','prd-gate','tech-plan','tech-gate','implementation','test','review'];

  function getRunBrief(runId) {
    var r = D.runs.find(function(x){return x.id===runId;});
    return r || null;
  }
  function getDetails(runId) {
    return D.runDetailsById[runId] || null;
  }

  function renderSidebar() {
    var list = D.runs.filter(function(r){
      if (currentFilter==='all') return true;
      if (currentFilter==='full') return (r.profile||r.workflow?.profile)==='full';
      var details = getDetails(r.id);
      var rec = (details&&details.report&&details.report.report&&details.report.report.decision)
        ? details.report.report.decision.recommendation : '';
      if (currentFilter==='failed') return r.status==='failed'||rec==='NEEDS_REPAIR';
      if (currentFilter==='running') return r.status==='running';
      if (currentFilter==='completed') return r.status==='completed';
      return true;
    });
    var html = '';
    for (var i=0;i<list.length;i++) {
      var r = list[i];
      var details = getDetails(r.id);
      var report = (details&&details.report&&details.report.report) ? details.report.report : null;
      var decision = report ? report.decision : null;

      var sel = r.id===currentRunId ? ' selected' : '';
      var extraClass = '';
      if (r.status==='failed') extraClass = ' run-failed';
      else if (r.status==='running') extraClass = ' run-running';
      else if (decision && decision.recommendation==='MERGE_READY') extraClass = ' run-merge_ready';

      var badge = '';
      if (decision){
        badge = '<span class="badge badge-'+esc(decision.overallStatus)+'">'+esc(decision.overallStatus)+'</span>';
      } else {
        badge = '<span class="badge badge-UNKNOWN">N/A</span>';
      }

      var recBadge = '';
      if (decision && decision.recommendation) {
        recBadge = '<span class="badge badge-'+esc(decision.recommendation)+'">'+esc(decision.recommendation)+'</span>';
      }

      var profileBadge = '';
      var prof = r.workflow ? r.workflow.profile : (r.profile||'mvp');
      profileBadge = '<span style="font-size:10px;color:#8b949e;text-transform:uppercase">'+esc(prof)+'</span>';

      var shortTime = '';
      if (r.createdAt) {
        try { shortTime = new Date(r.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }catch(e){ shortTime = r.createdAt.slice(0,16); }
      }

      html += '<div class="run-item'+sel+extraClass+'" data-run-id="'+esc(r.id)+'" onclick="selectRun(\\''+esc(r.id)+'\\')" title="'+esc(r.task||'')+'">'+
        '<div class="task">'+esc(truncTask(r.task||''))+'</div>'+
        '<div class="id">'+esc(r.id)+'</div>'+
        '<div class="meta">'+badge+recBadge+profileBadge+'<span style="font-size:10px;color:#6e7681">'+esc(shortTime)+'</span></div>'+
        '</div>';
    }
    document.getElementById('run-list').innerHTML=html;
  }

  function renderMain() {
    var brief = getRunBrief(currentRunId);
    var details = getDetails(currentRunId);
    if (!brief) { document.getElementById('main-content').innerHTML='<div class="section"><div class="section-body"><div class="error-box">Run not found</div></div></div>'; return; }

    var report = (details&&details.report&&details.report.report) ? details.report.report : null;
    var decision = report ? report.decision : null;
    var statusRun = (details&&details.status&&details.status.run) ? details.status.run : null;
    var sessions = statusRun ? (statusRun.sessions||[]) : [];
    var workflowInfo = brief.workflow||(statusRun&&statusRun.workflow)||{};
    var isFull = (workflowInfo.profile==='full');

    var html = '';

    // A. Enhanced Summary
    html += '<div class="section"><div class="section-title">Overall Status</div><div class="section-body">';
    if (!isFull && details&&details.workflowError&&details.workflowError.code==='NOT_FULL_WORKFLOW'){
      html += '<div class="mvp-banner">workflow unavailable \u2014 MVP run</div>';
    }

    if (decision) {
      html += '<div class="summary-hero">'+
        '<div class="hero-status" style="color:'+statusColor(decision.overallStatus)+'">'+esc(decision.overallStatus)+'</div>'+
        '<div class="hero-recommendation" style="color:'+recColor(decision.recommendation)+'">'+esc(decision.recommendation)+'</div>'+
        '</div>';
      html += '<div class="summary-pills">'+
        pill(decision.canResume,'Can Resume')+
        pill(report.merge.canMerge,'Can Merge')+
        pill(report.merge.mainClean,'Main Clean')+
        pill(report.worktree.exists,'Worktree Exists')+
        '</div>';
    } else if (brief) {
      html += '<div class="summary-hero"><div class="hero-status" style="color:#8b949e">'+esc(brief.status||'N/A')+'</div></div>';
    }

    html += '<div style="font-size:12px;color:#8b949e">Run ID: '+esc(brief.id)+' &middot; Task: '+esc(brief.task||'N/A')+' &middot; Profile: '+esc(workflowInfo.profile||'mvp')+'</div>';
    html += '</div></div>';

    // B. Workflow Report
    html += '<div class="section"><div class="section-title">Workflow Report</div><div class="section-body">';
    if (details&&details.workflowError) {
      html += '<div class="mvp-banner">'+esc(details.workflowError.message||'workflow unavailable')+'</div>';
    }
    var wf = (details&&details.workflow&&details.workflow.run) ? details.workflow.run : null;
    var reportWf = report ? report.workflow : null;
    var completedPhases = reportWf ? (reportWf.completedPhases||[]) : (wf?(wf.completedPhases||[]):[]);
    var failedPhase = reportWf ? reportWf.failedPhase : (wf?wf.failedPhase:null);
    var totalPhases = reportWf ? reportWf.totalPhases : FULL_PHASES.length;
    var completedCount = reportWf ? reportWf.completedCount : completedPhases.length;

    html += '<div class="row">'+
      '<div class="col"><div class="label">Completed</div><div class="value">'+completedCount+' / '+totalPhases+'</div></div>'+
      (failedPhase?'<div class="col"><div class="label">Failed Phase</div><div class="value" style="color:#f85149">'+esc(failedPhase)+'</div></div>':'')+
      '</div>';

    if (completedPhases.length>0||failedPhase){
      html += '<div class="phase-bar">';
      for (var p=0;p<FULL_PHASES.length;p++){
        var ph = FULL_PHASES[p];
        var cls = 'phase-pending';
        if (ph===failedPhase) cls='phase-failed';
        else if (completedPhases.indexOf(ph)>=0) cls='phase-done';
        html += '<span class="phase-pill '+cls+'">'+ph+'</span>';
      }
      html += '</div>';
    }
    html += '</div></div>';

    // C. Gate / Test / Review
    var gates = report ? (report.gates||{}) : {};
    var quality = report ? (report.quality||{}) : {};
    html += '<div class="section"><div class="section-title">Gate / Test / Review</div><div class="section-body">';
    html += '<div class="gate-grid">'+
      gateCard('PRD Gate',gates.prdGate||'unknown')+
      gateCard('Tech Gate',gates.techGate||'unknown')+
      gateCard('Test',quality.test||'unknown')+
      gateCard('Review',quality.review||'unknown')+
      '</div></div></div>';

    // D. Repair Sessions
    html += '<div class="section"><div class="section-title">Repair Sessions</div><div class="section-body">';
    if (quality.hasRepair){
      html += '<div class="row">'+
        '<div class="col"><div class="label">Repair Count</div><div class="value">'+(quality.repairCount||0)+'</div></div>'+
        '<div class="col"><div class="label">Repair Rounds</div><div class="value">'+(quality.repairRounds||0)+'</div></div>'+
        '</div>';
    } else {
      html += '<div class="empty-box">No repair sessions</div>';
    }
    html += '</div></div>';

    // E. Merge Readiness
    var merge = report ? (report.merge||{}) : {};
    var wt = report ? (report.worktree||{}) : {};
    html += '<div class="section"><div class="section-title">Merge Readiness</div><div class="section-body">';

    var mergeExplain = buildMergeExplanation(decision, merge, wt);
    html += '<div class="merge-explain '+((decision&&decision.recommendation==='MERGE_READY')?'ready':'blocked')+'">'+esc(mergeExplain)+'</div>';

    html += '<div class="row" style="margin-top:12px">'+
      '<div class="col"><div class="label">Can Merge</div><div class="value '+(merge.canMerge?'merge-ok':'merge-no')+'">'+(merge.canMerge?'yes':'no')+(merge.blockedReason?' ('+esc(merge.blockedReason)+')':'')+'</div></div>'+
      '<div class="col"><div class="label">Main Clean</div><div class="value '+(merge.mainClean?'merge-ok':'merge-no')+'">'+(merge.mainClean?'yes':'no')+'</div></div>'+
      '<div class="col"><div class="label">Worktree</div><div class="value">'+(wt.path||'none')+(wt.branch?' ('+esc(wt.branch)+')':'')+'</div></div>'+
      '</div>';
    if (!merge.mainClean&&merge.mainDirtyFiles&&merge.mainDirtyFiles.length>0){
      html += '<div class="label" style="margin-top:8px">Dirty Files</div>';
      html += '<div class="value">'+merge.mainDirtyFiles.map(function(f){return esc(f);}).join('<br>')+'</div>';
    }
    html += '</div></div>';

    // F. Sessions
    html += '<div class="section"><div class="section-title">Sessions</div><div class="section-body">';
    if (sessions.length>0){
      html += '<table><thead><tr><th>Agent</th><th>Status</th><th>Duration</th><th>Artifact Dir</th><th>Worktree</th></tr></thead><tbody>';
      for (var s=0;s<sessions.length;s++){
        var ss = sessions[s];
        var dur = '';
        if (ss.startedAt&&ss.completedAt){
          try {
            var sec = (new Date(ss.completedAt)-new Date(ss.startedAt))/1000;
            dur = Math.round(sec)+'s';
          }catch(e){}
        }
        html += '<tr>'+
          '<td>'+esc(ss.agentName||'')+'</td>'+
          '<td>'+esc(ss.status||'')+'</td>'+
          '<td>'+esc(dur)+'</td>'+
          '<td style="font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(ss.artifactDir||'')+'</td>'+
          '<td style="font-size:10px">'+(ss.worktreePath?'yes':'')+'</td>'+
          '</tr>';
      }
      html += '</tbody></table>';
    } else {
      html += '<div class="empty-box">No sessions</div>';
    }
    html += '</div></div>';

    // G. JSON / Debug (collapsible)
    html += '<div class="section debug-collapsed" id="debug-section"><div class="section-title" style="display:flex;justify-content:space-between;align-items:center">'+
      '<span>JSON / Debug</span>'+
      '<span class="debug-toggle" onclick="toggleDebug()">\u25b6 Show</span>'+
      '</div>'+
      '<div class="tabs">'+
      '<div class="tab active" onclick="switchTab(this,\\'status-tab\\')">Status JSON</div>'+
      '<div class="tab" onclick="switchTab(this,\\'report-tab\\')">Report JSON</div>'+
      '<div class="tab" onclick="switchTab(this,\\'workflow-tab\\')">Workflow JSON</div>'+
      '</div>'+
      '<div class="tab-content">'+
      '<div class="tab-panel active" id="status-tab">'+
      (details&&details.statusError?'<div class="error-box">Status Error: '+esc(details.statusError.message||'')+' (code: '+esc(details.statusError.code||'N/A')+')</div>':'')+
      '<div class="json-block">'+escJson(details?details.status:null)+'</div></div>'+
      '<div class="tab-panel" id="report-tab">'+
      (details&&details.reportError?'<div class="error-box">Report Error: '+esc(details.reportError.message||'')+' (code: '+esc(details.reportError.code||'N/A')+')</div>':'')+
      '<div class="json-block">'+escJson(details?details.report:null)+'</div></div>'+
      '<div class="tab-panel" id="workflow-tab">'+
      (details&&details.workflowError?'<div class="error-box">Workflow Error: '+esc(details.workflowError.message||'')+' (code: '+esc(details.workflowError.code||'N/A')+')</div>':'')+
      '<div class="json-block">'+escJson(details?details.workflow:null)+'</div></div>'+
      '</div></div>';

    document.getElementById('main-content').innerHTML=html;
  }

  function gateCard(label,value){
    var cls = 'gate-unknown';
    if (value==='APPROVED'||value==='PASS') cls='gate-APPROVED';
    else if (value==='CHANGES_REQUESTED'||value==='FAIL') cls='gate-CHANGES_REQUESTED';
    return '<div class="gate-card"><div class="gate-label">'+esc(label)+'</div><div class="gate-value '+cls+'">'+esc(value)+'</div></div>';
  }

  function esc(s){ if(!s)return''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function escJson(v){ if(!v)return'null'; try{return esc(JSON.stringify(v,null,2));}catch(e){return esc(String(v));} }

  function truncTask(task) {
    if (!task) return '';
    return task.length > 50 ? task.slice(0,50)+'\u2026' : task;
  }

  function pill(cond, label) {
    var cls = cond ? 'good' : 'warn';
    return '<span class="status-pill '+cls+'">'+(cond?'\u2713':'\u2717')+' '+esc(label)+'</span>';
  }

  function statusColor(s) {
    if (s==='PASSED') return '#3fb950';
    if (s==='FAILED') return '#f85149';
    if (s==='RUNNING') return '#d29922';
    if (s==='PARTIAL') return '#a371f7';
    return '#8b949e';
  }

  function recColor(s) {
    if (s==='MERGE_READY') return '#3fb950';
    if (s==='BLOCKED'||s==='NEEDS_REPAIR') return '#f85149';
    if (s==='NEEDS_REVIEW') return '#a371f7';
    return '#8b949e';
  }

  function buildMergeExplanation(decision, merge, wt) {
    if (!decision) return 'No decision data available.';
    if (decision.recommendation==='MERGE_READY') {
      return 'MERGE_READY: Run has passed all checks \u2014 overall status is PASSED, main repository is clean, worktree exists, and merge is permitted.';
    }
    var reasons = [];
    if (decision.overallStatus!=='PASSED') reasons.push('overall status is not PASSED (currently: '+decision.overallStatus+')');
    if (!merge.canMerge) reasons.push('canMerge is false'+(merge.blockedReason?' ('+merge.blockedReason+')':''));
    if (!merge.mainClean) reasons.push('main repository is not clean (has uncommitted changes)');
    if (!wt.exists) reasons.push('worktree does not exist or is missing');
    return 'BLOCKED: '+(reasons.length>0 ? reasons.join('; ') : 'merge is blocked for unknown reason')+'.';
  }

  window.toggleDebug = function() {
    var sec = document.getElementById('debug-section');
    var toggle = sec.querySelector('.debug-toggle');
    if (sec.classList.contains('debug-collapsed')) {
      sec.classList.remove('debug-collapsed');
      sec.classList.add('debug-expanded');
      toggle.innerHTML = '\u25bc Hide';
    } else {
      sec.classList.remove('debug-expanded');
      sec.classList.add('debug-collapsed');
      toggle.innerHTML = '\u25b6 Show';
    }
  };

  window.selectRun = function(runId) {
    currentRunId = runId;
    renderSidebar();
    renderMain();
  };

  window.switchTab = function(el, panelId) {
    var tabs = el.parentElement.querySelectorAll('.tab');
    for (var t=0;t<tabs.length;t++) tabs[t].classList.remove('active');
    el.classList.add('active');
    var panels = el.parentElement.nextElementSibling.querySelectorAll('.tab-panel');
    for (var p=0;p<panels.length;p++) panels[p].classList.remove('active');
    document.getElementById(panelId).classList.add('active');
  };

  // filter buttons
  document.getElementById('filters').addEventListener('click',function(e){
    if (e.target.tagName==='BUTTON'){
      currentFilter = e.target.dataset.filter;
      var btns = e.target.parentElement.querySelectorAll('button');
      for (var b=0;b<btns.length;b++) btns[b].classList.remove('active');
      e.target.classList.add('active');
      renderSidebar();
    }
  });

  renderSidebar();
  renderMain();
})();
</script>
</body>
</html>`;
}

function writeDashboardHtml(outputPath: string, html: string): void {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf-8');
}
