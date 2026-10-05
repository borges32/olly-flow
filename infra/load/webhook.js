// Spec 006, NFR-002 (plan §8): carga no webhook → HTTP mock → INSERT no Postgres.
// Uso (ver README.md): k6 run -e TARGET=http://localhost:3000 -e WEBHOOK=carga-recebido webhook.js
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const TARGET = __ENV.TARGET || 'http://localhost:3000';
const WEBHOOK = __ENV.WEBHOOK || 'carga-recebido';
// onReceived responde 202 na hora; lastNode espera o worker terminar (200).
const EXPECTED = Number(__ENV.EXPECTED_STATUS || (WEBHOOK.includes('sincrono') ? 200 : 202));

export const options = {
  vus: Number(__ENV.VUS || 50),
  duration: __ENV.DURATION || '2m',
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const unexpected = new Counter('unexpected_status');

export default function () {
  const body = JSON.stringify({ vu: __VU, iter: __ITER, at: Date.now() });
  const res = http.post(`${TARGET}/webhook/${WEBHOOK}`, body, {
    headers: { 'content-type': 'application/json' },
    timeout: '130s',
  });
  const ok = check(res, { [`status ${EXPECTED}`]: (r) => r.status === EXPECTED });
  if (!ok) unexpected.add(1, { status: String(res.status) });
}
