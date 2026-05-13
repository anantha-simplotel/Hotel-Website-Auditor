const fs = require('fs');
const path = require('path');
const express = require('express');

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

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  });
}

loadEnvFile();

const app = express();

const DATA_DIR = path.join(ROOT_DIR, 'data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(LEADS_FILE)) fs.writeFileSync(LEADS_FILE, '[]', 'utf8');

app.use(cors());
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
    return new URL(input).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function loadLeads() {
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveLead(record) {
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
  if (!audit) {
    return {
      display: 'Unable to verify',
      numeric: null,
      raw: null
    };
  }

  return {
    display: audit.displayValue || 'Unable to verify',
    numeric: audit.numericValue ?? null,
    raw: audit
  };
}

function categoryScore(categories, key) {
  const score = categories?.[key]?.score;
  if (score == null) return null;

  const rawScore = Math.round(score * 100);

  if (key === 'seo') {
    return Math.max(0, Math.round(rawScore * 0.90));
  }

  if (key === 'best-practices') {
    return Math.max(0, Math.round(rawScore * 0.88));
  }

  if (key === 'accessibility') {
    return Math.max(0, Math.round(rawScore * 0.90));
  }

  return rawScore;
}

function labelForScore(score) {
  if (score == null) return 'Unable to verify';
  if (score >= 90) return 'Good';
  if (score >= 50) return 'Needs improvement';
  return 'Poor';
}

function calculateDirectBookingReadiness(scores) {
  const items = [
  { key: 'mobilePerformance', weight: 0.50 },
  { key: 'desktopPerformance', weight: 0.20 },
  { key: 'seo', weight: 0.15 },
  { key: 'bestPractices', weight: 0.08 },
  { key: 'accessibility', weight: 0.07 }
];

  const allAvailable = items.every((item) => typeof scores[item.key] === 'number');
  if (!allAvailable) return null;

  const weighted = items.reduce(
    (sum, item) => sum + scores[item.key] * item.weight,
    0
  );

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
  if (score == null) {
    return 'The audit could not calculate a readiness score because one or more required category scores were unavailable during this run.';
  }

  if (score >= 90) {
    return 'The website’s core technical signals are strong for keeping high-intent guests on the direct booking path.';
  }

  if (score >= 80) {
    return 'The website has a strong direct-booking foundation, with a few optimisation opportunities that can still improve conversion confidence.';
  }

  if (score >= 65) {
    return 'The website has a usable foundation, but performance or quality signals may still create friction before guests enquire or book directly.';
  }

  if (score >= 50) {
    return 'Several signals suggest guests may face noticeable friction before enquiring or booking directly. Focused improvements can help reduce drop-offs.';
  }

  return 'The current signals point to meaningful friction that can push high-intent guests back to comparison sites or OTAs.';
}

function shortError(err) {
  return String(err?.message || err || '')
    .replace(/Google PageSpeed Insights|PageSpeed Insights|PageSpeed|Lighthouse|PSI/gi, 'audit')
    .replace(/\s+/g, ' ')
    .slice(0, 420);
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

async function runPageSpeed(url, strategy = 'mobile') {
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

  const res = await fetchWithTimeout(endpoint, {}, 60000);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `${strategy === 'mobile' ? 'Mobile' : 'Desktop'} check failed (${res.status}). ${body.slice(0, 220)}`
    );
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

function issue(title, detail, severity = 'medium', source = 'Audit signal') {
  return { title, detail, severity, source };
}

function buildIssues({ mobile, desktop }) {
  const issues = [];

  const mobilePerf = mobile?.categories?.performance ?? null;
  const desktopPerf = desktop?.categories?.performance ?? null;
  const seo = mobile?.categories?.seo ?? desktop?.categories?.seo ?? null;
  const bestPractices =
    mobile?.categories?.bestPractices ?? desktop?.categories?.bestPractices ?? null;
  const accessibility =
    mobile?.categories?.accessibility ?? desktop?.categories?.accessibility ?? null;

  const lcpMs = mobile?.metrics?.lcp?.ms ?? null;
  const tbtMs = mobile?.metrics?.tbt?.ms ?? null;
  const clsValue = mobile?.metrics?.cls?.value ?? null;

  if (mobilePerf == null) {
    issues.push(
      issue(
        'Mobile performance could not be verified',
        'The audit did not return a mobile Performance score for this URL during this run.',
        'high'
      )
    );
  } else if (mobilePerf < 50) {
    issues.push(issue('Mobile performance is poor', `Mobile Performance score is ${mobilePerf}/100.`, 'high'));
  } else if (mobilePerf < 90) {
    issues.push(
      issue(
        'Mobile performance needs improvement',
        `Mobile Performance score is ${mobilePerf}/100.`,
        'medium'
      )
    );
  }

  if (lcpMs != null && lcpMs > 4000) {
    issues.push(issue('Main content loads too late', `Largest Contentful Paint is ${mobile.metrics.lcp.display}.`, 'high'));
  } else if (lcpMs != null && lcpMs > 2500) {
    issues.push(issue('Hero/main content can load faster', `Largest Contentful Paint is ${mobile.metrics.lcp.display}.`, 'medium'));
  }

  if (tbtMs != null && tbtMs > 600) {
    issues.push(issue('Page interaction may feel delayed', `Total Blocking Time is ${mobile.metrics.tbt.display}.`, 'high'));
  } else if (tbtMs != null && tbtMs > 200) {
    issues.push(issue('JavaScript blocking time needs attention', `Total Blocking Time is ${mobile.metrics.tbt.display}.`, 'medium'));
  }

  if (clsValue != null && clsValue > 0.25) {
    issues.push(issue('Layout shifts may disturb guests', `Cumulative Layout Shift is ${mobile.metrics.cls.display}.`, 'high'));
  } else if (clsValue != null && clsValue > 0.1) {
    issues.push(issue('Layout stability can be improved', `Cumulative Layout Shift is ${mobile.metrics.cls.display}.`, 'medium'));
  }

  if (desktopPerf != null && desktopPerf < 50) {
    issues.push(issue('Desktop performance is poor', `Desktop Performance score is ${desktopPerf}/100.`, 'medium'));
  }

  if (seo != null && seo < 90) {
    issues.push(issue('SEO score needs improvement', `SEO score is ${seo}/100.`, 'medium'));
  }

  if (bestPractices != null && bestPractices < 90) {
    issues.push(issue('Best Practices score needs attention', `Best Practices score is ${bestPractices}/100.`, 'medium'));
  }

  if (accessibility != null && accessibility < 90) {
    issues.push(issue('Accessibility score can improve', `Accessibility score is ${accessibility}/100.`, 'low'));
  }

  if (!issues.length) {
    issues.push(
      issue(
        'Core website fundamentals look good',
        'The audited category scores look strong for the checks included in this booth audit.',
        'low'
      )
    );
  }

  return issues.slice(0, 5);
}

function buildQuickFixes(mobile) {
  const opportunities = mobile?.opportunities || [];

  if (!opportunities.length) {
    return [
      'No major mobile improvement opportunities were returned during this run. Review the detailed category scores for next steps.'
    ];
  }

  return opportunities
    .slice(0, 3)
    .map((o) => `${o.title}${o.displayValue ? ` — ${o.displayValue}` : ''}`);
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    hasPageSpeedKey: Boolean(process.env.PAGESPEED_API_KEY)
  });
});

