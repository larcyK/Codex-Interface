import WebSocket from 'ws';

const API = process.env.API_BASE || 'http://localhost:8000/api/v1';

async function post(path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function run() {
  console.log('[repro] requesting access token via /auth/pin');
  const auth = await post('/auth/pin', { pin: '123456', deviceName: 'repro-client' });
  const token = auth.accessToken;
  if (!token) {
    console.error('[repro] failed to get accessToken', auth);
    process.exit(2);
  }

  console.log('[repro] starting codex stream');
  const streamRes = await post('/codex/stream', { model: 'gpt-codex-local', prompt: 'Say hello to Codex (repro)' }, token);
  console.log('[repro] streamRes', streamRes);
  if (!streamRes?.wsUrl) {
    console.error('[repro] no wsUrl from stream start');
    process.exit(3);
  }

  const wsUrl = streamRes.wsUrl.replace('<token>', encodeURIComponent(token));
  console.log(`[repro] connecting to ${wsUrl}`);

  await new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => console.log('[repro] ws open'));
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data));
        console.log('[repro] message>', msg);
      } catch (e) {
        console.log('[repro] raw>', String(data));
      }
    });
    ws.on('error', (err) => {
      console.error('[repro] ws error', err?.message ?? err);
    });
    ws.on('close', (code, reason) => {
      console.log(`[repro] ws close code=${code} reason=${String(reason)}`);
      resolve(null);
    });
  });
}

// run
run().catch((e) => {
  console.error('[repro] failed', e?.stack ?? e);
  process.exit(1);
});
