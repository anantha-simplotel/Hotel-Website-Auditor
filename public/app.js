const $ = (id) => document.getElementById(id);
let currentReport = null;

function scoreClass(score) {
  if (score == null) return 'medium';
  if (score >= 90) return 'low';
  if (score >= 50) return 'medium';
  return 'high';
}

function scoreText(score) {
  return score == null ? 'Unable' : `${score}`;
}

function scoreOutOf100(score) {
  return score == null ? 'Unable' : `${score}/100`;
}

function pct(score) {
  return Math.max(0, Math.min(100, Number(score || 0)));
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return ''; }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[ch]));
}

function shorten(value, max = 135) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function cardMetric(label, score, sub) {
  const value = scoreOutOf100(score);
  return `<div class="metric-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span><small>${escapeHtml(sub || '')}</small></div>`;
}

function issueHtml(item, compact = false) {
  const sev = item.severity || 'medium';
  const detail = compact ? shorten(item.detail, 125) : item.detail;
  return `<div class="issue"><div class="severity ${sev}">${sev === 'high' ? 'Priority' : sev}</div><div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(detail)}</p></div></div>`;
}

function fixHtml(text, idx, compact = false) {
  return `<div class="fix"><div class="num">${idx + 1}</div><p>${escapeHtml(compact ? shorten(text, 110) : text)}</p></div>`;
}

function barRow(label, score) {
  const value = score == null ? 0 : score;
  const display = score == null ? 'Unable' : `${score}`;
  return `<div class="bar-row"><div class="bar-label">${escapeHtml(label)}</div><div class="bar-track"><div class="bar-fill" style="width:${pct(value)}%"></div></div><div class="bar-score">${escapeHtml(display)}</div></div>`;
}

function metricLine(label, value) {
  return `<div class="metric-line"><b>${escapeHtml(label)}</b><span>${escapeHtml(value || 'Unable to verify')}</span></div>`;
}

function opportunityHtml(item) {
  const value = item.displayValue ? ` — ${item.displayValue}` : '';
  return `<div class="check"><b>${escapeHtml(item.title)}</b><span>${escapeHtml(value || 'Flagged')}</span></div>`;
}

