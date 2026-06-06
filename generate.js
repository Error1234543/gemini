// ═══════════════════════════════════════════════════════════════
// NEXUS HUB XD — generate.js (Gemini Version)
// ═══════════════════════════════════════════════════════════════

const GEMINI_KEYS = [
  'YOUR_GEMINI_API_KEY_1',
  'YOUR_GEMINI_API_KEY_2',
  'YOUR_GEMINI_API_KEY_3',
];

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

// ── KEY RATE LIMIT TRACKER ────────────────────────────────────
const keyStatus = {};
function isKeyAvailable(idx) {
  const s = keyStatus[idx];
  if (!s || !s.limited) return true;
  if (Date.now() > s.resetAt) { keyStatus[idx] = { limited: false }; return true; }
  return false;
}
function markRateLimited(idx, sec) {
  keyStatus[idx] = { limited: true, resetAt: Date.now() + (sec || 30) * 1000 };
  console.warn(`Gemini Key ${idx + 1} rate limited for ${sec || 30}s`);
}
function getWaitTime() {
  const times = GEMINI_KEYS.map((k, i) => {
    if (!k || k.startsWith('YOUR_')) return Infinity;
    if (isKeyAvailable(i)) return 0;
    return Math.ceil((keyStatus[i].resetAt - Date.now()) / 1000);
  });
  return Math.min(...times);
}

// ── GEMINI API CALL WITH KEY ROTATION ────────────────────────
let lastKeyIdx = 0;
async function callGemini(prompt, systemPrompt) {
  const validIdxs = GEMINI_KEYS
    .map((k, i) => i)
    .filter(i => GEMINI_KEYS[i] && !GEMINI_KEYS[i].startsWith('YOUR_'));

  if (!validIdxs.length) return { error: 'no_keys' };

  for (let a = 0; a < validIdxs.length; a++) {
    const idx = validIdxs[(lastKeyIdx + a) % validIdxs.length];
    if (!isKeyAvailable(idx)) continue;

    try {
      const body = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json'
        }
      };

      const res = await fetch(GEMINI_URL(GEMINI_KEYS[idx]), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (res.status === 429) {
        let wait = 30;
        try {
          const j = await res.clone().json();
          const msg = j?.error?.message || '';
          const m = msg.match(/(\d+)\s*second/i);
          if (m) wait = parseInt(m[1]);
          // Check retryDelay in details
          const detail = j?.error?.details?.find(d => d?.retryDelay);
          if (detail?.retryDelay) wait = parseInt(detail.retryDelay) || wait;
        } catch {}
        markRateLimited(idx, wait);
        continue;
      }

      if (res.status === 400 || res.status === 403) {
        console.error(`Gemini Key ${idx + 1} error ${res.status} — check key`);
        keyStatus[idx] = { limited: true, resetAt: Date.now() + 999999999 };
        continue;
      }

      if (!res.ok) {
        console.error(`Gemini Key ${idx + 1} error ${res.status}`);
        continue;
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;

      lastKeyIdx = (validIdxs.indexOf(idx) + 1) % validIdxs.length;
      return { text };

    } catch (e) {
      console.error(`Gemini Key ${idx + 1} network error:`, e.message);
    }
  }

  const wait = getWaitTime();
  if (wait === Infinity) return { error: 'no_keys' };
  if (wait > 0) return { error: 'rate_limit', waitSec: wait };
  return { error: 'all_failed' };
}

