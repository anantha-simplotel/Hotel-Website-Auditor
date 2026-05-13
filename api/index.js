const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const ROOT_DIR = path.join(__dirname, '..');

function loadEnvFile() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  });
}
loadEnvFile();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = null;
const LEADS_FILE = null;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://www.simplotel.live,https://hotel-website-auditor.vercel.app')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT_DIR, 'public')));

function normalizeUrl(input) {
  let value = String(input || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function hostFromUrl(input) {
  try {
    return new URL(input).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
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

function hotelNameMatchesWebsite(hotelName, url) {
  const host = hostFromUrl(url).replace(/\.[a-z]{2,}$/i, '').replace(/\.(com|net|org|co|hotel|hotels|in|live|travel)$/i, '');
  const compactHost = cleanToken(host).replace(/\s+/g, '');
  const ignored = new Set(['the', 'hotel', 'hotels', 'resort', 'resorts', 'villa', 'villas', 'beach', 'spa', 'and', 'by', 'at', 'inn', 'suites', 'suite', 'official']);
  const tokens = cleanToken(hotelName)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !ignored.has(token));

  if (!tokens.length) return true; // Avoid blocking very short names like “AV”.
  const matched = tokens.filter((token) => compactHost.includes(token) || token.includes(compactHost)).length;
  if (matched >= 1) return true;

  const compactName = tokens.join('');
  return compactName.length >= 4 && (compactHost.includes(compactName) || compactName.includes(compactHost));
}

function loadLeads() {
  return [];
}

function saveLead(record) {
  // Vercel's filesystem is read-only at runtime. Store leads in Google Sheets/Supabase later.
  console.log('Lead captured:', record);
}

function escapeCsv(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function metricValue(audits, key) {
  const audit = audits && audits[key];
  if (!audit) return { display: 'Unable to verify', numeric: null, raw: null };
  return { display: audit.displayValue || 'Unable to verify', numeric: audit.numericValue ?? null, raw: audit };
}

function categoryScore(categories, key) {
  const score = categories?.[key]?.score;
  if (score == null) return null;
  const rawScore = Math.round(score * 100);

  // Performance remains closest to Lighthouse. Non-performance categories are calibrated
  // slightly stricter for hotel direct-booking readiness so “green” is not too easy.
  if (key === 'seo') return Math.max(0, Math.round(rawScore * 0.88));
  if (key === 'best-practices') return Math.max(0, Math.round(rawScore * 0.85));
  if (key === 'accessibility') return Math.max(0, Math.round(rawScore * 0.88));
  return rawScore;
}

function labelForScore(score) {
  if (score == null) return 'Unable to verify';
  if (score >= 85) return 'Good';
  if (score >= 65) return 'Needs improvement';
  if (score >= 50) return 'Needs focused improvement';
  return 'Poor';
}

function calculateDirectBookingReadiness(scores) {
  const items = [
    { key: 'mobilePerformance', weight: 0.42, required: true },
    { key: 'desktopPerformance', weight: 0.18, required: false },
    { key: 'seo', weight: 0.20, required: false },
    { key: 'bestPractices', weight: 0.10, required: false },
    { key: 'accessibility', weight: 0.10, required: false }
  ];

  if (typeof scores.mobilePerformance !== 'number') return null;

  const available = items.filter((item) => typeof scores[item.key] === 'number');
  const totalWeight = available.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) return null;

  const weighted = available.reduce((sum, item) => sum + scores[item.key] * item.weight, 0) / totalWeight;
  return Math.round(weighted);
}

function readinessLabel(score) {
  if (score == null) return 'Unable to verify';
  if (score >= 90) return 'Excellent readiness';
  if (score >= 80) return 'Strong readiness';
  if (score >= 65) return 'Moderate readiness';
  if (score >= 50) return 'Needs focused improvement';
  return 'High-friction experience';
}

function readinessDescription(score) {
  if (score == null) return 'The audit could not calculate readiness because mobile performance was unavailable during this run. Try again in a few minutes.';
  if (score >= 90) return 'The website’s core technical signals are strong for keeping high-intent guests on the direct booking path.';
  if (score >= 80) return 'The website has a strong direct-booking foundation, with a few optimisation opportunities that can still improve conversion confidence.';
  if (score >= 65) return 'The website has a usable foundation, but performance or quality signals may still create friction before guests enquire or book directly.';
  if (score >= 50) return 'Several signals suggest guests may face noticeable friction before enquiring or booking directly. Focused improvements can help reduce drop-offs.';
  return 'The current signals point to meaningful friction that can push high-intent guests back to comparison sites or OTAs.';
}

function shortError(err) {
  const text = String(err?.message || err || '').replace(/\s+/g, ' ');
  if (/aborted|timeout|timed out/i.test(text)) return 'One check timed out. We retried before preparing this report.';
  if (/500|Something went wrong|Lighthouse|PageSpeed|audit/i.test(text)) return 'One check could not be completed by the testing service after retry.';
  return text.slice(0, 220);
}

function pickOpportunities(audits) {
  const list = Object.entries(audits || {})
    .map(([id, audit]) => ({
      id,
      title: audit?.title || id,
      description: audit?.description || '',
      displayValue: audit?.displayValue || '',
      score: audit?.score,
      numericValue: audit?.numericValue ?? null,
      savingsMs: audit?.details?.overallSavingsMs ?? 0,
      type: audit?.details?.type || ''
    }))
    .filter((a) => {
      if (a.score === null || a.score === undefined) return false;
      if (a.score >= 1) return false;
      return a.type === 'opportunity' || a.savingsMs > 0 || Boolean(a.displayValue);
    })
    .sort((a, b) => (b.savingsMs || 0) - (a.savingsMs || 0));
  return list.slice(0, 5);
}

async function runPageSpeedOnce(url, strategy = 'mobile') {
  const apiKey = process.env.PAGESPEED_API_KEY || '';
  const params = new URLSearchParams();
  params.set('url', url);
  params.set('strategy', strategy);
  params.append('category', 'performance');
  params.append('category', 'seo');
  params.append('category', 'best-practices');
  params.append('category', 'accessibility');
  if (apiKey) params.set('key', apiKey);

  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`;
  const res = await fetchWithTimeout(endpoint, {}, 45000);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${strategy === 'mobile' ? 'Mobile' : 'Desktop'} check failed (${res.status}). ${body.slice(0, 220)}`);
  }

  const data = await res.json();
  const lh = data.lighthouseResult || {};
  const categories = lh.categories || {};
  const audits = lh.audits || {};
  const lcp = metricValue(audits, 'largest-contentful-paint');
  const fcp = metricValue(audits, 'first-contentful-paint');
  const cls = metricValue(audits, 'cumulative-layout-shift');
  const tbt = metricValue(audits, 'total-blocking-time');
  const speedIndex = metricValue(audits, 'speed-index');

  return {
    strategy,
    finalUrl: lh.finalDisplayedUrl || lh.finalUrl || url,
    fetchTime: lh.fetchTime || '',
    userAgent: lh.userAgent || '',
    categories: {
      performance: categoryScore(categories, 'performance'),
      seo: categoryScore(categories, 'seo'),
      bestPractices: categoryScore(categories, 'best-practices'),
      accessibility: categoryScore(categories, 'accessibility')
    },
    metrics: {
      lcp: { display: lcp.display, ms: lcp.numeric },
      fcp: { display: fcp.display, ms: fcp.numeric },
      cls: { display: cls.display, value: cls.numeric },
      tbt: { display: tbt.display, ms: tbt.numeric },
      speedIndex: { display: speedIndex.display, ms: speedIndex.numeric }
    },
    opportunities: pickOpportunities(audits)
  };
}

async function runPageSpeed(url, strategy = 'mobile', attempts = 2) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runPageSpeedOnce(url, strategy);
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  throw lastError;
}

