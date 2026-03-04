const core = require('@actions/core');
const crypto = require('crypto');

const BASE_URL = 'https://kagura-app.camie.tech';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseBool(input, defaultValue = false) {
  if (input === undefined || input === null || input === '') return defaultValue;
  const v = String(input).toLowerCase().trim();
  return v === 'true' || v === '1' || v === 'yes';
}

function parseCsvUuids(input) {
  if (!input) return [];
  return String(input)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function kaguraFetch(path, apiKey, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Kagura-Api-Key': apiKey,
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const msg = json?.message || json?.error || `HTTP ${res.status}`;
    throw new Error(`Kagura API error: ${msg}`);
  }

  return json;
}

function isTerminalStatus(status) {
  return ['completed', 'failed', 'cancelled', 'stopped'].includes(String(status));
}

function hasFailures(results) {
  // Prefer summary.failed if present.
  if (results?.summary && typeof results.summary.failed === 'number') {
    return results.summary.failed > 0;
  }
  // Fallback: look at test entries.
  const tests = Array.isArray(results?.tests) ? results.tests : [];
  return tests.some((t) => {
    const s = String(t.status || '').toLowerCase();
    return ['failed', 'error', 'paused_credits'].includes(s);
  });
}

function formatSummary(results) {
  const s = results?.summary || {};
  const total = s.total ?? (Array.isArray(results?.tests) ? results.tests.length : '?');
  const passed = s.passed ?? '?';
  const failed = s.failed ?? '?';
  const completed = s.completed ?? '?';
  return `total=${total}, passed=${passed}, failed=${failed}, completed=${completed}`;
}

async function run() {
  try {
    const apiKey = core.getInput('api-key', { required: true });
    const targetUrl = core.getInput('target-url');
    const testGroupId = core.getInput('test-group');
    const testIdsCsv = core.getInput('test-ids');
    const waitForResults = parseBool(core.getInput('wait-for-results'), true);
    const pollIntervalSeconds = Number(core.getInput('poll-interval-seconds') || 15);
    const timeoutMinutes = Number(core.getInput('timeout-minutes') || 60);

    // Optional GitHub token for check run integration (stretch goal)
    const githubToken = core.getInput('github-token') || process.env.KAGURA_GITHUB_TOKEN || '';

    const testIds = parseCsvUuids(testIdsCsv);

    if (!testGroupId && testIds.length === 0) {
      throw new Error('You must provide either test-group or test-ids');
    }

    // GitHub context (for future GitHub Check Run integration)
    const ghRepo = process.env.GITHUB_REPOSITORY || ''; // e.g. ORG/REPO
    const ghSha = process.env.GITHUB_SHA || '';
    const [ghOwner, ghName] = ghRepo.includes('/') ? ghRepo.split('/') : ['', ''];

    const triggerBody = {
      ...(testGroupId ? { testGroupId } : { testIds }),
      ...(targetUrl ? { targetUrl } : {}),
      metadata: {
        ...(ghOwner && ghName && ghSha
          ? { github: { owner: ghOwner, repo: ghName, sha: ghSha } }
          : {}),
      },
    };

    core.info(`Triggering Kagura run on ${BASE_URL}...`);
    const extraHeaders = githubToken ? { 'X-Kagura-Github-Token': githubToken } : {};

    const trigger = await kaguraFetch('/api/v1/tests/trigger', apiKey, {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify(triggerBody),
    });

    const runId = trigger.runId;
    core.setOutput('runId', runId);
    core.info(`Run queued: ${runId}`);
    core.info(`Status URL: ${BASE_URL}${trigger.statusUrl}`);
    core.info(`Results URL: ${BASE_URL}${trigger.resultsUrl}`);

    if (!waitForResults) {
      core.info('wait-for-results=false. Exiting without polling.');
      return;
    }

    const deadline = Date.now() + timeoutMinutes * 60 * 1000;

    while (true) {
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for results after ${timeoutMinutes} minutes`);
      }

      const status = await kaguraFetch(`/api/v1/runs/${runId}/status`, apiKey, { method: 'GET' });
      core.info(`Run status: ${status.status} (progress ${status.progress}/${status.total})`);

      if (isTerminalStatus(status.status)) {
        break;
      }

      await sleep(pollIntervalSeconds * 1000);
    }

    const results = await kaguraFetch(`/api/v1/runs/${runId}/results`, apiKey, { method: 'GET' });

    core.startGroup('Kagura Results Summary');
    core.info(`Run: ${results.runId}`);
    core.info(`Status: ${results.status}`);
    core.info(formatSummary(results));

    if (Array.isArray(results.tests)) {
      for (const t of results.tests) {
        const line = `- ${t.name || t.testId}: ${t.status}${t.error ? ` | ${t.error}` : ''}`;
        if (String(t.status).toLowerCase() === 'passed') core.info(line);
        else if (['failed', 'error', 'paused_credits'].includes(String(t.status).toLowerCase())) core.error(line);
        else core.warning(line);
      }
    }

    core.endGroup();

    if (results.status === 'failed' || hasFailures(results)) {
      core.setFailed('Kagura tests failed');
    } else {
      core.info('Kagura tests passed');
    }

  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

run();