// ── EXAM PROMPTS ──────────────────────────────────────────────
const EXAM_PROMPTS = {
  'NEET UG': `You are an expert NEET UG MCQ generator.
Standards: Strictly NCERT-based (Class 11 & 12). Medical entrance level.
Mix: direct concept, NCERT statement completion, which-is-correct, which-is-incorrect, assertion-based, diagram-based, clinical application questions.
Every question must test NCERT knowledge deeply.`,

  'JEE Main': `You are an expert JEE Main MCQ generator.
Standards: NTA pattern, application-based, numerical concepts. Engineering entrance level.
Mix: formula-based, concept-based, application-based questions.`,

  'JEE Advanced': `You are an expert JEE Advanced MCQ generator.
Standards: Highest difficulty, multi-concept integration, deep analytical thinking.
Questions must be tricky with closely related options.`,

  'GUJCET': `You are an expert GUJCET MCQ generator.
Standards: Gujarat State Board syllabus (GSEB). State entrance level.
Based on GSEB textbooks, standard applications.`,

  'Gujarat Board (GHSEB)': `You are an expert GHSEB MCQ generator.
Standards: Class 11-12 Gujarat Board syllabus. Board exam level.
Focus on textbook definitions, standard formulas, direct applications.`,

  'General': `You are an expert MCQ generator.
Create well-balanced questions covering theory, application, and analysis.`
};

// ── MAIN GENERATE FUNCTION ────────────────────────────────────
async function generateQuestions({ topic, numQ, difficulty, language, exam, subject, onProgress, onError }) {
  const examPrompt = EXAM_PROMPTS[exam] || EXAM_PROMPTS['General'];
  const total = parseInt(numQ);
  const isGuj = language === 'Gujarati';
  const isHin = language === 'Hindi';

  const langInstruction = isGuj
    ? `Write ALL questions and options in Gujarati script (ગુજરાતી).
IMPORTANT: Keep scientific names, Latin terms, chemical formulas in original English/Latin (Homo sapiens, DNA, H2O, ATP etc). Never transliterate scientific terms. Use proper Gujarati words only.`
    : isHin
    ? `Write ALL questions and options in Hindi (हिंदी).
IMPORTANT: Keep scientific names, Latin terms, chemical formulas in original English/Latin. Use proper Hindi words only.`
    : `Write everything in clear English.`;

  // Gemini can handle larger batches — much higher token limits!
  const BATCH = isGuj ? 5 : isHin ? 8 : 15;
  const totalBatches = Math.ceil(total / BATCH);

  const diffMap = {
    easy: exam === 'JEE Advanced' ? 'medium' : 'easy',
    medium: 'medium', hard: 'hard',
    mixed: 'varied mix of easy, medium and hard'
  };

  let allQ = [];
  const seenQ = new Set();

  async function fetchOneBatch(batchIdx, startId) {
    const bCount = Math.min(BATCH, total - startId);
    if (bCount <= 0) return [];

    const stems = isGuj
      ? `કયો, કઈ, શું, ક્યારે, કોણ, કેટલા, નીચેમાંથી, સાચો વિકલ્પ, ખોટું વિધાન, ક્યાં, કઈ પ્રક્રિયા, કયા કારણ`
      : isHin
      ? `कौन सा, क्या, कितने, नीचे में से, सही विकल्प, गलत कथन, कहाँ, कब, किस कारण, कौन सी प्रक्रिया`
      : `Which, What, How many, Identify, Which of the following, The correct statement, Which is NOT, Where, When, In which process, According to NCERT`;

    const existing = allQ.length > 0
      ? `\nALREADY GENERATED — DO NOT REPEAT THESE TOPICS/CONCEPTS:\n${allQ.map(q => q.question.slice(0, 70)).join('\n')}`
      : '';

    const sysPrompt = `${examPrompt}
${langInstruction}
You must return ONLY a valid JSON array. No markdown, no backticks, no explanation text outside JSON.
Make every single question completely unique and different from each other.`;

    const userPrompt = `Generate exactly ${bCount} unique MCQ questions about: "${topic}"
Exam: ${exam} | Subject: ${subject || 'General'} | Difficulty: ${diffMap[difficulty] || difficulty}
${langInstruction}
These are questions ${startId + 1} to ${startId + bCount} of ${total} total.${existing}

STRICT RULES:
1. Every question MUST cover a DIFFERENT concept/fact — no repetition at all
2. Each question must start with a DIFFERENT word: ${stems}
3. All 4 options must be plausible and distinct
4. Return ONLY this JSON format:
[
  {
    "question": "question text here",
    "options": ["option A", "option B", "option C", "option D"],
    "correct": 0,
    "explanation": "brief 1-2 line explanation"
  }
]
5. "correct" = 0-based index (0=A, 1=B, 2=C, 3=D)
6. Start response with [ and end with ]`;

    for (let retry = 0; retry < 3; retry++) {
      const result = await callGemini(userPrompt, sysPrompt);

      if (!result || result.error) {
        if (result?.error === 'rate_limit') {
          const w = result.waitSec || 30;
          if (onError) onError('rate_limit', w);
          await new Promise(r => setTimeout(r, w * 1000));
          continue;
        }
        if (result?.error === 'no_keys') {
          if (onError) onError('no_keys', 0);
          return [];
        }
        continue;
      }

      // Parse JSON from Gemini response
      let parsed;
      try {
        let text = result.text.trim();
        // Remove markdown if somehow present
        text = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const s = text.indexOf('['), e = text.lastIndexOf(']');
        if (s === -1 || e === -1) continue;
        let jsonStr = text.substring(s, e + 1)
          .replace(/,\s*]/g, ']')
          .replace(/,\s*}/g, '}')
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');
        parsed = JSON.parse(jsonStr);
      } catch (err) {
        console.error('JSON parse error:', err.message);
        continue;
      }

      if (!Array.isArray(parsed) || !parsed.length) continue;

      return parsed
        .filter(q => q.question && q.question.length > 5)
        .map((q, i) => ({
          id: startId + i + 1,
          question: q.question,
          options: Array.isArray(q.options) && q.options.length >= 4
            ? q.options.slice(0, 4)
            : ['Option A', 'Option B', 'Option C', 'Option D'],
          correct: typeof q.correct === 'number' && q.correct >= 0 && q.correct <= 3 ? q.correct : 0,
          explanation: q.explanation || 'Refer to textbook.',
          difficulty
        }));
    }
    return [];
  }

  // Sequential — each batch gets full list of already generated questions
  for (let b = 0; b < totalBatches; b++) {
    const startId = b * BATCH;
    if (startId >= total) break;

    const res = await fetchOneBatch(b, startId);

    const unique = res.filter(q => {
      const key = q.question.trim().toLowerCase().slice(0, 60);
      if (seenQ.has(key)) return false;
      seenQ.add(key);
      return true;
    });
    unique.forEach((q, i) => { q.id = allQ.length + i + 1; });
    allQ = [...allQ, ...unique];
    if (onProgress) onProgress(allQ.length, total, b + 1, totalBatches);
  }

  return allQ;
}

