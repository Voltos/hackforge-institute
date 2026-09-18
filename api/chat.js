const WINDOW_MS = 60_000;
const MAX_REQUESTS = 12;
const buckets = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const old = buckets.get(ip) || [];
  const fresh = old.filter(t => now - t < WINDOW_MS);
  fresh.push(now);
  buckets.set(ip, fresh);
  return fresh.length > MAX_REQUESTS;
}

const instructions = `You are ForgeBot, the official AI assistant for HackForge Institute.
Answer specifically about HackForge Institute and beginner-friendly cybersecurity learning.
Known HackForge context:
- HackForge is a practical cybersecurity teaching institute.
- Training includes cybersecurity introduction, lab setup and virtualization, Linux/Kali, networking, wireless security, system security, client-side security, OSINT, social engineering, remote access/lab networking, post-exploitation concepts and defence hardening.
- Additional topics can include WhatsApp security, human OSINT from pictures, Android security/hacking concepts and firewall concepts/setup.
- Latest stated pricing is PKR 7,500 per month per student.
- A 3-day demo is offered.
- Teaching is live and focused on topics, notes, Q&A and practical learning rather than a library of full recorded courses.
Do not invent contact numbers, schedules, guarantees, certificates, job placement promises or payment details.
If the user asks for a cybersecurity technique, keep guidance legal and lab/authorized-testing oriented.
Keep replies concise, useful and conversational. Use bullets when helpful.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({error:'Too many requests. Try again shortly.'});
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({error:'OPENAI_API_KEY is not configured on the server.'});

  let data;
  try { data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return res.status(400).json({error:'Invalid JSON'}); }
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  if (!messages.length || messages.length > 12) return res.status(400).json({error:'Invalid conversation'});
  const input = messages.map(m => ({role:m.role === 'assistant' ? 'assistant' : 'user', content:String(m.content || '').slice(0,4000)}));

  const upstream = await fetch('https://api.openai.com/v1/responses', {
    method:'POST',
    headers:{'content-type':'application/json','authorization':`Bearer ${key}`},
    body:JSON.stringify({model:process.env.OPENAI_MODEL || 'gpt-5-mini',instructions,input,stream:true,max_output_tokens:700})
  });
  if (!upstream.ok) return res.status(upstream.status).send(await upstream.text());

  res.statusCode=200;
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control','no-cache, no-transform');
  res.setHeader('Connection','keep-alive');
  const reader=upstream.body.getReader();
  const decoder=new TextDecoder();
  let buffer='';
  while(true){
    const {value,done}=await reader.read();
    if(done)break;
    buffer += decoder.decode(value,{stream:true});
    const lines=buffer.split('\n'); buffer=lines.pop();
    for(const line of lines){
      if(!line.startsWith('data:'))continue;
      const raw=line.slice(5).trim();
      if(!raw || raw==='[DONE]')continue;
      try{
        const event=JSON.parse(raw);
        if(event.type==='response.output_text.delta' && event.delta) res.write('data: '+JSON.stringify({delta:event.delta})+'\n\n');
      }catch{}
    }
  }
  res.write('data: [DONE]\n\n');
  res.end();
}