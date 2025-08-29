self.addEventListener('message', async (ev) => {
  const msg = ev.data || {};
  const { id, type, url } = msg;
  const respond = (payload) => { try{ self.postMessage(Object.assign({ id, type }, payload)); }catch(_){ /* ignore */ } };
  try {
    if(type === 'fetch_query_range'){
      const u = url;
      const r = await fetch(u);
      const json = await r.json();
  function downsample(values, maxPoints=300){
        if(!Array.isArray(values)) return values;
        const len = values.length;
        if(len <= maxPoints) return values;
        const step = Math.ceil(len / maxPoints);
        const out = new Array(Math.ceil(len/step));
        for(let i=0, j=0; i<len; i+=step, j++) out[j]=values[i];
        return out;
      }
      const series = (json && json.data && json.data.result) ? json.data.result : [];
      const normalized = series.map(s => {
        const raw = s.values || s.value || [];
        const sampled = downsample(raw, 800);
        const data = sampled.map(v => ({ t: Array.isArray(v)? Number(v[0])*1000 : Number(v[0])*1000, y: isFinite(Number(Array.isArray(v)? v[1] : v[1])) ? Number(Array.isArray(v)? v[1] : v[1]) : null }));
        return { metric: s.metric || {}, data };
      });
      respond({ ok: true, result: normalized });
      return;
    }
    respond({ ok:false, error: 'unknown message type' });
  }catch(err){
    respond({ ok:false, error: err && err.message ? err.message : String(err) });
  }
});