// ── HTML QUIZ BUILDER (same as before) ───────────────────────
function buildQuizHTML({ title, exam, subject, topic, difficulty, language, questions }) {
  const diffLabel = { easy: 'Easy', medium: 'Medium', hard: 'Hard', mixed: 'Mixed' }[difficulty] || difficulty;
  const questionsJSON = JSON.stringify(questions);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#0a0a0f;--surface:#13131a;--card:#1a1a24;--border:#2a2a3a;--accent:#7c6aff;--accent2:#ff6a9b;--accent3:#6affd4;--text:#e8e8f0;--muted:#7070a0;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding:20px;}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at 20% 20%,rgba(124,106,255,.08),transparent 50%),radial-gradient(ellipse at 80% 80%,rgba(255,106,155,.06),transparent 50%);pointer-events:none;}
.container{max-width:860px;margin:0 auto;position:relative;z-index:1;}
.quiz-header{text-align:center;padding:32px 20px 24px;background:var(--card);border:1px solid var(--border);border-radius:20px;margin-bottom:20px;}
.quiz-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.3);color:#00d4ff;font-size:11px;font-weight:700;padding:5px 14px;border-radius:20px;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;}
.quiz-title{font-family:'Syne',sans-serif;font-size:clamp(22px,5vw,36px);font-weight:800;background:linear-gradient(135deg,#00d4ff,#7c6aff,#ff6a9b);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px;}
.quiz-meta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:14px;}
.meta-tag{background:var(--surface);border:1px solid var(--border);padding:5px 12px;border-radius:8px;font-size:12px;color:var(--muted);}
.meta-tag span{color:var(--text);font-weight:600;}
.score-bar{background:var(--card);border:1px solid rgba(0,212,255,.2);border-radius:16px;padding:20px 24px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.score-main{font-family:'Syne',sans-serif;font-size:42px;font-weight:800;background:linear-gradient(135deg,#00d4ff,#7c6aff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.score-detail{font-size:13px;color:var(--muted);margin-top:2px;}
.progress-wrap{flex:1;min-width:160px;}
.progress-track{height:8px;background:var(--border);border-radius:10px;overflow:hidden;margin-top:8px;}
.progress-fill{height:100%;background:linear-gradient(90deg,#00d4ff,#7c6aff);border-radius:10px;transition:width .5s ease;}
.controls{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;}
.btn{padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--surface);color:var(--text);transition:all .2s;font-family:'DM Sans',sans-serif;}
.btn:hover{border-color:#00d4ff;color:#00d4ff;}
.btn.primary{background:linear-gradient(135deg,#00d4ff,#7c6aff);border:none;color:white;}
.btn.primary:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,212,255,.4);}
.btn.danger{border-color:rgba(255,106,155,.4);color:var(--accent2);}
.q-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:22px;margin-bottom:12px;}
.q-top{display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;}
.q-num{background:linear-gradient(135deg,#00d4ff,#7c6aff);color:white;font-family:'Syne',sans-serif;font-weight:800;font-size:11px;min-width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.q-text{font-size:15px;font-weight:500;line-height:1.6;flex:1;}
.opts{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.opt{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:11px 14px;cursor:pointer;transition:all .2s;font-size:14px;line-height:1.4;}
.opt:hover:not(.locked){border-color:#7c6aff;background:rgba(124,106,255,.07);}
.opt.correct{border-color:var(--accent3);background:rgba(106,255,212,.08);color:var(--accent3);}
.opt.wrong{border-color:var(--accent2);background:rgba(255,106,155,.08);color:var(--accent2);}
.opt-ltr{width:24px;height:24px;background:var(--border);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;}
.opt.correct .opt-ltr{background:var(--accent3);color:#000;}
.opt.wrong .opt-ltr{background:var(--accent2);color:#fff;}
.exp{display:none;margin-top:14px;padding:12px 16px;background:rgba(0,212,255,.06);border:1px solid rgba(0,212,255,.15);border-radius:10px;font-size:13px;color:#00d4ff;line-height:1.7;}
.exp.show{display:block;}
.exp::before{content:'💡 ';}
.fin-card{display:none;text-align:center;background:var(--card);border:2px solid rgba(0,212,255,.3);border-radius:20px;padding:40px 24px;margin-bottom:20px;}
.fin-card.show{display:block;}
.fin-score{font-family:'Syne',sans-serif;font-size:72px;font-weight:800;background:linear-gradient(135deg,#00d4ff,#7c6aff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;line-height:1;}
.fin-label{font-size:15px;color:var(--muted);margin-top:8px;}
.fin-msg{font-size:28px;margin:16px 0 8px;}
.branding{text-align:center;padding:20px;color:var(--muted);font-size:12px;border-top:1px solid var(--border);margin-top:28px;}
.branding strong{color:#00d4ff;}
@media(max-width:600px){.opts{grid-template-columns:1fr;}.score-bar{flex-direction:column;}}
</style>
</head>
<body>
<div class="container">
  <div class="quiz-header">
    <div class="quiz-badge">📚 ${exam} — ${diffLabel}</div>
    <div class="quiz-title">${title}</div>
    <div style="color:var(--muted);font-size:14px;margin-top:6px;">${subject} · ${questions.length} Questions · ${language}</div>
    <div class="quiz-meta">
      <div class="meta-tag">Topic: <span>${topic}</span></div>
      <div class="meta-tag">Exam: <span>${exam}</span></div>
      <div class="meta-tag">Difficulty: <span>${diffLabel}</span></div>
      <div class="meta-tag">Questions: <span>${questions.length}</span></div>
    </div>
  </div>
  <div class="score-bar">
    <div>
      <div class="score-main" id="scoreNum">0/${questions.length}</div>
      <div class="score-detail" id="scorePct">0% · 0 answered</div>
    </div>
    <div class="progress-wrap">
      <div style="font-size:12px;color:var(--muted);">Progress</div>
      <div class="progress-track"><div class="progress-fill" id="pFill" style="width:0%"></div></div>
    </div>
  </div>
  <div class="controls">
    <button class="btn primary" onclick="revealAll()">👁️ Show All Answers</button>
    <button class="btn" onclick="resetQuiz()">🔄 Reset</button>
    <button class="btn danger" onclick="document.getElementById('finCard').classList.toggle('show')">📊 Final Score</button>
  </div>
  <div class="fin-card" id="finCard">
    <div class="fin-score" id="finScore">-</div>
    <div class="fin-label" id="finLabel">Complete the quiz to see results</div>
    <div class="fin-msg" id="finMsg"></div>
  </div>
  <div id="questionsWrap"></div>
  <div class="branding">Generated by <strong>NEXUS HUB XD</strong> · ${exam} · ${new Date().toLocaleDateString('en-IN')}</div>
</div>
<script>
const Q=${questionsJSON};
let ans={},sc=0;
function render(){
  document.getElementById('questionsWrap').innerHTML=Q.map((q,i)=>\`<div class="q-card" id="qc\${i}">
    <div class="q-top"><div class="q-num">\${i+1}</div><div class="q-text">\${q.question}</div></div>
    <div class="opts">\${q.options.map((o,oi)=>\`<div class="opt" id="o_\${i}_\${oi}" onclick="pick(\${i},\${oi})"><div class="opt-ltr">\${'ABCD'[oi]}</div><span>\${o}</span></div>\`).join('')}</div>
    <div class="exp" id="e\${i}">\${q.explanation}</div>
  </div>\`).join('');
}
function pick(qi,sel){
  if(ans[qi]!==undefined)return;
  ans[qi]=sel;const c=Q[qi].correct;
  document.getElementById('o_'+qi+'_'+c)?.classList.add('correct');
  if(sel!==c)document.getElementById('o_'+qi+'_'+sel)?.classList.add('wrong');
  document.querySelectorAll('#qc'+qi+' .opt').forEach(e=>e.classList.add('locked'));
  document.getElementById('e'+qi)?.classList.add('show');
  if(sel===c)sc++;upd();
}
function upd(){
  const d=Object.keys(ans).length,t=Q.length,p=d?Math.round(sc/d*100):0;
  document.getElementById('scoreNum').textContent=sc+'/'+d;
  document.getElementById('scorePct').textContent=p+'% · '+d+'/'+t+' answered';
  document.getElementById('pFill').style.width=(d/t*100)+'%';
  document.getElementById('finScore').textContent=sc+'/'+d;
  document.getElementById('finLabel').textContent=p+'% · '+d+'/'+t+' answered';
  if(d===t)document.getElementById('finMsg').textContent=p>=80?'🏆 Excellent!':p>=60?'👍 Good Job!':p>=40?'📚 Keep Studying!':'💪 Try Again!';
}
function revealAll(){
  Q.forEach((q,i)=>{if(ans[i]===undefined){ans[i]=q.correct;document.getElementById('o_'+i+'_'+q.correct)?.classList.add('correct');document.querySelectorAll('#qc'+i+' .opt').forEach(e=>e.classList.add('locked'));document.getElementById('e'+i)?.classList.add('show');}});
  sc=0;Q.forEach((q,i)=>{if(ans[i]===q.correct)sc++;});upd();document.getElementById('finCard').classList.add('show');
}
function resetQuiz(){ans={};sc=0;document.getElementById('finCard').classList.remove('show');render();upd();}
render();
</script>
</body>
</html>`;
}

window.NEXUS = { generateQuestions, buildQuizHTML, GEMINI_KEYS };
