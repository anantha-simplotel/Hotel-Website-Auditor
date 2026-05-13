const $ = (id) => document.getElementById(id);
let currentReport = null;
let tipTimer = null;
let progressTimer = null;
let progressValue = 0;

const API_BASE = 'https://hotel-website-auditor.vercel.app';

const loadingTips = [
  'Direct booking tip: your booking button should be easier to find than the nearest beach bar.',
  'OTA-proofing in progress: fewer clicks, clearer prices, stronger reasons to book direct.',
  'Speed check running: guests do not wait politely. They bounce.',
  'Direct booking wisdom: if guests have to hunt for your best rate, OTAs just won a round.',
  'Good hotel websites answer three questions fast: why stay, why direct, why now.',
  'Checking friction: every extra step is a tiny invitation to compare elsewhere.',
  'Tiny fix, big impact: make the direct-booking value visible before the guest scrolls.',
  'Almost there: we are checking whether your website helps the booking or slows the guest down.'
];

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

function benchmarkFor(label) {
  const text = String(label || '').toLowerCase();

  if (text.includes('mobile')) return 75;
  if (text.includes('desktop')) return 85;
  if (text.includes('seo')) return 85;
  if (text.includes('quality') || text.includes('best')) return 85;
  if (text.includes('accessibility') || text.includes('ai')) return 85;

  return 85;
}

function categoryExplain(label) {
  const text = String(label || '').toLowerCase();

  if (text.includes('mobile')) {
    return 'How quickly and smoothly the website performs on phones.';
  }

  if (text.includes('desktop')) {
    return 'Desktop loading and interaction experience.';
  }

  if (text.includes('seo')) {
    return 'Technical search visibility and indexing readiness.';
  }

  if (text.includes('quality') || text.includes('best')) {
    return 'Security, browser compatibility, and site reliability.';
  }

  if (text.includes('accessibility') || text.includes('ai')) {
    return 'How clearly the website structure can be understood by guests and machines.';
  }

  return 'Website quality benchmark.';
}
function scoreStatus(score, benchmark) {
  if (score == null) return 'unable';
  if (score >= benchmark) return 'good';
  if (score >= benchmark - 20) return 'warn';
  return 'poor';
}

function barRow(label, score) {
  const value = score == null ? 0 : Math.max(0, Math.min(100, Number(score)));
  const benchmark = benchmarkFor(label);
  const status = scoreStatus(score, benchmark);

  const scoreAngle = -90 + (value * 1.8);
  const benchmarkAngle = -90 + (benchmark * 1.8);

  return `
    <div class="gauge-row">
      <div class="gauge-copy">
        <h3>${escapeHtml(label)}</h3>
        <p>${escapeHtml(categoryExplain(label))}</p>
      </div>

      <div class="gauge ${status}">
        <div class="gauge-arc">
          <div class="gauge-fill" style="--score-angle:${scoreAngle}deg"></div>
          <div class="gauge-mask"></div>
          <div class="gauge-needle" style="--benchmark-angle:${benchmarkAngle}deg"></div>
          <div class="gauge-benchmark" style="--benchmark-angle:${benchmarkAngle}deg">Target ${benchmark}</div>
          <div class="gauge-zero">0</div>
          <div class="gauge-hundred">100</div>
        </div>
        <div class="gauge-score">${score == null ? 'Unable' : `${value}/100`}</div>
      </div>
    </div>
  `;
}

function metricLine(label, value, help = '') {
  return `<div class="metric-line"><b>${escapeHtml(label)}${help ? `<small>${escapeHtml(help)}</small>` : ''}</b><span>${escapeHtml(value || 'Unable to verify')}</span></div>`;
}