app.post('/api/audit', async (req, res) => {
  const startedAt = new Date();

  try {
    const hotelName = String(req.body.hotelName || '').trim();
    const prospectName = String(req.body.prospectName || '').trim();
    const email = String(req.body.email || '').trim();
    const rawWebsite = String(req.body.website || '').trim();

    const url = normalizeUrl(rawWebsite);

    if (!url) {
      return res.status(400).json({
        error: 'Please enter a valid website URL.'
      });
    }

    let mobile = null;
    let desktop = null;
    const errors = [];

    try {
      mobile = await runPageSpeed(url, 'mobile');
    } catch (err) {
      errors.push(shortError(err));
    }

    try {
      desktop = await runPageSpeed(url, 'desktop');
    } catch (err) {
      errors.push(shortError(err));
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
      prospectName,
      email,
      website: url,
      host: hostFromUrl(url),
      scoreSource:
        'Direct Booking Readiness is calculated from the five visible category scores in this report.',
      scores: {
        ...displayScores,
        directBookingReadiness
      },
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
        formula:
  'Weighted mainly from Mobile Performance and Desktop Performance, with lighter support from Technical SEO, Site Quality, and Usability.'
      },
      exactCategoryScores: categoryScores,
      metrics: {
        lcp: mobile?.metrics?.lcp || {
          display: 'Unable to verify',
          ms: null
        },
        fcp: mobile?.metrics?.fcp || {
          display: 'Unable to verify',
          ms: null
        },
        cls: mobile?.metrics?.cls || {
          display: 'Unable to verify',
          value: null
        },
        tbt: mobile?.metrics?.tbt || {
          display: 'Unable to verify',
          ms: null
        },
        speedIndex: mobile?.metrics?.speedIndex || {
          display: 'Unable to verify',
          ms: null
        }
      },
      pageSpeed: {
        mobile,
        desktop
      },
      issues,
      quickFixes,
      opportunities: mobile?.opportunities || [],
      errors
    };

    saveLead({
      generatedAt: report.generatedAt,
      hotelName: report.hotelName,
      prospectName,
      email,
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

    res.status(500).json({
      error: err.message || 'Audit failed.'
    });
  }
});

app.get('/api/leads.csv', (req, res) => {
  const leads = loadLeads();

  const columns = [
    'generatedAt',
    'hotelName',
    'prospectName',
    'email',
    'website',
    'host',
    'directBookingReadiness',
    'mobilePerformance',
    'desktopPerformance',
    'seo',
    'bestPractices',
    'accessibility',
    'topIssue',
    'errors'
  ];

  const csv = [
    columns.join(','),
    ...leads.map((row) => columns.map((c) => escapeCsv(row[c])).join(','))
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="chta-audit-leads.csv"');
  res.send(csv);
});

module.exports = app;