function issue(title, detail, severity = 'medium', source = 'Audit signal') {
  return { title, detail, severity, source };
}

function buildIssues({ mobile, desktop }) {
  const issues = [];
  const mobilePerf = mobile?.categories?.performance ?? null;
  const desktopPerf = desktop?.categories?.performance ?? null;
  const seo = mobile?.categories?.seo ?? desktop?.categories?.seo ?? null;
  const bestPractices = mobile?.categories?.bestPractices ?? desktop?.categories?.bestPractices ?? null;
  const accessibility = mobile?.categories?.accessibility ?? desktop?.categories?.accessibility ?? null;
  const lcpMs = mobile?.metrics?.lcp?.ms ?? null;
  const tbtMs = mobile?.metrics?.tbt?.ms ?? null;
  const clsValue = mobile?.metrics?.cls?.value ?? null;

  if (mobilePerf == null) {
    issues.push(issue('Mobile performance could not be verified', 'The mobile test did not return a score even after retry. Run the audit again later or check if the website blocks testing tools.', 'high'));
  } else if (mobilePerf < 45) {
    issues.push(issue('Mobile performance is poor', `Mobile Performance score is ${mobilePerf}/100. Slow mobile pages can push guests back to OTAs.`, 'high'));
  } else if (mobilePerf < 75) {
    issues.push(issue('Mobile performance needs improvement', `Mobile Performance score is ${mobilePerf}/100. Improving mobile speed can reduce booking drop-offs.`, 'medium'));
  }

  if (lcpMs != null && lcpMs > 4000) {
    issues.push(issue('Main content loads too late', `The main visible content loads in ${mobile.metrics.lcp.display}. Hotel hero images and booking sections should appear faster.`, 'high'));
  } else if (lcpMs != null && lcpMs > 2500) {
    issues.push(issue('Hero/main content can load faster', `Largest Contentful Paint is ${mobile.metrics.lcp.display}.`, 'medium'));
  }

  if (tbtMs != null && tbtMs > 600) {
    issues.push(issue('Page interaction may feel delayed', `Total Blocking Time is ${mobile.metrics.tbt.display}. Visitors may tap but feel the site is not responding quickly.`, 'high'));
  } else if (tbtMs != null && tbtMs > 200) {
    issues.push(issue('JavaScript blocking time needs attention', `Total Blocking Time is ${mobile.metrics.tbt.display}.`, 'medium'));
  }

  if (clsValue != null && clsValue > 0.25) {
    issues.push(issue('Layout shifts may disturb guests', `Cumulative Layout Shift is ${mobile.metrics.cls.display}. Buttons, images, or booking widgets may move while loading.`, 'high'));
  } else if (clsValue != null && clsValue > 0.1) {
    issues.push(issue('Layout stability can be improved', `Cumulative Layout Shift is ${mobile.metrics.cls.display}.`, 'medium'));
  }

  if (desktopPerf != null && desktopPerf < 45) issues.push(issue('Desktop performance is poor', `Desktop Performance score is ${desktopPerf}/100.`, 'medium'));
  if (seo != null && seo < 85) issues.push(issue('SEO score needs improvement', `SEO score is ${seo}/100. Important discovery and indexing signals may need attention.`, 'medium'));
  if (bestPractices != null && bestPractices < 85) issues.push(issue('Site quality score needs attention', `Site Quality score is ${bestPractices}/100. This reflects security, browser compatibility, and quality signals.`, 'medium'));
  if (accessibility != null && accessibility < 85) issues.push(issue('AI & accessibility signals can improve', `AI & Accessibility score is ${accessibility}/100. Clear, accessible content helps both guests and machines understand the page.`, 'low'));

  if (!issues.length) issues.push(issue('Core website fundamentals look good', 'The audited category scores look strong for the checks included in this audit.', 'low'));
  return issues.slice(0, 5);
}