function opportunityHtml(item) {
  const value = item.displayValue ? ` — ${item.displayValue}` : '';
  const titleMap = {
    'uses-responsive-images': 'Serve right-sized images',
    'offscreen-images': 'Delay hidden images',
    'render-blocking-resources': 'Remove loading blockers',
    'unused-javascript': 'Reduce unused JavaScript',
    'unused-css-rules': 'Reduce unused CSS',
    'server-response-time': 'Improve server response time',
    'modern-image-formats': 'Use modern image formats',
    'uses-optimized-images': 'Compress heavy images'
  };
  const friendlyTitle = titleMap[item.id] || item.title;
  return `<div class="check"><b>${escapeHtml(friendlyTitle)}</b><span>${escapeHtml(value || 'Flagged')}</span></div>`;
}

function footerHtml() {
  return `<div class="footer-note"><span><img src="/simplotel-logo.png" alt="Simplotel" class="footer-logo"></span><span>Audited by Simplotel</span></div>`;
}

function renderReport(report) {
  currentReport = report;
  const scores = report.scores || {};
  const labels = report.labels || {};
  const metrics = report.metrics || {};
  const issues = report.issues || [];
  const fixes = report.quickFixes || [];
  const opps = report.opportunities || [];
  const mobile = report.pageSpeed?.mobile || null;
  const desktop = report.pageSpeed?.desktop || null;
  const pages = `
    <article class="page">
      <header class="report-header">
        <div>
          <div class="report-kicker">Direct Booking Website Audit</div>
          <h1 class="report-title">${escapeHtml(report.hotelName)}</h1>
          <div class="report-url">${escapeHtml(report.website)}</div>
        </div>
        <div class="date-pill">${escapeHtml(fmtDate(report.generatedAt))}</div>
      </header>

      <section class="hero-score">
        <div class="score-orb">
          <div class="score">${scoreText(scores.directBookingReadiness)}</div>
          <div class="label">Direct Booking<br>Readiness</div>
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
        ${cardMetric('Site Quality', scores.bestPractices, labels.bestPractices)}
        ${cardMetric('AI & Accessibility', scores.accessibility, labels.accessibility)}
      </section>

      <section class="section-card tint">
        <h2 class="section-headline">Top issues to prioritise</h2>
        <div class="issue-list">${issues.slice(0,4).map(item => issueHtml(item, true)).join('')}</div>
      </section>

      <section class="section-card blue">
        <h2 class="section-headline">Recommended quick fixes</h2>
        <div class="fix-grid">${fixes.slice(0,3).map((item, idx) => fixHtml(item, idx, true)).join('')}</div>
      </section>

      ${footerHtml()}
    </article>

    <article class="page page-2">
      <header class="report-header">
        <div>
          <div class="report-kicker">Detailed breakdown</div>
          <h1 class="report-title">What is affecting the website?</h1>
          <div class="report-url">${escapeHtml(report.host)}</div>
        </div>
        <div class="date-pill">Page 2</div>
      </header>

      <section class="section-card compact-section">
        <h2 class="section-headline">Category score benchmarks</h2>
        ${barRow('Mobile Performance', scores.mobilePerformance, 'How well the website loads and responds on phones.')}
        ${barRow('Desktop Performance', scores.desktopPerformance, 'How well the website loads and responds on desktop.')}
        ${barRow('SEO', scores.seo, 'Technical search-readiness signals checked by Lighthouse.')}
        ${barRow('Site Quality', scores.bestPractices, 'Security, browser compatibility, and quality signals.')}
        ${barRow('AI & Accessibility', scores.accessibility, 'Clear, accessible structure that helps guests and machine understanding.')}
      </section>

      <section class="detail-grid print-keep">
        <div class="section-card compact-section">
          <h2 class="section-headline">Mobile speed metrics</h2>
          <div class="metric-table">
            ${metricLine('LCP', metrics.lcp?.display, 'How fast the main hero/booking content appears.')}
            ${metricLine('FCP', metrics.fcp?.display, 'How fast the first visible content appears.')}
            ${metricLine('Speed Index', metrics.speedIndex?.display, 'How quickly the visible page feels loaded.')}
            ${metricLine('Blocking Time', metrics.tbt?.display, 'Delay caused by heavy scripts before the page responds.')}
            ${metricLine('Layout Stability', metrics.cls?.display, 'Whether content jumps while loading.')}
          </div>
        </div>
        <div class="section-card compact-section">
          <h2 class="section-headline">Why LCP matters</h2>
          <p class="explain">LCP shows when the main visible content is ready for the visitor. For a hotel website, this is often the hero image, headline, offer, or booking area. A slow LCP can make guests wait before they even begin deciding or booking.</p>
        </div>
      </section>

      <section class="detail-grid print-keep">
        <div class="section-card compact-section">
          <h2 class="section-headline">Mobile improvement opportunities</h2>
          <div class="check-list">${opps.length ? opps.slice(0,5).map(opportunityHtml).join('') : '<div class="check"><b>No major opportunities returned</b><span>Checked</span></div>'}</div>
        </div>
</section>
      ${footerHtml()}
    </article>`;
  $('reportPages').innerHTML = pages;
  $('landingView').classList.add('hidden');
  $('reportView').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cleanToken(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function looseHotelWebsiteMatch(hotelName, website) {
  let host = '';
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    host = url.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return false;
  }
  const compactHost = cleanToken(host.replace(/\.[a-z.]+$/i, '')).replace(/\s+/g, '');
  const ignored = new Set(['the', 'hotel', 'hotels', 'resort', 'resorts', 'villa', 'villas', 'beach', 'spa', 'and', 'by', 'at', 'inn', 'suites', 'suite', 'official']);
  const tokens = cleanToken(hotelName).split(/\s+/).filter(token => token.length >= 3 && !ignored.has(token));
  if (!tokens.length) return true;
  return tokens.some(token => compactHost.includes(token)) || compactHost.includes(tokens.join(''));
}

function startLoading() {
  clearInterval(tipTimer);
  clearInterval(progressTimer);
  progressValue = 0;
  $('loadingPanel').classList.remove('hidden');
  $('statusText').textContent = '';
  $('tipText').textContent = loadingTips[0];
  $('progressFill').style.width = '0%';
  $('progressText').textContent = '0%';

  let tipIndex = 0;
  tipTimer = setInterval(() => {
    tipIndex = (tipIndex + 1) % loadingTips.length;
    $('tipText').textContent = loadingTips[tipIndex];
  }, 3500);

  progressTimer = setInterval(() => {
    const increment = progressValue < 70 ? 7 : progressValue < 88 ? 3 : 1;
    progressValue = Math.min(94, progressValue + increment);
    $('progressFill').style.width = `${progressValue}%`;
    $('progressText').textContent = progressValue >= 90 ? `${progressValue}% · almost there` : `${progressValue}%`;
  }, 1200);
}

function stopLoading(done = false) {
  clearInterval(tipTimer);
  clearInterval(progressTimer);
  if (done) {
    $('progressFill').style.width = '100%';
    $('progressText').textContent = '100% · audit ready';
  }
}

function resetToHome() {
  $('reportView').classList.add('hidden');
  $('landingView').classList.remove('hidden');
  $('statusText').textContent = '';
  $('loadingPanel').classList.add('hidden');
  $('auditForm').reset();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('auditForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const hotelName = $('hotelName').value.trim();
  const website = $('website').value.trim();

  if (!looseHotelWebsiteMatch(hotelName, website)) {
    $('statusText').textContent = 'The hotel name and website URL do not seem to match. Please check the official website before running the audit.';
    return;
  }

  const payload = { hotelName, website };
  $('submitBtn').disabled = true;
  $('submitBtn').textContent = 'Auditing your website...';
  startLoading();

  try {
    const res = await fetch(`${API_BASE}/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Audit failed');
    stopLoading(true);
    setTimeout(() => renderReport(data.report), 350);
  } catch (err) {
    stopLoading(false);
    $('statusText').textContent = err.message;
  } finally {
    $('submitBtn').disabled = false;
    $('submitBtn').textContent = 'Generate my audit';
  }
});

$('printBtn').addEventListener('click', () => window.print());
$('newAuditBtn').addEventListener('click', resetToHome);
$('homeBtn').addEventListener('click', resetToHome);

fetch(`${API_BASE}/api/health`).catch(() => null);
