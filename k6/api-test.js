import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

const BASE_URL = String(__ENV.BASE_URL || 'https://kack.li').replace(/\/+$/, '');
const TEST_PROFILE = String(__ENV.TEST_PROFILE || 'smoke').toLowerCase();
const THINK_TIME_MS = Number.parseInt(__ENV.THINK_TIME_MS || '200', 10);

const ENABLE_PROTECTED = __ENV.ENABLE_PROTECTED === '1';
const ADMIN_TOKEN = String(__ENV.ADMIN_TOKEN || '');
const JARVIS_TOKEN = String(__ENV.JARVIS_REVIEW_TOKEN || __ENV.JARVIS_TOKEN || '');

const endpointDuration = new Trend('endpoint_duration', true);
const endpointStatusErrors = new Rate('endpoint_status_errors');
const payloadErrors = new Rate('payload_errors');

const profileConfig = {
  smoke: {
    executor: 'shared-iterations',
    vus: 1,
    iterations: 15,
    maxDuration: '2m',
  },
  load: {
    executor: 'ramping-vus',
    stages: [
      { duration: '1m', target: 10 },
      { duration: '3m', target: 25 },
      { duration: '1m', target: 0 },
    ],
    gracefulRampDown: '20s',
  },
  stress: {
    executor: 'ramping-vus',
    stages: [
      { duration: '1m', target: 20 },
      { duration: '2m', target: 60 },
      { duration: '2m', target: 100 },
      { duration: '1m', target: 0 },
    ],
    gracefulRampDown: '20s',
  },
  soak: {
    executor: 'constant-vus',
    vus: 15,
    duration: '15m',
  },
};

const selectedProfile = profileConfig[TEST_PROFILE] || profileConfig.smoke;

export const options = {
  scenarios: {
    api: selectedProfile,
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    checks: ['rate>0.98'],
    endpoint_status_errors: ['rate<0.02'],
    payload_errors: ['rate<0.05'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function request(name, path, expectedStatus, params = {}) {
  const url = `${BASE_URL}${path}`;
  const res = http.get(url, params);

  endpointDuration.add(res.timings.duration, { endpoint: name, profile: TEST_PROFILE });

  const ok = check(res, {
    [`${name} status is ${expectedStatus}`]: (r) => r.status === expectedStatus,
  });

  endpointStatusErrors.add(ok ? 0 : 1, {
    endpoint: name,
    expected: String(expectedStatus),
    actual: String(res.status),
  });

  return res;
}

function parseJson(response, endpointName) {
  try {
    return response.json();
  } catch {
    payloadErrors.add(1, { endpoint: endpointName, reason: 'invalid_json' });
    return null;
  }
}

function requestProtected(name, path, token, expectedStatus = 200) {
  return request(name, path, expectedStatus, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export default function () {
  group('public-read', () => {
    const statusRes = request('status', '/api/status', 200);
    const statusJson = parseJson(statusRes, 'status');
    if (statusJson) {
      check(statusJson, {
        'status has episodes': (s) => typeof s.episodes === 'number',
        'status has quality': (s) => !!s.quality,
      }) || payloadErrors.add(1, { endpoint: 'status', reason: 'shape' });
    }

    const listRes = request('episodes-list', '/api/episodes?limit=20&offset=0', 200);
    const listJson = parseJson(listRes, 'episodes-list');

    let episodeId = 2;
    if (listJson && Array.isArray(listJson.episodes) && listJson.episodes.length > 0) {
      const first = listJson.episodes[0];
      episodeId = Number.parseInt(first.id, 10) || episodeId;
      check(first, {
        'episode has guests array': (ep) => Array.isArray(ep.guests),
        'episode has topics array': (ep) => Array.isArray(ep.topics),
        'episode has chapters array': (ep) => Array.isArray(ep.chapters),
      }) || payloadErrors.add(1, { endpoint: 'episodes-list', reason: 'episode_shape' });
    } else {
      payloadErrors.add(1, { endpoint: 'episodes-list', reason: 'missing_episodes' });
    }

    request('episode-detail', `/api/episodes/${episodeId}`, 200);
    request('episode-suggestions', `/api/episodes/${episodeId}/suggestions?limit=20`, 200);
    request('episode-suggestions-history', `/api/episodes/${episodeId}/suggestions/history?limit=20`, 200);

    request('guests', '/api/guests', 200);
    request('topics', '/api/topics', 200);
    request('formats', '/api/formats', 200);

    const worksRes = request('works-list', '/api/works?limit=5', 200);
    const worksJson = parseJson(worksRes, 'works-list');
    if (worksJson && Array.isArray(worksJson.works) && worksJson.works.length > 0) {
      const workId = worksJson.works[0].id;
      request('work-detail', `/api/works/${encodeURIComponent(workId)}`, 200);
    }

    request('validation-offset', '/api/episodes?offset=-1', 400);
    request('unauth-logs', '/api/logs?limit=1', 401);
    request('unauth-jarvis-internal', '/internal/jarvis/suggestions/pending?limit=1', 401);
  });

  if (ENABLE_PROTECTED) {
    group('protected-read', () => {
      if (ADMIN_TOKEN) {
        requestProtected('admin-logs', '/api/logs?limit=5', ADMIN_TOKEN, 200);
        requestProtected('admin-suggestions', '/api/suggestions?limit=5', ADMIN_TOKEN, 200);
      }

      if (JARVIS_TOKEN) {
        requestProtected('jarvis-pending', '/internal/jarvis/suggestions/pending?limit=5', JARVIS_TOKEN, 200);
      }
    });
  }

  sleep(Math.max(0, THINK_TIME_MS) / 1000);
}

export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = `k6/reports/${TEST_PROFILE}-${timestamp}`;

  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    [`${prefix}.txt`]: textSummary(data, { indent: ' ', enableColors: false }),
    [`${prefix}.json`]: JSON.stringify(data, null, 2),
  };
}
