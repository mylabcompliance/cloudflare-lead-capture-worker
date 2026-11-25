// Lead-capture Worker: a 60-second qualifying quiz, a site-wide call-to-action bar and lead
// emails through Cloudflare Email Routing. Put it in front of any site with a route like
// example.com/*. Built by Sound Software Development (soundsoftwaredev.com). MIT license.
import { EmailMessage } from "cloudflare:email";

// ---- Configure these (or set them as Worker variables) ----
const BRAND = "Your Company";
const BOOKING_URL = "https://cal.com/your-link";
const MAIN_SITE = "https://example.com";
const PHONE = "(555) 555-0100";
const REGION = ""; // e.g. "Texas"; shown in the quiz and bar

function siteFor(host) {
  return {
    state: REGION,
    surveyor: "your state survey agency on behalf of CMS",
    personnel: "Some states also license laboratory personnel. We'll confirm the rules for your situation.",
    facility: "Federal CLIA certification is required for any lab testing human specimens.",
    note: "",
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/clia-quiz") return quizPage(url.hostname);
    if (path === "/api/lead") {
      if (request.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
      return handleLead(request, env, ctx, url.hostname);
    }
    const res = await fetch(request);
    if (!(res.headers.get("content-type") || "").includes("text/html") || env.CTA_OFF === "1") return res;
    return new HTMLRewriter().on("body", new CtaInjector(siteFor(url.hostname))).transform(res);
  },
};

class CtaInjector {
  constructor(site) {
    this.site = site;
  }
  element(el) {
    el.append(
      `<div id="slc-cta" style="position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#0f2a44;color:#fff;font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:10px 14px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;box-shadow:0 -2px 10px rgba(0,0,0,.2)">
<span>Not sure which CLIA certificate your ${this.site.state ? esc(this.site.state) + " " : ""}lab needs? Get an answer in 60 seconds.</span>
<a href="/clia-quiz" style="background:#2e7d32;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600">Take the free quiz</a>
<button aria-label="Dismiss" onclick="this.parentNode.remove();try{sessionStorage.setItem('slcCta','x')}catch(e){}" style="background:none;border:0;color:#cbd5e1;font-size:20px;cursor:pointer">&times;</button>
</div><script>try{if(sessionStorage.getItem('slcCta'))document.getElementById('slc-cta').remove()}catch(e){}document.body.style.paddingBottom='64px'</script>`,
      { html: true }
    );
  }
}

// ---------- Lead handling ----------

async function handleLead(request, env, ctx, host) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request" }, 400);
  }
  // Spam checks: honeypot field and minimum time on page
  if (data.company_website) return json({ ok: true });
  if (typeof data.elapsed === "number" && data.elapsed < 4000) return json({ ok: true });

  const clean = (v, n = 200) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, n);
  const lead = {
    name: clean(data.name, 100),
    email: clean(data.email, 150),
    phone: clean(data.phone, 40),
    org: clean(data.org, 150),
    notes: String(data.notes ?? "").trim().slice(0, 2000),
    facility: clean(data.facility),
    tests: clean(data.tests),
    survey: clean(data.survey),
    timeline: clean(data.timeline),
    result: clean(data.result),
    site: host,
    page: clean(request.headers.get("referer"), 300),
    received: new Date().toISOString(),
  };
  if (!lead.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) {
    return json({ ok: false, error: "Please enter your name and a valid email." }, 400);
  }

  const hot = (lead.timeline === "Within 30 days" || lead.timeline === "1 to 3 months") && lead.tests !== "Waived tests only";
  const subject = `${hot ? "HOT LEAD" : "New lead"} (${siteFor(host).state || host} CLIA quiz): ${lead.name}${lead.org ? " - " + lead.org : ""}`;
  const body = [
    `New lead from the CLIA quiz on ${host}`,
    hot ? "Priority: HOT (non-waived testing, near-term timeline). Call today." : "Priority: normal",
    "",
    `Name:      ${lead.name}`,
    `Email:     ${lead.email}`,
    `Phone:     ${lead.phone || "-"}`,
    `Org:       ${lead.org || "-"}`,
    "",
    `Facility:  ${lead.facility}`,
    `Testing:   ${lead.tests}`,
    `Survey:    ${lead.survey || "-"}`,
    `Timeline:  ${lead.timeline}`,
    `Quiz said: ${lead.result}`,
    "",
    "Notes:",
    lead.notes || "-",
    "",
    `Received ${lead.received}. Reply to this email to answer the lead directly.`,
  ].join("\n");

  const tasks = [];
  if (env.LEADS) {
    tasks.push(env.LEADS.put(`lead:${lead.received}:${crypto.randomUUID()}`, JSON.stringify(lead)));
  }
  let emailed = false;
  if (env.SEND_EMAIL) {
    const to = env.LEAD_TO || "sales@example.com";
    const from = `leads@${env.FROM_DOMAIN || "example.com"}`; // must be a domain with Email Routing enabled
    const raw = [
      `From: ${BRAND} <${from}>`,
      `To: ${to}`,
      `Reply-To: ${hdr(lead.name.replace(/[<>"\\]/g, ""))} <${lead.email}>`,
      `Subject: ${hdr(subject, false)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@${host.replace(/^www\./, "")}>`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
    ].join("\r\n");
    try {
      await env.SEND_EMAIL.send(new EmailMessage(from, to, raw));
      emailed = true;
    } catch (e) {
      console.error("send_email failed", e && e.message);
    }
  }
  if (tasks.length) ctx.waitUntil(Promise.all(tasks));
  console.log("lead", JSON.stringify({ ...lead, emailed }));
  if (!emailed && !env.LEADS) return json({ ok: false, error: `Something went wrong. Please call ${PHONE}.` }, 500);
  return json({ ok: true, booking: BOOKING_URL });
}

