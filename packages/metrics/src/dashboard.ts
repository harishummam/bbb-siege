export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>bbb-siege · live</title>
<style>
  :root {
    --page: #0a0b0d; --panel: #050607; --edge: #17191f; --edge2: #0e1013;
    --green: #57f2a6; --cyan: #59c1f2; --amber: #f2c14e; --violet: #c98bf2; --red: #f2555a;
    --muted: #5b6670; --label: #7c8791; --text: #cdd6df;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { min-height: 100%; }
  body {
    background: radial-gradient(1400px 700px at 50% -20%, #101216 0%, var(--page) 55%), var(--page);
    color: var(--text);
    font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    padding: 22px; -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1180px; margin: 0 auto; }
  .topbar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .brandwrap { display: flex; flex-direction: column; gap: 3px; }
  .dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
  .dot.r { background: #34292b; } .dot.y { background: #34301f; } .dot.g { background: #1f3429; }
  .brand { color: var(--green); letter-spacing: 0.06em; text-shadow: 0 0 12px rgba(87,242,166,0.25); }
  .brand b { font-weight: 600; }
  .endpoint { color: var(--muted); font-size: 12px; }
  .live { margin-left: auto; display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }
  .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 9px var(--green); animation: pulse 1.6s ease-in-out infinite; }
  .pulse.off { background: var(--red); box-shadow: 0 0 9px var(--red); animation: none; }
  .pulse.done { background: var(--cyan); box-shadow: 0 0 9px var(--cyan); animation: none; }
  @keyframes pulse { 0%,100% { opacity: 0.35; } 50% { opacity: 1; } }

  .summary { margin-top: 12px; }
  .sumbadge { margin-left: auto; color: var(--cyan); text-transform: none; letter-spacing: 0; font-size: 12px; }
  .sumgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; padding: 16px 14px 6px; }
  .sumitem .k { color: var(--label); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; }
  .sumitem .v { font-size: 19px; margin-top: 3px; font-variant-numeric: tabular-nums; color: var(--text); }
  .sumitem .v.green { color: var(--green); } .sumitem .v.red { color: var(--red); } .sumitem .v.amber { color: var(--amber); } .sumitem .v.muted { color: var(--muted); }
  .sumtext { padding: 8px 14px 18px; color: var(--text); font-size: 13px; line-height: 1.7; opacity: 0.88; }

  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .panel { background: var(--panel); border: 1px solid var(--edge); border-radius: 10px; }
  .stat { padding: 13px 14px 11px; }
  .stat .k { color: var(--label); font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; }
  .stat .v { font-size: 30px; margin-top: 5px; font-variant-numeric: tabular-nums; }
  .v.amber { color: var(--amber); } .v.green { color: var(--green); } .v.red { color: var(--red); } .v.muted { color: var(--muted); }

  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
  .chart { padding: 12px 12px 8px; }
  .chart .ttl { display: flex; align-items: baseline; gap: 10px; color: var(--label); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px; }
  .chart .now { margin-left: auto; color: var(--text); font-size: 12px; font-variant-numeric: tabular-nums; }
  canvas { width: 100%; height: 150px; display: block; }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; font-size: 11px; color: var(--muted); }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }

  .row2 { display: grid; grid-template-columns: 1fr 1.6fr; gap: 12px; margin-top: 12px; }
  .phdr { padding: 12px 14px; }
  .phdr .ttl { color: var(--label); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: right; padding: 6px 6px; font-variant-numeric: tabular-nums; font-size: 13px; }
  th:first-child, td:first-child { text-align: left; }
  th { color: var(--label); font-weight: 400; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; border-bottom: 1px solid var(--edge); }
  td { color: var(--green); border-bottom: 1px solid var(--edge2); }
  td.phase { color: var(--label); }

  .logpanel { padding: 0; overflow: hidden; }
  .loghead { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--edge); color: var(--label); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; }
  .loghead .fails { margin-left: auto; color: var(--red); text-transform: none; letter-spacing: 0; font-size: 12px; }
  .log { height: 300px; overflow-y: auto; padding: 10px 14px; background: #000; font-size: 12.5px; line-height: 1.55; }
  .log::-webkit-scrollbar { width: 8px; } .log::-webkit-scrollbar-thumb { background: #1c1f26; border-radius: 4px; }
  .ln { white-space: pre-wrap; word-break: break-word; }
  .ln .t { color: var(--muted); } .ln .m { color: var(--text); } .ln .x { color: var(--muted); }
  .lv { display: inline-block; min-width: 42px; }
  .lv.info { color: var(--green); } .lv.debug { color: var(--muted); } .lv.warn { color: var(--amber); } .lv.error { color: var(--red); } .lv.other { color: var(--cyan); }
  .cursor { display: inline-block; width: 8px; height: 14px; background: var(--green); box-shadow: 0 0 9px var(--green); animation: blink 1.1s steps(1) infinite; vertical-align: -2px; }
  @keyframes blink { 50% { opacity: 0; } }
  @media (max-width: 820px) {
    .grid { grid-template-columns: repeat(2, 1fr); } .charts { grid-template-columns: 1fr; } .row2 { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <div class="brandwrap">
      <span class="brand"><b>bbb-siege</b></span>
      <span class="endpoint" id="endpoint"></span>
    </div>
    <span class="live"><span class="pulse" id="pulse"></span><span id="conn">connecting</span></span>
  </div>

  <div class="grid">
    <div class="panel stat"><div class="k">Active bots</div><div class="v amber" id="active">0</div></div>
    <div class="panel stat"><div class="k">Completed</div><div class="v green" id="completed">0</div></div>
    <div class="panel stat"><div class="k">Failed</div><div class="v red" id="failed">0</div></div>
    <div class="panel stat"><div class="k">Rate limited</div><div class="v muted" id="ratelimited">0</div></div>
  </div>

  <div class="charts">
    <div class="panel chart">
      <div class="ttl">Active bots <span class="now" id="activeNow">0</span></div>
      <canvas id="chartActive"></canvas>
    </div>
    <div class="panel chart">
      <div class="ttl">Join phase avg (ms) <span class="now" id="latNow"></span></div>
      <canvas id="chartLatency"></canvas>
      <div class="legend" id="legend"></div>
    </div>
  </div>

  <div class="row2">
    <div class="panel phdr">
      <div class="ttl">Join phases</div>
      <table>
        <thead><tr><th>phase</th><th>n</th><th>avg</th><th>p95≤</th></tr></thead>
        <tbody id="phases"></tbody>
      </table>
    </div>
    <div class="panel logpanel">
      <div class="loghead"><span>Live log</span><span class="fails" id="fails"></span></div>
      <div class="log" id="log"></div>
    </div>
  </div>

  <div class="panel summary" id="summary" style="display:none">
    <div class="loghead"><span>Run summary</span><span class="sumbadge">complete · frozen</span></div>
    <div class="sumgrid" id="sumgrid"></div>
    <div class="sumtext" id="sumtext"></div>
  </div>
</div>

<script>
(function () {
  var PHASES = ['api_join', 'ws_connect', 'user_join', 'first_subscription_data'];
  var COLORS = { api_join: '#57f2a6', ws_connect: '#59c1f2', user_join: '#f2c14e', first_subscription_data: '#c98bf2' };
  var MAXPTS = 1500;
  var samples = [];
  var logSeq = 0;
  var done = false;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function el(id) { return document.getElementById(id); }

  function parse(text) {
    var out = {}; var lines = text.split('\\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line || line.charAt(0) === '#') continue;
      var m = line.match(/^([a-zA-Z_:][\\w:]*)(\\{([^}]*)\\})?\\s+([-0-9.eE+]+)/);
      if (!m) continue;
      var labels = {};
      if (m[3]) {
        var parts = m[3].split(',');
        for (var p = 0; p < parts.length; p++) {
          var km = parts[p].match(/([\\w]+)="([^"]*)"/);
          if (km) labels[km[1]] = km[2];
        }
      }
      (out[m[1]] = out[m[1]] || []).push({ labels: labels, value: parseFloat(m[4]) });
    }
    return out;
  }
  function one(rows) { return rows && rows.length ? rows[0].value : 0; }
  function fmtMs(v) { return v === null || v === undefined ? '—' : Math.round(v) + 'ms'; }

  function phaseStats(m, phase) {
    function pick(name) { return (m[name] || []).filter(function (r) { return r.labels.phase === phase; }); }
    var counts = pick('bbb_siege_join_phase_duration_seconds_count');
    var sums = pick('bbb_siege_join_phase_duration_seconds_sum');
    var buckets = pick('bbb_siege_join_phase_duration_seconds_bucket');
    var n = counts.length ? counts[0].value : 0;
    var sum = sums.length ? sums[0].value : 0;
    var avg = n > 0 ? (sum / n) * 1000 : null;
    var p95 = null;
    if (n > 0 && buckets.length) {
      buckets.sort(function (a, b) { return parseFloat(a.labels.le) - parseFloat(b.labels.le); });
      var target = 0.95 * n;
      for (var b = 0; b < buckets.length; b++) {
        if (buckets[b].value >= target) { p95 = parseFloat(buckets[b].labels.le) * 1000; break; }
      }
    }
    return { n: n, avg: avg, p95: p95 };
  }

  function drawChart(canvas, series, opts) {
    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.clientWidth, ch = canvas.clientHeight;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    var pad = { l: 40, r: 8, t: 8, b: 14 };
    var pw = cw - pad.l - pad.r, ph = ch - pad.t - pad.b;
    var yMax = opts.yMin || 1;
    for (var s = 0; s < series.length; s++) for (var d = 0; d < series[s].data.length; d++) yMax = Math.max(yMax, series[s].data[d] || 0);
    yMax = yMax * 1.15;
    ctx.strokeStyle = '#14171d'; ctx.fillStyle = '#4a545e'; ctx.font = '10px ui-monospace, monospace'; ctx.lineWidth = 1;
    for (var g = 0; g <= 2; g++) {
      var yy = pad.t + (ph * g) / 2;
      ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(pad.l + pw, yy); ctx.stroke();
      var val = yMax * (1 - g / 2);
      ctx.fillText(opts.fmt ? opts.fmt(val) : String(Math.round(val)), 4, yy + 3);
    }
    var n = series.length ? series[0].data.length : 0;
    var xx = function (i) { return pad.l + (n <= 1 ? pw : (pw * i) / (n - 1)); };
    var yy2 = function (v) { return pad.t + ph - (ph * (v || 0)) / yMax; };
    for (var si = 0; si < series.length; si++) {
      var data = series[si].data; if (!data.length) continue;
      ctx.beginPath();
      for (var i2 = 0; i2 < data.length; i2++) { var px = xx(i2), py = yy2(data[i2]); if (i2 === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.strokeStyle = series[si].color; ctx.lineWidth = 1.75; ctx.lineJoin = 'round'; ctx.stroke();
      if (opts.area && series.length === 1) {
        ctx.lineTo(xx(data.length - 1), pad.t + ph); ctx.lineTo(xx(0), pad.t + ph); ctx.closePath();
        var grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ph);
        grad.addColorStop(0, series[si].color + '33'); grad.addColorStop(1, series[si].color + '00');
        ctx.fillStyle = grad; ctx.fill();
      }
    }
  }

  function renderCharts() {
    drawChart(el('chartActive'), [{ color: '#f2c14e', data: samples.map(function (s) { return s.active; }) }], { area: true, yMin: 4 });
    var series = PHASES.map(function (p) { return { color: COLORS[p], data: samples.map(function (s) { return s.phase[p] || 0; }) }; });
    drawChart(el('chartLatency'), series, { yMin: 50, fmt: function (v) { return Math.round(v) + 'ms'; } });
  }

  function renderLegend() {
    el('legend').innerHTML = PHASES.map(function (p) {
      return '<span><i class="swatch" style="background:' + COLORS[p] + '"></i>' + p + '</span>';
    }).join('');
  }

  function render(m) {
    var active = Math.round(one(m['bbb_siege_active_bots']));
    el('active').textContent = String(active);
    el('activeNow').textContent = String(active);
    el('ratelimited').textContent = String(Math.round(one(m['bbb_siege_rate_limited_total'])));

    var outcomes = m['bbb_siege_bot_outcomes_total'] || [];
    var completed = 0, failed = 0, fails = {};
    for (var i = 0; i < outcomes.length; i++) {
      var r = outcomes[i];
      if (r.labels.result === 'completed') completed += r.value;
      else if (r.labels.result === 'failed') { failed += r.value; var k = r.labels.kind || 'Unknown'; fails[k] = (fails[k] || 0) + r.value; }
    }
    el('completed').textContent = String(Math.round(completed));
    el('failed').textContent = String(Math.round(failed));
    var ft = Object.keys(fails).map(function (k) { return k + ' ' + Math.round(fails[k]); }).join('  ·  ');
    el('fails').textContent = ft ? '⚠ ' + ft : '';

    var sample = { active: active, phase: {} };
    var tb = el('phases'); tb.innerHTML = '';
    var latNow = [];
    for (var pi = 0; pi < PHASES.length; pi++) {
      var st = phaseStats(m, PHASES[pi]);
      sample.phase[PHASES[pi]] = st.avg || 0;
      if (st.avg) latNow.push(Math.round(st.avg) + 'ms');
      var tr = document.createElement('tr');
      tr.innerHTML = '<td class="phase">' + PHASES[pi] + '</td><td>' + Math.round(st.n) + '</td><td>' + fmtMs(st.avg) + '</td><td>' + fmtMs(st.p95) + '</td>';
      tb.appendChild(tr);
    }
    el('latNow').textContent = latNow.join('  ');
    if (!done) { samples.push(sample); if (samples.length > MAXPTS) samples.shift(); }
    renderCharts();
  }

  function fmtDur(ms) { var s = Math.round(ms / 1000); return Math.floor(s / 60) + 'm ' + pad2(s % 60) + 's'; }
  function p95Of(o, phase) { return o.timings && o.timings[phase] ? Math.round(o.timings[phase].p95) : null; }

  function renderSummary(o) {
    var total = (o.completed || 0) + (o.failed || 0) + (o.skipped || 0);
    var items = [
      ['Scenario', o.scenario || '—', ''],
      ['Peak users', o.peakUsers != null ? o.peakUsers : '—', 'amber'],
      ['Meetings', o.meetingsCreated != null ? o.meetingsCreated : '—', ''],
      ['Planned', o.plannedDurationMs != null ? fmtDur(o.plannedDurationMs) : '—', ''],
      ['Wall clock', o.wallClockMs != null ? fmtDur(o.wallClockMs) : '—', ''],
      ['Completed', o.completed || 0, 'green'],
      ['Failed', o.failed || 0, o.failed ? 'red' : 'muted'],
      ['api_join p95', fmtMs(p95Of(o, 'apiJoin')), ''],
      ['ws_connect p95', fmtMs(p95Of(o, 'wsConnect')), ''],
      ['user_join p95', fmtMs(p95Of(o, 'userJoin')), ''],
      ['first_data p95', fmtMs(p95Of(o, 'firstSubscriptionData')), ''],
      ['Knee', o.knee && o.knee.kneeUsers != null ? o.knee.kneeUsers + ' users' : 'none', o.knee && o.knee.kneeUsers != null ? 'amber' : 'green']
    ];
    var grid = el('sumgrid'); grid.innerHTML = '';
    items.forEach(function (it) {
      var d = document.createElement('div'); d.className = 'sumitem';
      d.innerHTML = '<div class="k">' + it[0] + '</div><div class="v ' + it[2] + '"></div>';
      d.querySelector('.v').textContent = String(it[1]);
      grid.appendChild(d);
    });
    var sloS = o.knee && o.knee.sloP95Ms ? o.knee.sloP95Ms / 1000 + 's' : 'the SLO';
    var kneeTxt = o.knee && o.knee.kneeUsers != null
      ? 'A knee appeared at ~' + o.knee.kneeUsers + ' concurrent users, where p95 join latency crossed the ' + sloS + ' SLO.'
      : 'No knee was found within ' + (o.peakUsers != null ? o.peakUsers : 'the peak') + ' users — p95 join latency stayed under the ' + sloS + ' SLO throughout.';
    var failTxt = '';
    if (o.failed) {
      var kinds = o.byKind ? Object.keys(o.byKind).map(function (k) { return k + ' ' + o.byKind[k]; }).join(', ') : '';
      failTxt = ' ' + o.failed + ' bot(s) failed' + (kinds ? ' (' + kinds + ')' : '') + '.';
    }
    el('sumtext').textContent =
      'Ramped to ' + (o.peakUsers != null ? o.peakUsers : '?') + ' signaling users across ' +
      (o.meetingsCreated != null ? o.meetingsCreated : '?') + ' meeting(s) over ' +
      (o.plannedDurationMs != null ? fmtDur(o.plannedDurationMs) : '?') + '. ' +
      (o.completed || 0) + ' of ' + total + ' bots joined and held successfully.' + failTxt +
      ' p95 join latency — api ' + fmtMs(p95Of(o, 'apiJoin')) + ', ws ' + fmtMs(p95Of(o, 'wsConnect')) +
      ', user_join ' + fmtMs(p95Of(o, 'userJoin')) + ', first-data ' + fmtMs(p95Of(o, 'firstSubscriptionData')) + '. ' + kneeTxt;
    el('summary').style.display = '';
  }

  function levelInfo(lv) {
    if (lv >= 50) return { c: 'error', t: 'ERROR' };
    if (lv >= 40) return { c: 'warn', t: 'WARN' };
    if (lv >= 30) return { c: 'info', t: 'INFO' };
    if (lv >= 20) return { c: 'debug', t: 'DEBUG' };
    return { c: 'other', t: 'LOG' };
  }
  var EXTRA_KEYS = ['bot', 'op', 'kind', 'meetingsCreated', 'meetingsEnded', 'peakUsers', 'completed', 'failed', 'port', 'userId'];
  function appendLog(raw) {
    var box = el('log');
    var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    var div = document.createElement('div'); div.className = 'ln';
    try {
      var o = JSON.parse(raw);
      if (o.msg === 'RUN REPORT') { done = true; try { renderSummary(o); } catch (e2) {} }
      var d = new Date(o.time || Date.now());
      var ts = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
      var li = levelInfo(o.level || 30);
      var extra = [];
      for (var e = 0; e < EXTRA_KEYS.length; e++) {
        var key = EXTRA_KEYS[e];
        if (o[key] !== undefined) { var v = Array.isArray(o[key]) ? o[key].length : o[key]; extra.push(key + '=' + v); }
      }
      div.innerHTML = '<span class="t">' + ts + '</span> <span class="lv ' + li.c + '">' + li.t + '</span> <span class="m"></span>' + (extra.length ? ' <span class="x"></span>' : '');
      div.querySelector('.m').textContent = o.msg || '';
      if (extra.length) div.querySelector('.x').textContent = extra.join(' ');
    } catch (err) {
      div.textContent = raw;
    }
    box.appendChild(div);
    while (box.childElementCount > 500) box.removeChild(box.firstChild);
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  function setConn(ok) {
    if (done) { el('conn').textContent = 'complete'; el('pulse').className = 'pulse done'; return; }
    el('conn').textContent = ok ? 'live' : 'offline';
    el('pulse').className = ok ? 'pulse' : 'pulse off';
  }

  function tick() {
    fetch('/metrics', { cache: 'no-store' }).then(function (res) { if (!res.ok) throw 0; return res.text(); })
      .then(function (t) { setConn(true); render(parse(t)); }).catch(function () { setConn(false); });
    fetch('/logs?after=' + logSeq, { cache: 'no-store' }).then(function (res) { return res.json(); })
      .then(function (j) { logSeq = j.nextSeq || logSeq; (j.lines || []).forEach(appendLog); }).catch(function () {});
  }

  el('endpoint').textContent = location.origin;
  renderLegend();
  window.addEventListener('resize', renderCharts);
  tick();
  setInterval(tick, 500);
})();
</script>
</body>
</html>`;
