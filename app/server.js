require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static UI from the web folder so the viewer can be opened from the proxy (same-origin)
// web directory is mounted to /usr/src/app/web inside the container
const webRoot = path.join(__dirname, 'web');
app.use(express.static(webRoot));

const GRAFANA_URL = process.env.GRAFANA_URL || 'http://grafana:3000';
// Prefer secret file mounted at /run/secrets/grafana_token when available
let GRAFANA_TOKEN = process.env.GRAFANA_TOKEN || '';
try{ const s = require('fs').readFileSync('/run/secrets/grafana_token','utf8').trim(); if(s) GRAFANA_TOKEN = s; }catch(_){}
const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://prometheus:9090';

if(!GRAFANA_TOKEN) console.warn('Warning: no GRAFANA_TOKEN set — API calls will fail if Grafana requires auth');

const grafanaClient = axios.create({ baseURL: GRAFANA_URL, timeout: 10000, headers: GRAFANA_TOKEN ? { Authorization: `Bearer ${GRAFANA_TOKEN}` } : {} });
const promClient = axios.create({ baseURL: PROMETHEUS_URL, timeout: 10000 });

// Optional Redis cache for rendered images
const Redis = require('ioredis');
// Redis URL may embed the password; prefer secret file /run/secrets/redis_password if available
let REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
try{
  const rp = require('fs').readFileSync('/run/secrets/redis_password','utf8').trim();
  if(rp){
    // update REDIS_URL to include auth
    const u = new URL(REDIS_URL);
    u.username = '';
    u.password = rp;
    REDIS_URL = u.toString();
  }
}catch(_){}
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '300', 10);
let redisClient;
try{
  redisClient = new Redis(REDIS_URL);
  redisClient.on('error', (e)=> console.warn('redis error', e && e.message));
}catch(e){ console.warn('redis init failed', e && e.message); }

// Rate limiting for heavy endpoints
const rateLimit = require('express-rate-limit');
const renderLimiter = rateLimit({ windowMs: 60*1000, max: 30 }); // 30 req/min per IP
const snapshotLimiter = rateLimit({ windowMs: 60*1000, max: 6 }); // 6 req/min per IP

app.get('/health', (req, res) => res.json({ ok: true }));

// Proxy: get dashboard JSON by uid
app.get('/api/dashboard/:uid', async (req, res) => {
  try {
    const uid = req.params.uid;
    const resp = await grafanaClient.get(`/api/dashboards/uid/${encodeURIComponent(uid)}`);
    res.json(resp.data);
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    res.status(status).json({ error: err.message, details: err.response ? err.response.data : null });
  }
});

// Proxy: search Grafana objects (dashboards)
app.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const resp = await grafanaClient.get('/api/search', { params: { query: q, type: 'dash-db' } });
    res.json(resp.data);
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    res.status(status).json({ error: err.message, details: err.response ? err.response.data : null });
  }
});

