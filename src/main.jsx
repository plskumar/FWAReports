import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, BadgeDollarSign, BarChart3, CheckCircle2, Download, FileJson, FileText, Printer, RotateCcw, Search, ShieldAlert, Upload, Users } from 'lucide-react';
import './styles.css';

const nowIso = () => new Date().toISOString();
const SAMPLE_DATA_URL = '/sample-data/basys-upcoding-sample.json';
const UPLOADED_DATA_KEY = 'fwaReports.uploadedData';
const UPLOADED_NAME_KEY = 'fwaReports.uploadedName';

const fallbackReportBundle = {
  run_id: 'not-provided',
  status: 'pending',
  schema_version: 'unknown',
  generated_at: null,
  model_trace: null,
  reports: {
    duplicate_billing: {
      label: 'Duplicate Billing',
      finding_id: 'F-DUP-NOT-PROVIDED',
      scenario: 'duplicate_billing',
      confidence_level: 'Not stated',
      confidence_score: null,
      subtitle: 'Upload a report JSON with duplicate billing findings to populate this tab.',
      executive_summary: 'No duplicate billing findings are available in the currently loaded JSON.',
      dollar_value: 0,
      currency: 'USD',
      flagged_claims: [],
      recommended_actions: [
        'Upload source JSON that includes duplicate billing report findings.',
        'Confirm schema mapping before finalizing any recovery recommendation.'
      ]
    },
    upcoding: {
      label: 'Upcoding',
      finding_id: 'F-UP-NOT-PROVIDED',
      scenario: 'em_upcoding',
      confidence_level: 'Not stated',
      confidence_score: null,
      subtitle: 'Upload a report JSON with upcoding findings to populate this tab.',
      executive_summary: 'No upcoding findings are available in the currently loaded JSON.',
      dollar_value: 0,
      currency: 'USD',
      flagged_claims: [],
      recommended_actions: [
        'Upload source JSON that includes upcoding report findings.',
        'Validate coded-claim evidence against clinical documentation before recovery.'
      ]
    }
  }
};

function money(value, code = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(Number(value || 0));
}

function dateTime(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return String(value || 'Not available');
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'medium' }).format(d);
}

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'N/A';
  return `${Math.round(n * 100)}%`;
}

function confidence(report) {
  const level = report.confidence_level || report.confidence?.level || report.score?.band || 'Not stated';
  const rawScore = report.confidence_score ?? report.confidence?.score ?? report.score?.value;
  const score = rawScore === undefined || rawScore === null || rawScore === '' ? null : rawScore;
  return { level: String(level), score };
}

function confidenceClass(level) {
  const v = String(level || '').toLowerCase();
  if (v.includes('high')) return 'high';
  if (v.includes('medium') || v.includes('moderate')) return 'medium';
  if (v.includes('low')) return 'low';
  return 'neutral';
}

function exportFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(report) {
  const rows = [['claim_id', 'claim_line', 'claim_date', 'service_provider', 'amount_paid', 'procedure', 'observation']];
  report.flagged_claims.forEach(c => rows.push([c.claim_id, c.line, c.claim_date, c.service_provider, c.amount_paid, c.procedure || '', c.observation || '']));
  return rows.map(r => r.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
}

function normalizeBasysFinding(finding) {
  const lines = (finding.sampled_claim_lines || []).filter(l => String(l.diagnosis_support).toLowerCase() === 'inconsistent');
  const flagged = lines.map(line => ({
    claim_id: line.CLAIM_NBR,
    line: line.CLAIM_LINE_NBR,
    claim_date: line.CLAIM_DATE || line.SERVICE_DATE || 'Not provided',
    service_provider: finding.servicing_provider_id,
    amount_paid: Number(line.DER_ACTUAL_PAYMENT_COMP_AMT || 0),
    procedure: line.PRIMARY_SERVICE_CODE,
    diagnosis_support: line.diagnosis_support,
    observation: `Claim ${line.CLAIM_NBR} line ${line.CLAIM_LINE_NBR}: This line was billed by provider ${finding.servicing_provider_id} and paid ${Number(line.DER_ACTUAL_PAYMENT_COMP_AMT || 0).toFixed(2)} ${finding.exposure?.currency || 'USD'} for procedure ${line.PRIMARY_SERVICE_CODE}. The coded-claim review marked diagnosis support as inconsistent with the billed level. Clinical documentation should be reviewed before confirming recovery because this automated review evaluates coded-data plausibility, not the medical record.`
  }));
  return {
    label: 'Upcoding',
    finding_id: finding.finding_id,
    scenario: finding.scenario,
    finding_type: finding.finding_type,
    service_provider: finding.servicing_provider_id,
    provider_npi: finding.provider_npi,
    confidence_level: finding.score?.band || 'Not stated',
    confidence_score: finding.score?.value,
    subtitle: 'Provider-pattern E&M upcoding signal converted from BASYS/FWA finding schema.',
    executive_summary: finding.reasoning_chain?.judge || finding.reasoning_chain?.critique || fallbackReportBundle.reports.upcoding.executive_summary,
    dollar_value: Number(finding.exposure?.flagged_paid_amt || 0),
    currency: finding.exposure?.currency || 'USD',
    flagged_claims: flagged.length ? flagged : fallbackReportBundle.reports.upcoding.flagged_claims,
    recommended_actions: fallbackReportBundle.reports.upcoding.recommended_actions,
    source_finding: finding
  };
}

function normalizeInput(input) {
  if (input?.reports?.duplicate_billing && input?.reports?.upcoding) {
    return {
      reports: {
        duplicate_billing: input.reports.duplicate_billing || fallbackReportBundle.reports.duplicate_billing,
        upcoding: input.reports.upcoding || fallbackReportBundle.reports.upcoding
      },
      meta: {
        runId: input.run_id,
        status: input.status,
        schemaVersion: input.schema_version,
        sourceGeneratedAt: input.generated_at,
        modelTrace: input.model_trace || input.reasoning_model_steps
      }
    };
  }

  const findings = Array.isArray(input?.findings) ? input.findings : [];
  const upcodingFindings = findings.filter(f => String(f.scenario || '').toLowerCase().includes('upcoding'));
  const primary = upcodingFindings[0] || findings[0];
  const duplicate = fallbackReportBundle.reports.duplicate_billing;
  const upcoding = primary ? normalizeBasysFinding(primary) : fallbackReportBundle.reports.upcoding;

  return {
    reports: { duplicate_billing: duplicate, upcoding },
    meta: {
      runId: input?.run_id || fallbackReportBundle.run_id,
      status: input?.status || fallbackReportBundle.status,
      schemaVersion: input?.schema_version || fallbackReportBundle.schema_version,
      sourceGeneratedAt: input?.generated_at || input?.generatedAt || fallbackReportBundle.generated_at,
      modelTrace: input?.model_trace || input?.reasoning_model_steps || fallbackReportBundle.model_trace,
      findingCount: findings.length
    }
  };
}

function buildFooter(report, meta, activeKey) {
  const finding = report.source_finding || report;
  return [
    'Confidential. For authorized investigators only. Contains no protected health information; demonstration data may be synthetic unless otherwise identified by the source file.',
    `Audit: run ${meta.runId || 'not provided'}, finding ${report.finding_id || finding.finding_id || 'not provided'}, report generated ${nowIso()}.`,
    `Source details: schema ${meta.schemaVersion || 'not provided'}, status ${meta.status || 'not provided'}, source generated ${meta.sourceGeneratedAt ? dateTime(meta.sourceGeneratedAt) : 'not provided'}, tab ${activeKey}.`,
    `Finding details: scenario ${finding.scenario || report.scenario || 'not provided'}, type ${finding.finding_type || report.finding_type || 'not provided'}, provider ${finding.servicing_provider_id || report.service_provider || 'not provided'}, NPI ${finding.provider_npi || report.provider_npi || 'not provided'}, score ${finding.score?.value ?? report.confidence_score ?? 'not provided'} (${finding.score?.band || report.confidence_level || 'not provided'}), needs_review ${String(finding.needs_review ?? report.needs_review ?? 'not provided')}.`,
    `Reasoning model steps: ${meta.modelTrace || report.model_trace || 'not provided'}.`
  ];
}

function TopBar({ onLoad, onReset, loadedName }) {
  return (
    <header className="topbar">
      <div className="brand"><ShieldAlert /><div><strong>FWAReports</strong><span>Investigator portal for duplicate billing and upcoding recovery reports</span></div></div>
      <div className="topActions">
        <label className="upload"><Upload size={17}/> Upload JSON<input type="file" accept="application/json" onChange={onLoad}/></label>
        <button className="secondary" onClick={onReset}><RotateCcw size={17}/> Reset to Default</button>
        {loadedName && <span className="loaded">Loaded: {loadedName}</span>}
      </div>
    </header>
  );
}

function KpiCards({ report }) {
  const totalClaims = report.flagged_claims?.length || 0;
  const providers = new Set((report.flagged_claims || []).map(c => c.service_provider).filter(Boolean)).size;
  const avg = totalClaims ? Number(report.dollar_value || 0) / totalClaims : 0;
  return (
    <div className="cards">
      <div className="card"><BadgeDollarSign /><span>Total exposure</span><strong>{money(report.dollar_value, report.currency)}</strong></div>
      <div className="card"><FileText /><span>Flagged claims</span><strong>{totalClaims}</strong></div>
      <div className="card"><Users /><span>Providers flagged</span><strong>{providers || 'N/A'}</strong></div>
      <div className="card"><BarChart3 /><span>Average paid</span><strong>{money(avg, report.currency)}</strong></div>
    </div>
  );
}

function ConfidenceBanner({ report }) {
  const c = confidence(report);
  const scoreText = typeof c.score === 'number' ? (c.score <= 1 ? pct(c.score) : String(c.score)) : c.score;
  return (
    <section className={`confidenceBanner ${confidenceClass(c.level)}`}>
      <span>Confidence level</span>
      <strong>{c.level}</strong>
      {scoreText && <em>Score: {scoreText}</em>}
    </section>
  );
}

function TabButton({ id, active, onClick, children }) {
  return <button className={active ? 'tab active' : 'tab'} onClick={() => onClick(id)}>{children}</button>;
}

function ClaimsTable({ claims, currencyCode, search }) {
  const filtered = (claims || []).filter(c => JSON.stringify(c).toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="tableWrap">
      <table>
        <thead><tr><th>Claim ID</th><th>Claim Date</th><th>Service Provider</th><th>Amount Paid</th></tr></thead>
        <tbody>
          {filtered.map((claim, i) => (
            <tr key={`${claim.claim_id}-${claim.line}-${i}`}>
              <td><strong>{claim.claim_id}</strong><span className="muted">Line {claim.line || 'N/A'} {claim.procedure ? `| ${claim.procedure}` : ''}</span></td>
              <td>{claim.claim_date || 'Not provided'}</td>
              <td>{claim.service_provider || 'Not provided'}</td>
              <td>{money(claim.amount_paid, currencyCode)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!filtered.length && <div className="empty">No claims match the current search.</div>}
    </div>
  );
}

function ReportTab({ report, meta, activeKey }) {
  const [search, setSearch] = useState('');
  const footnotes = useMemo(() => buildFooter(report, meta, activeKey), [report, meta, activeKey]);
  const safeId = String(report.finding_id || activeKey).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const exportJson = () => exportFile(`${safeId}.json`, JSON.stringify({ run_id: meta.runId, report_generated_at: nowIso(), report }, null, 2), 'application/json');
  const exportCsv = () => exportFile(`${safeId}-flagged-claims.csv`, toCsv(report), 'text/csv');
  const filtered = (report.flagged_claims || []).filter(c => JSON.stringify(c).toLowerCase().includes(search.toLowerCase()));

  return (
    <main className="report">
      <section className="hero">
        <div>
          <p className="eyebrow">{report.finding_id || activeKey}</p>
          <h1>{report.label}</h1>
          <p>{report.subtitle}</p>
        </div>
        <div className="buttonStack">
          <button className="secondary" onClick={exportJson}><FileJson size={17}/> JSON</button>
          <button className="secondary" onClick={exportCsv}><Download size={17}/> CSV</button>
          <button className="secondary" onClick={() => window.print()}><Printer size={17}/> Print/PDF</button>
        </div>
      </section>

      <ConfidenceBanner report={report} />
      <KpiCards report={report} />

      <section className="panel executive">
        <h2>Executive summary of findings</h2>
        <p>{report.executive_summary}</p>
        <div className="dollarCallout">Dollar value involved in {report.label.toLowerCase()}: <strong>{money(report.dollar_value, report.currency)}</strong></div>
      </section>

      <section className="panel">
        <div className="sectionHeader">
          <h2>Flagged claims</h2>
          <label className="search"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search claim, provider, procedure..." /></label>
        </div>
        <ClaimsTable claims={report.flagged_claims || []} currencyCode={report.currency} search={search} />
      </section>

      <section className="panel">
        <h2>Per-claim line observations</h2>
        <div className="observations">
          {filtered.map((claim, i) => <p key={`${claim.claim_id}-${claim.line}-obs-${i}`}>{claim.observation || `Claim ${claim.claim_id} line ${claim.line}: Observation not provided in source JSON.`}</p>)}
        </div>
      </section>

      <section className="panel actions">
        <h2>Recommended actions for recovery</h2>
        <ol>{(report.recommended_actions || []).map((a, i) => <li key={i}>{a}</li>)}</ol>
      </section>

      <footer>{footnotes.map((note, i) => <React.Fragment key={i}>{note}<br /></React.Fragment>)}</footer>
    </main>
  );
}

function App() {
  const [active, setActive] = useState('duplicate_billing');
  const [rawData, setRawData] = useState(null);
  const [loadedName, setLoadedName] = useState('Loading sample JSON...');
  const [loadError, setLoadError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const normalized = useMemo(() => (rawData ? normalizeInput(rawData) : null), [rawData]);
  const report = normalized?.reports?.[active] || normalized?.reports?.duplicate_billing;

  const loadPersistedUpload = () => {
    try {
      const raw = localStorage.getItem(UPLOADED_DATA_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      const name = localStorage.getItem(UPLOADED_NAME_KEY) || 'uploaded-report.json';
      setRawData(parsed);
      setLoadedName(name);
      setLoadError('');
      setActive('duplicate_billing');
      setRefreshKey(v => v + 1);
      return true;
    } catch (error) {
      localStorage.removeItem(UPLOADED_DATA_KEY);
      localStorage.removeItem(UPLOADED_NAME_KEY);
      return false;
    }
  };

  const loadDefaultFile = async () => {
    try {
      const response = await fetch(SAMPLE_DATA_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while loading ${SAMPLE_DATA_URL}`);
      }
      const parsed = await response.json();
      setRawData(parsed);
      setLoadedName('basys-upcoding-sample.json');
      setLoadError('');
      setActive('duplicate_billing');
      setRefreshKey(v => v + 1);
      return true;
    } catch (error) {
      setLoadError(`Could not load default JSON file: ${error.message}`);
      setLoadedName('No file loaded');
      setRawData(fallbackReportBundle);
      setActive('duplicate_billing');
      setRefreshKey(v => v + 1);
      return false;
    }
  };

  useEffect(() => {
    const loadedUpload = loadPersistedUpload();
    if (!loadedUpload) {
      loadDefaultFile();
    }
  }, []);

  const onLoad = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      localStorage.setItem(UPLOADED_DATA_KEY, JSON.stringify(parsed));
      localStorage.setItem(UPLOADED_NAME_KEY, file.name);
      event.target.value = '';
      window.location.reload();
    } catch (error) {
      alert(`Could not parse JSON: ${error.message}`);
    }
  };

  const onReset = () => {
    localStorage.removeItem(UPLOADED_DATA_KEY);
    localStorage.removeItem(UPLOADED_NAME_KEY);
    window.location.reload();
  };

  return (
    <div className="app">
      <TopBar onLoad={onLoad} onReset={onReset} loadedName={loadedName} />
      {loadError && <div className="status"><AlertTriangle size={16}/> {loadError}</div>}
      {!normalized && <div className="status"><FileJson size={16}/> Loading report JSON...</div>}
      {normalized && (
        <>
          <nav className="tabs">
            <TabButton id="duplicate_billing" active={active === 'duplicate_billing'} onClick={setActive}>Duplicate Billing</TabButton>
            <TabButton id="upcoding" active={active === 'upcoding'} onClick={setActive}>Upcoding</TabButton>
          </nav>
          <ReportTab key={refreshKey} report={report} meta={{ ...normalized.meta }} activeKey={active} />
        </>
      )}
      <div className="status"><CheckCircle2 size={16}/> GitHub Actions deployment ready</div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