function renderReport(report) {
  currentReport = report;
  const scores = report.scores || {};
  const labels = report.labels || {};
  const metrics = report.metrics || {};
  const issues = report.issues || [];
  const fixes = report.quickFixes || [];
  const opps = report.opportunities || [];
  const errors = report.errors || [];
  const mobile = report.pageSpeed?.mobile || null;
  const desktop = report.pageSpeed?.desktop || null;
  const pages = `
    <article class="page">
      <header class="report-header">
        <div>
          <div class="report-kicker">CHTA Direct Booking Website Audit</div>
          <h1 class="report-title">${escapeHtml(report.hotelName)}</h1>
          <div class="report-url">${escapeHtml(report.website)}</div>
        </div>
        <div class="date-pill">${escapeHtml(fmtDate(report.generatedAt))}</div>
      </header>

      <section class="hero-score">
        <div class="score-orb">
          <div class="score">${scoreText(scores.directBookingReadiness)}</div>
          <div class="label">Direct Booking Readiness</div>
        </div>
        <div class="score-context">
          <h3>${escapeHtml(report.readiness?.label || labels.directBookingReadiness || 'Direct booking readiness')}</h3>
          <p>${escapeHtml(report.readiness?.description || '')}</p>
          <div class="readiness-scale">
            <span>90–100 Excellent</span>
            <span>80–89 Strong</span>
            <span>65–79 Moderate</span>
            <span>50–64 Focus needed</span>
            <span>&lt;50 High friction</span>
          </div>
        </div>
      </section>

      <section class="metric-grid">
        ${cardMetric('Mobile Performance', scores.mobilePerformance, labels.mobilePerformance)}
        ${cardMetric('Desktop Performance', scores.desktopPerformance, labels.desktopPerformance)}
        ${cardMetric('SEO', scores.seo, labels.seo)}
        ${cardMetric('Best Practices', scores.bestPractices, labels.bestPractices)}
        ${cardMetric('Accessibility', scores.accessibility, labels.accessibility)}
      </section>

      <section class="section-card tint">
        <h2 class="section-headline">Top issues to prioritise</h2>
        <div class="issue-list">${issues.slice(0,4).map(item => issueHtml(item, true)).join('')}</div>
      </section>

      <section class="section-card blue">
        <h2 class="section-headline">Recommended quick fixes</h2>
        <div class="fix-grid">${fixes.slice(0,3).map((item, idx) => fixHtml(item, idx, true)).join('')}</div>
      </section>

      <div class="footer-note"><span>Audited by Simplotel</span><span>Powered by Simplotel</span></div>
    </article>

    <article class="page">
      <header class="report-header">
        <div>
          <div class="report-kicker">Detailed breakdown</div>
          <h1 class="report-title">What is affecting the website?</h1>
          <div class="report-url">${escapeHtml(report.host)}</div>
        </div>
        <div class="date-pill">Page 2</div>
      </header>

      <section class="section-card">
        <h2 class="section-headline">Category score benchmarks</h2>
        ${barRow('Mobile Performance', scores.mobilePerformance)}
        ${barRow('Desktop Performance', scores.desktopPerformance)}
        ${barRow('SEO', scores.seo)}
        ${barRow('Best Practices', scores.bestPractices)}
        ${barRow('Accessibility', scores.accessibility)}
      </section>

      <section class="detail-grid">
        <div class="section-card">
          <h2 class="section-headline">Mobile speed metrics</h2>
          <div class="metric-table">
            ${metricLine('LCP - main content load', metrics.lcp?.display)}
            ${metricLine('FCP - first visible content', metrics.fcp?.display)}
            ${metricLine('Speed Index', metrics.speedIndex?.display)}
            ${metricLine('Total Blocking Time', metrics.tbt?.display)}
            ${metricLine('CLS - layout stability', metrics.cls?.display)}
          </div>
        </div>
        <div class="section-card">
          <h2 class="section-headline">Why LCP matters</h2>
          <p class="explain">LCP shows when the main visible content is ready for the visitor. For a hotel website, this is often the hero image, headline, or booking area. A slow LCP can make guests wait before they even begin deciding or booking.</p>
        </div>
      </section>

      <section class="detail-grid">
        <div class="section-card">
          <h2 class="section-headline">Mobile improvement opportunities</h2>
          <div class="check-list">${opps.length ? opps.slice(0,5).map(opportunityHtml).join('') : '<div class="check"><b>No major opportunities returned</b><span>Checked</span></div>'}</div>
        </div>
        <div class="section-card">
          <h2 class="section-headline">Run details</h2>
          <div class="metric-table">
            ${metricLine('Mobile final URL', mobile?.finalUrl || report.website)}
            ${metricLine('Desktop final URL', desktop?.finalUrl || report.website)}
            ${metricLine('Mobile fetch time', mobile?.fetchTime || 'Unable to verify')}
            ${metricLine('Desktop fetch time', desktop?.fetchTime || 'Unable to verify')}
          </div>
        </div>
      </section>

      ${errors.length ? `<section class="section-card error-note"><h2 class="section-headline">Audit notes</h2><p class="explain">${escapeHtml(errors.join(' | '))}</p></section>` : ''}

      <div class="footer-note"><span>CHTA Direct Booking Audit</span><span>Powered by Simplotel</span></div>
    </article>`;
  $('reportPages').innerHTML = pages;
  $('landingView').classList.add('hidden');
  $('reportView').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('auditForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    hotelName: $('hotelName').value,
    website: $('website').value,
    prospectName: $('prospectName').value,
    email: $('email').value
  };
  $('submitBtn').disabled = true;
  $('submitBtn').textContent = 'Generating audit...';
  $('statusText').textContent = 'Running mobile and desktop website checks. Please wait around 20–60 seconds.';
  try {
    const res = await fetch('https://hotel-website-auditor.vercel.app/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Audit failed');
    renderReport(data.report);
  } catch (err) {
    $('statusText').textContent = err.message;
  } finally {
    $('submitBtn').disabled = false;
    $('submitBtn').textContent = 'Generate my audit';
  }
});

$('printBtn').addEventListener('click', () => window.print());
$('newAuditBtn').addEventListener('click', () => {
  $('reportView').classList.add('hidden');
  $('landingView').classList.remove('hidden');
  $('statusText').textContent = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

fetch('https://hotel-website-auditor.vercel.app/api/health').catch(() => null);