function buildQuickFixes(mobile) {
  const opportunities = mobile?.opportunities || [];
  if (!opportunities.length) return ['No major mobile improvement opportunities were returned during this run. Review category scores and booking journey manually for next steps.'];
  return opportunities.slice(0, 3).map((o) => `${o.title}${o.displayValue ? ` — ${o.displayValue}` : ''}`);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasPageSpeedKey: Boolean(process.env.PAGESPEED_API_KEY) });
});

app.post('/api/audit', async (req, res) => {
  const startedAt = new Date();
  try {
    const hotelName = String(req.body.hotelName || '').trim();
    const rawWebsite = String(req.body.website || '').trim();
    const url = normalizeUrl(rawWebsite);
    if (!hotelName) return res.status(400).json({ error: 'Please enter the hotel name.' });
    if (!url) return res.status(400).json({ error: 'Please enter a valid website URL.' });
    if (!hotelNameMatchesWebsite(hotelName, url)) {
      return res.status(400).json({
        error: 'The hotel name and website URL do not seem to match. Please check the official website before running the audit.'
      });
    }

    let mobile = null;
    let desktop = null;
    const errors = [];

    const [mobileResult, desktopResult] = await Promise.allSettled([
  runPageSpeed(url, 'mobile', 1),
  runPageSpeed(url, 'desktop', 1)
]);

if (mobileResult.status === 'fulfilled') {
  mobile = mobileResult.value;
} else {
  errors.push(shortError(mobileResult.reason));
}

if (desktopResult.status === 'fulfilled') {
  desktop = desktopResult.value;
} else {
  errors.push(shortError(desktopResult.reason));
}

    const categoryScores = {
      mobilePerformance: mobile?.categories?.performance ?? null,
      desktopPerformance: desktop?.categories?.performance ?? null,
      mobileSeo: mobile?.categories?.seo ?? null,
      desktopSeo: desktop?.categories?.seo ?? null,
      mobileBestPractices: mobile?.categories?.bestPractices ?? null,
      desktopBestPractices: desktop?.categories?.bestPractices ?? null,
      mobileAccessibility: mobile?.categories?.accessibility ?? null,
      desktopAccessibility: desktop?.categories?.accessibility ?? null
    };

    const displayScores = {
      mobilePerformance: categoryScores.mobilePerformance,
      desktopPerformance: categoryScores.desktopPerformance,
      seo: categoryScores.mobileSeo ?? categoryScores.desktopSeo,
      bestPractices: categoryScores.mobileBestPractices ?? categoryScores.desktopBestPractices,
      accessibility: categoryScores.mobileAccessibility ?? categoryScores.desktopAccessibility
    };

    const directBookingReadiness = calculateDirectBookingReadiness(displayScores);
    const issues = buildIssues({ mobile, desktop });
    const quickFixes = buildQuickFixes(mobile);

    const report = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      generatedAt: startedAt.toISOString(),
      hotelName: hotelName || hostFromUrl(url) || 'Hotel website',
      website: url,
      host: hostFromUrl(url),
      scoreSource: 'Scores are generated from Google PageSpeed/Lighthouse signals. Direct Booking Readiness is a Simplotel-weighted summary for hotel website conversion readiness.',
      scores: { ...displayScores, directBookingReadiness },
      labels: {
        directBookingReadiness: readinessLabel(directBookingReadiness),
        mobilePerformance: labelForScore(displayScores.mobilePerformance),
        desktopPerformance: labelForScore(displayScores.desktopPerformance),
        seo: labelForScore(displayScores.seo),
        bestPractices: labelForScore(displayScores.bestPractices),
        accessibility: labelForScore(displayScores.accessibility)
      },
      readiness: {
        score: directBookingReadiness,
        label: readinessLabel(directBookingReadiness),
        description: readinessDescription(directBookingReadiness),
        formula: 'Weighted from Mobile Performance, Desktop Performance, SEO, Site Quality, and AI & Accessibility signals. If desktop is unavailable after retry, readiness is calculated from available verified scores.'
      },
      exactCategoryScores: categoryScores,
      metrics: {
        lcp: mobile?.metrics?.lcp || { display: 'Unable to verify', ms: null },
        fcp: mobile?.metrics?.fcp || { display: 'Unable to verify', ms: null },
        cls: mobile?.metrics?.cls || { display: 'Unable to verify', value: null },
        tbt: mobile?.metrics?.tbt || { display: 'Unable to verify', ms: null },
        speedIndex: mobile?.metrics?.speedIndex || { display: 'Unable to verify', ms: null }
      },
      pageSpeed: { mobile, desktop },
      issues,
      quickFixes,
      opportunities: mobile?.opportunities || [],
      errors
    };

    saveLead({
      generatedAt: report.generatedAt,
      hotelName: report.hotelName,
      website: url,
      host: report.host,
      directBookingReadiness,
      mobilePerformance: displayScores.mobilePerformance,
      desktopPerformance: displayScores.desktopPerformance,
      seo: displayScores.seo,
      bestPractices: displayScores.bestPractices,
      accessibility: displayScores.accessibility,
      topIssue: issues[0]?.title || '',
      errors: errors.join(' | ')
    });

    res.json({ report });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Audit failed.' });
  }
});

app.get('/api/leads.csv', (req, res) => {
  const leads = loadLeads();
  const columns = ['generatedAt', 'hotelName', 'website', 'host', 'directBookingReadiness', 'mobilePerformance', 'desktopPerformance', 'seo', 'bestPractices', 'accessibility', 'topIssue', 'errors'];
  const csv = [columns.join(','), ...leads.map((row) => columns.map((c) => escapeCsv(row[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="hotel-audit-leads.csv"');
  res.send(csv);
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Hotel website audit app running on http://localhost:${PORT}`));
}

module.exports = app;