// Proxy: resolve a public dashboard link (/public-dashboards/:publicUid)
app.get('/api/public/:publicUid', async (req, res) => {
  try {
    const publicUid = req.params.publicUid;
    // First try the Grafana API for public dashboards
    try{
      const resp = await grafanaClient.get(`/api/public-dashboards/${encodeURIComponent(publicUid)}`);
      // Grafana API returns structured info including the mapping to dashboard UID
      return res.json({ source: 'api', data: resp.data });
    }catch(apiErr){
      // if API returned 404 or other, attempt a fallback: fetch the public HTML page and try to extract the dashboard UID
      const status = apiErr.response ? apiErr.response.status : null;
      // continue to fallback for 404 or other
    }

    // Fallback: fetch the public HTML page and attempt to extract a dashboard UID or internal /d/ URL
    try{
      const pageResp = await axios.get(`${GRAFANA_URL}/public-dashboards/${encodeURIComponent(publicUid)}`, { timeout: 10000 });
      const html = pageResp.data || '';
      // Try to find patterns like /d/<uid>/ or "dashboardUid":"<uid>" in the HTML
      let uidMatch = html.match(/\/d\/([a-zA-Z0-9\-_:]{5,})/);
      if(!uidMatch){
        const m2 = html.match(/dashboardUid\"\s*[:=]\s*\"([a-zA-Z0-9\-_:]+)\"/);
        if(m2) uidMatch = [m2[0], m2[1]];
      }
      const mappedUid = uidMatch ? uidMatch[1] : null;
      return res.json({ source: 'html', mappedUid, htmlSample: (html||'').slice(0,2000) });
    }catch(htmlErr){
      const status = htmlErr.response ? htmlErr.response.status : null;
      return res.status(404).json({ error: 'public dashboard not found', details: { apiStatus: status, apiError: (htmlErr.message||htmlErr.toString()) } });
    }
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    res.status(status).json({ error: err.message, details: err.response ? err.response.data : null });
  }
});

// Proxy: resolve a short /goto/<key> link by requesting Grafana without following redirects
app.get('/api/resolve-goto/:key', async (req, res) => {
  try {
    const key = req.params.key;
    // First try a non-following request to capture Location header when Grafana issues a server-side redirect
    try{
      // Use an unauthenticated request for /goto because some Grafana instances allow public short-links
      // but the server-side API token may be missing or invalid; calling without auth avoids 401.
      const resp = await axios.get(`${GRAFANA_URL}/goto/${encodeURIComponent(key)}`, { maxRedirects: 0, validateStatus: s => s >= 200 && s < 400, timeout: 10000 });
      const location = (resp && resp.headers) ? (resp.headers.location || resp.headers.Location) : null;
      if(location){
        const m = String(location).match(/\/d\/([^\/\?#]+)/);
        const mappedUid = m && m[1] ? m[1] : null;
        return res.json({ location, mappedUid, source: 'location-header' });
      }
      // fallthrough to HTML parsing if no Location header present
    }catch(e){
      // if the non-following request failed (some servers may not like maxRedirects=0) or returned 401,
      // continue to HTML fallback below.
      console.warn('resolve-goto: unauthenticated request failed, will attempt HTML fallback', e && e.message);
    }

    // Fallback: fetch the page and try to extract /d/<uid>/ from the HTML (handles client-side redirects)
    try{
      const pageResp = await axios.get(`${GRAFANA_URL}/goto/${encodeURIComponent(key)}`, { timeout: 10000 });
      const html = pageResp.data || '';
      let uidMatch = html.match(/\/d\/([a-zA-Z0-9\-_:]{5,})/);
      if(!uidMatch){
        const m2 = html.match(/dashboardUid\"\s*[:=]\s*\"([a-zA-Z0-9\-_:]+)\"/);
        if(m2) uidMatch = [m2[0], m2[1]];
      }
      const mappedUid = uidMatch ? uidMatch[1] : null;
      return res.json({ source: 'html', mappedUid, htmlSample: (html||'').slice(0,2000) });
    }catch(htmlErr){
      const status = htmlErr.response ? htmlErr.response.status : null;
      return res.status(404).json({ error: 'goto key not resolvable', details: { htmlError: (htmlErr.message||htmlErr.toString()), status } });
    }
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    res.status(status).json({ error: err.message, details: err.response ? err.response.data : null });
  }
});

// Proxy: run a Prometheus instant query (q param)
app.get('/api/query', async (req, res) => {
  try {
    const q = req.query.q;
    if(!q) return res.status(400).json({ error: 'missing query param q' });
    const resp = await promClient.get('/api/v1/query', { params: { query: q } });
    res.json(resp.data);
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    res.status(status).json({ error: err.message, details: err.response ? err.response.data : null });
  }
});

// Proxy: run a Prometheus range query (query_range)
app.get('/api/query_range', async (req, res) => {
  try {
    const q = req.query.q;
    const start = req.query.start;
    const end = req.query.end;
    const step = req.query.step;
    if(!q) return res.status(400).json({ error: 'missing query param q' });
    const resp = await promClient.get('/api/v1/query_range', { params: { query: q, start, end, step } });
    res.json(resp.data);
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    res.status(status).json({ error: err.message, details: err.response ? err.response.data : null });
  }
});

// Create a Grafana snapshot for a dashboard (server-side, returns snapshot info)
app.post('/api/snapshot', snapshotLimiter, async (req, res) => {
  try {
    const { dashboardUid, name } = req.body || {};
    if(!dashboardUid) return res.status(400).json({ error: 'missing dashboardUid in body' });
  // snapshot creation requires a configured GRAFANA_TOKEN
  if(!GRAFANA_TOKEN) return res.status(403).json({ error: 'server missing GRAFANA_TOKEN; snapshot creation disabled' });

  // fetch dashboard
  const dashResp = await grafanaClient.get(`/api/dashboards/uid/${encodeURIComponent(dashboardUid)}`);
    const dashboard = dashResp.data && dashResp.data.dashboard ? dashResp.data.dashboard : null;
    if(!dashboard) return res.status(404).json({ error: 'dashboard not found' });

    const payload = { dashboard, name: name || `snapshot-${dashboardUid}-${Date.now()}` };
    const snapResp = await grafanaClient.post('/api/snapshots', payload);
    res.json(snapResp.data);
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    res.status(status).json({ error: err.message, details: err.response ? err.response.data : null });
  }
});

// Get snapshot info by key
app.get('/api/snapshots/:key', async (req, res) => {
  try {
    const key = req.params.key;
    const resp = await grafanaClient.get(`/api/snapshots/${encodeURIComponent(key)}`);
    res.json(resp.data);
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    res.status(status).json({ error: err.message, details: err.response ? err.response.data : null });
  }
});

// Render a single panel as PNG via Grafana render endpoint
app.get('/api/render-panel', renderLimiter, async (req, res) => {
  try {
    const { uid, panelId, from, to, width, height, orgId } = req.query;
    if(!uid || !panelId) return res.status(400).json({ error: 'missing uid or panelId' });

    // fetch dashboard meta to get slug
    const dashResp = await grafanaClient.get(`/api/dashboards/uid/${encodeURIComponent(uid)}`);
    const slug = (dashResp.data && dashResp.data.meta && dashResp.data.meta.slug) ? dashResp.data.meta.slug : null;
    if(!slug) return res.status(500).json({ error: 'cannot determine dashboard slug' });

    const path = `/render/d-solo/${encodeURIComponent(uid)}/${encodeURIComponent(slug)}`;
    const params = { panelId, from, to, width, height };
    if(orgId) params.orgId = orgId;

    // Build a cache key and attempt to serve from Redis
    const cacheKey = `render:${uid}:${panelId}:${from || 'auto'}:${to || 'auto'}:${width||'auto'}x${height||'auto'}`;
    try{
      if(redisClient){
        const cached = await redisClient.getBuffer(cacheKey);
        if(cached && cached.length){
          res.set('Content-Type', 'image/png');
          return res.send(cached);
        }
      }
    }catch(e){ console.warn('redis get failed', e && e.message); }

    const imageResp = await grafanaClient.get(path, { params, responseType: 'arraybuffer' });
    const buf = Buffer.from(imageResp.data, 'binary');
    res.set('Content-Type', 'image/png');
    res.send(buf);

    // store in cache asynchronously
    if(redisClient){
      try{ await redisClient.set(cacheKey, buf, 'EX', Math.max(30, CACHE_TTL)); }catch(e){ console.warn('redis set failed', e && e.message); }
    }
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    res.status(status).json({ error: err.message, details: err.response ? err.response.data : null });
  }
});

const port = process.env.PORT || 3100;
app.listen(port, () => console.log(`proxy server listening on ${port}, grafana=${GRAFANA_URL}, prometheus=${PROMETHEUS_URL}`));