// ---------- Quiz page ----------

function quizPage(host) {
  const s = siteFor(host);
  const st = esc(s.state || "");
  const your = s.state ? `your ${st}` : "your";
  const cfg = JSON.stringify({ state: s.state, note: s.note || "", surveyor: s.surveyor, personnel: s.personnel, facility: s.facility, booking: BOOKING_URL, phone: PHONE });
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="max-image-preview:large">
<title>Which CLIA Certificate Do I Need? | ${st ? st + " " : ""}Lab Quiz | ${BRAND}</title>
<meta name="description" content="Answer four questions to find out which CLIA certificate ${your} lab needs (Waiver, PPM, Compliance or Accreditation) and what to do next.">
<link rel="canonical" href="https://${esc(host.replace(/^www\./, ""))}/clia-quiz">
<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: `${s.state ? s.state + " " : ""}CLIA certificate quiz`,
    applicationCategory: "BusinessApplication",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    provider: { "@type": "ProfessionalService", name: BRAND, url: MAIN_SITE, telephone: PHONE },
  })}</script>
<style>
:root{--navy:#0f2a44;--green:#2e7d32;--pink:#c94fd8;--ink:#1f2937;--muted:#5b6472;--line:#e5e7eb}
*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:#f6f8fa}
header{background:var(--navy);color:#fff;padding:14px 20px}header a{color:#fff;text-decoration:none;font-weight:700}header small{display:block;color:#cbd5e1;font-weight:400}
main{max-width:720px;margin:28px auto;padding:0 16px}
h1{font-size:28px;line-height:1.2;margin:0 0 6px}.lede{color:var(--muted);margin:0 0 20px}
.card{background:#fff;border:1px solid var(--line);border-left:4px solid var(--pink);border-radius:10px;padding:22px;margin-bottom:18px}
.q{display:none}.q.on{display:block}.q h2{font-size:19px;margin:0 0 12px}
.opt{display:block;width:100%;text-align:left;background:#fff;border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:8px 0;font:inherit;cursor:pointer}
.opt:hover,.opt:focus{border-color:var(--green);outline:none;background:#f3faf3}.opt small{display:block;color:var(--muted)}
.bar{height:6px;background:var(--line);border-radius:3px;margin-bottom:16px}.bar i{display:block;height:100%;background:var(--green);border-radius:3px;width:0;transition:width .2s}
.back{background:none;border:0;color:var(--muted);cursor:pointer;padding:0;font:inherit;margin-top:6px}
.result h2{color:var(--green);margin:0 0 8px;font-size:22px}.result ul{padding-left:20px}
label{display:block;font-weight:600;margin:12px 0 4px}input,textarea,select{width:100%;padding:10px;border:1px solid #cfd5dc;border-radius:6px;font:inherit}
.btn{display:inline-block;background:var(--green);color:#fff;border:0;border-radius:6px;padding:12px 18px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none;margin-top:14px}
.btn.alt{background:var(--navy)}.hp{position:absolute;left:-9999px}.msg{margin-top:10px;font-weight:600}
.fine{font-size:13px;color:var(--muted)}footer{max-width:720px;margin:0 auto 40px;padding:0 16px}
</style></head><body>
<header><a href="/">${st ? st + " " : ""}${BRAND}<small>Free CLIA certificate quiz</small></a></header>
<main>
<h1>Which CLIA certificate does ${your} lab need?</h1>
<p class="lede">Four quick questions. You'll see your answer right away, no email needed.</p>
<div class="card" id="quiz"><div class="bar"><i id="prog"></i></div>
<div class="q on" data-k="facility"><h2>1. What kind of facility is this?</h2>
<button class="opt">Physician office or clinic</button><button class="opt">Urgent care or freestanding ER</button><button class="opt">Hospital</button><button class="opt">Independent or reference lab</button><button class="opt">Mobile lab or specimen collection site</button></div>
<div class="q" data-k="tests"><h2>2. What is the most complex testing you will do?</h2>
<button class="opt" data-v="Waived tests only">Waived tests only<small>e.g. rapid strep, flu or COVID antigen, glucose meter, urine dipstick, A1c on a waived device</small></button>
<button class="opt" data-v="Provider-performed microscopy">Provider-performed microscopy (plus any waived)<small>e.g. wet mounts, KOH preps, urine sediment, read by a physician, NP or PA during the visit</small></button>
<button class="opt" data-v="Moderate complexity">Moderate complexity<small>e.g. most automated chemistry, hematology and coagulation analyzers</small></button>
<button class="opt" data-v="High complexity">High complexity<small>e.g. PCR and molecular, lab-developed tests, cytology, manual differentials, flow cytometry</small></button>
<button class="opt" data-v="Not sure">Not sure yet<small>We'll help you sort out your test menu</small></button></div>
<div class="q" data-k="survey"><h2>3. Who would you rather have inspect the lab?</h2>
<button class="opt" data-v="Accreditation (COLA, CAP or Joint Commission)">An accreditor (COLA, CAP or The Joint Commission)<small>Often preferred by payers and hospital systems</small></button>
<button class="opt" data-v="State survey for CMS">The state survey agency for CMS</button>
<button class="opt" data-v="Not sure">Not sure</button></div>
<div class="q" data-k="timeline"><h2>4. When do you want to start patient testing?</h2>
<button class="opt">Within 30 days</button><button class="opt">1 to 3 months</button><button class="opt">3 to 6 months</button><button class="opt">Just researching</button></div>
<button class="back" id="back" hidden>&larr; Back</button>
<div class="result" id="result" hidden></div>
</div>
<div class="card" id="lead" hidden>
<h2 style="margin-top:0">Get your free ${st ? st + " " : ""}lab startup review</h2>
<p>Send this result to a ${BRAND} expert. We'll reply within one business day with a checklist for your certificate type and answers to your questions.</p>
<form id="f" novalidate>
<label for="name">Name</label><input id="name" name="name" autocomplete="name" required>
<label for="email">Work email</label><input id="email" name="email" type="email" autocomplete="email" required>
<label for="phone">Phone (optional)</label><input id="phone" name="phone" type="tel" autocomplete="tel">
<label for="org">Practice or lab name (optional)</label><input id="org" name="org" autocomplete="organization">
<label for="notes">Anything else we should know? (optional)</label><textarea id="notes" name="notes" rows="3" placeholder="Test menu, instruments, opening date..."></textarea>
<input class="hp" name="company_website" tabindex="-1" autocomplete="off" aria-hidden="true">
<button class="btn" type="submit">Send me my review</button>
<p class="msg" id="msg" role="status"></p>
<p class="fine">We use your details only to reply to you. Prefer to talk now? <a href="${BOOKING_URL}">Book a free consultation</a> or call ${PHONE}.</p>
</form></div>
</main>
<footer><p class="fine">Educational guidance from ${BRAND}, an independent firm not affiliated with CMS, CDC, FDA, state agencies or accreditors. Final certificate requirements depend on your exact test menu; confirm with the agency. <a href="${MAIN_SITE}">${MAIN_SITE.replace("https://", "")}</a></p></footer>
<script>
const C=${cfg};const t0=Date.now();const A={};let i=0;
const qs=[...document.querySelectorAll('.q')],prog=document.getElementById('prog'),back=document.getElementById('back');
function show(n){qs.forEach((q,j)=>q.classList.toggle('on',j===n));back.hidden=n===0;prog.style.width=(n/qs.length*100)+'%'}
function skipSurvey(){return A.tests==='Waived tests only'||A.tests==='Provider-performed microscopy'}
qs.forEach((q,n)=>q.querySelectorAll('.opt').forEach(b=>b.onclick=()=>{A[q.dataset.k]=b.dataset.v||b.childNodes[0].textContent.trim();let nx=n+1;if(qs[nx]&&qs[nx].dataset.k==='survey'&&skipSurvey()){A.survey='';nx++}if(nx<qs.length){i=nx;show(i)}else finish()}));
back.onclick=()=>{let p=i-1;if(qs[p]&&qs[p].dataset.k==='survey'&&skipSurvey())p--;i=Math.max(0,p);show(i)};
function finish(){
 qs.forEach(q=>q.classList.remove('on'));back.hidden=true;prog.style.width='100%';
 let title,pts=[];
 const T=A.tests;
 if(T==='Waived tests only'){title='Certificate of Waiver';pts=['You can only run tests FDA has categorized as waived, following the manufacturer instructions exactly.','File the CMS-116 application and pay the CLIA fee before testing patients.','Routine surveys don\\'t apply to waiver labs, but CMS can still visit, so keep instructions, logs and results organized.']}
 else if(T==='Provider-performed microscopy'){title='Provider-Performed Microscopy (PPM) Certificate';pts=['Covers waived tests plus specific microscopy procedures done by a physician, NP, PA or similar provider during the patient visit.','Requires proficiency testing where available, competency assessment and documented procedures.','If anyone other than a qualifying provider reads the slides, you need a Compliance or Accreditation certificate instead.']}
 else if(T==='Not sure'){title='It depends on your test menu';pts=['Your certificate type must match the most complex test you run. One moderate-complexity test means you need more than a waiver.','We can classify your planned test menu and instruments for you on a short call.']}
 else{const acc=(A.survey||'').startsWith('Accreditation');title=acc?'Certificate of Accreditation':(A.survey==='Not sure'?'Certificate of Compliance or Accreditation':'Certificate of Compliance');
  pts=['Non-waived ('+T.toLowerCase()+') testing needs a qualified lab director, proficiency testing, quality control, method verification and personnel competency under 42 CFR Part 493.',
  acc?'Your accreditor (COLA, CAP or The Joint Commission) inspects you instead of the state, typically every two years.':'Certificate of Compliance labs are surveyed by '+C.surveyor+'. Accreditation (COLA, CAP or TJC) is the alternative.',
  'You usually start on a Registration Certificate while the initial inspection is pending.'];
  if(T==='High complexity')pts.push('High-complexity testing has stricter director, supervisor and testing personnel qualifications; plan staffing early.')}
 pts.push(C.facility);if(T!=='Waived tests only')pts.push(C.personnel);
 const urgent=A.timeline==='Within 30 days'&&T!=='Waived tests only';
 if(urgent)pts.push('A non-waived lab live within 30 days is a tight timeline. Talk to us this week.');
 A.result=title;
 const r=document.getElementById('result');r.hidden=false;
 r.innerHTML='<h2>Most likely: '+title+'</h2>'+(C.note?'<p style="background:#fff7e6;border-left:3px solid #d97706;padding:8px 12px">'+C.note+'</p>':'')+'<ul>'+pts.map(p=>'<li>'+p+'</li>').join('')+'</ul><a class="btn alt" href="'+C.booking+'">Book a free consultation</a> <button class="btn" id="go">Get my free startup review</button> <button class="back" id="redo">Start over</button>';
 document.getElementById('go').onclick=()=>{document.getElementById('lead').hidden=false;document.getElementById('name').focus()};
 document.getElementById('redo').onclick=()=>{r.hidden=true;document.getElementById('lead').hidden=true;i=0;show(0)};
 document.getElementById('lead').hidden=false;
}
document.getElementById('f').onsubmit=async e=>{e.preventDefault();const f=e.target,m=document.getElementById('msg'),b=f.querySelector('button');
 const d=Object.fromEntries(new FormData(f));Object.assign(d,A,{elapsed:Date.now()-t0});
 if(!d.name||!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(d.email)){m.textContent='Please enter your name and a valid email.';return}
 b.disabled=true;m.textContent='Sending...';
 try{const r=await fetch('/api/lead',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)});const j=await r.json();
  if(j.ok){f.innerHTML='<p class="msg">Thanks! A ${BRAND} expert will reply within one business day.</p><a class="btn" href="'+C.booking+'">Pick a time to talk now</a>';try{gtag&&gtag('event','generate_lead')}catch(_){}}
  else{m.textContent=j.error||'Something went wrong.';b.disabled=false}}
 catch(_){m.textContent='Network error. Please call '+C.phone+'.';b.disabled=false}};
</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}

// Header-safe text: plain ASCII is quoted, anything else is RFC 2047 encoded
function hdr(s, quote = true) {
  if (/^[\x20-\x7e]*$/.test(s)) return quote ? `"${s.replace(/"/g, "")}"` : s;
  const b = btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  return `=?UTF-8?B?${b}?=`;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
