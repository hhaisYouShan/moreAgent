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
      var sel = r.id===currentRunId ? ' selected' : '';
      var details = getDetails(r.id);
      var badge = '';
      if (details&&details.report&&details.report.report&&details.report.report.decision){
        var d = details.report.report.decision;
        badge = '<span class="badge badge-'+d.overallStatus+'">'+d.overallStatus+'</span>';
      } else {
        badge = '<span class="badge badge-UNKNOWN">N/A</span>';
      }
      html += '<div class="run-item'+sel+'" data-run-id="'+esc(r.id)+'" onclick="selectRun(\\''+esc(r.id)+'\\')">'+
        '<div class="id">'+esc(r.id)+'</div>'+
        '<div class="task">'+esc(r.task||'')+'</div>'+
        '<div class="meta">'+badge+'<span style="color:#8b949e">'+esc(r.status||'')+'</span></div>'+
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

    // A. Header Summary
    html += '<div class="section"><div class="section-title">Run Header</div><div class="section-body">';
    if (!isFull && details&&details.workflowError&&details.workflowError.code==='NOT_FULL_WORKFLOW'){
      html += '<div class="mvp-banner">workflow unavailable \u2014 MVP run</div>';
    }
    html += '<div class="row">'+
      '<div class="col"><div class="label">Run ID</div><div class="value">'+esc(brief.id)+'</div></div>'+
      '<div class="col"><div class="label">Task</div><div class="value">'+esc(brief.task||'N/A')+'</div></div>'+
      '<div class="col"><div class="label">Status</div><div class="value">'+esc(brief.status||'N/A')+'</div></div>'+
      '<div class="col"><div class="label">Profile</div><div class="value">'+esc(workflowInfo.profile||'mvp')+'</div></div>'+
      '<div class="col"><div class="label">Created</div><div class="value">'+esc(brief.createdAt||'')+'</div></div>'+
      '</div>';
    if (decision) {
      html += '<div class="row" style="margin-top:12px">'+
        '<div class="col"><div class="label">Overall Status</div><div class="value"><span class="badge badge-'+esc(decision.overallStatus)+'">'+esc(decision.overallStatus)+'</span></div></div>'+
        '<div class="col"><div class="label">Recommendation</div><div class="value"><span class="badge badge-'+esc(decision.recommendation)+'">'+esc(decision.recommendation)+'</span></div></div>'+
        '<div class="col"><div class="label">Can Resume</div><div class="value">'+(decision.canResume?'yes':'no')+'</div></div>'+
        '</div>';
    }
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
    html += '<div class="row">'+
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

    // G. JSON / Debug
    html += '<div class="section"><div class="section-title">JSON / Debug</div>'+
      '<div class="tabs">'+
      '<div class="tab active" onclick="switchTab(this,\\'status-tab\\')">Status JSON</div>'+
      '<div class="tab" onclick="switchTab(this,\\'report-tab\\')">Report JSON</div>'+
      '<div class="tab" onclick="switchTab(this,\\'workflow-tab\\')">Workflow JSON</div>'+
      '</div>'+
      '<div class="tab-content">'+
      '<div class="tab-panel active" id="status-tab"><div class="json-block">'+escJson(details?details.status:null)+'</div></div>'+
      '<div class="tab-panel" id="report-tab"><div class="json-block">'+escJson(details?details.report:null)+'</div></div>'+
      '<div class="tab-panel" id="workflow-tab"><div class="json-block">'+escJson(details?details.workflow:null)+'</div></div>'+
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
