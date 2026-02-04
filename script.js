/***********************
 * Session2
 ***********************/
const SESSION_START = "10:30";
const SESSION_END   = "12:30";

// 枠（時間タグ）＆タイムライン帯の色：slot順で対応
const SLOT_COLORS = [
  "#60a5fa", // blue
  "#fbbf24", // amber
  "#fb7185", // rose
  "#34d399", // emerald
  "#a78bfa", // violet
  "#22d3ee", // cyan
  "#f97316", // orange
  "#eab308", // yellow
];

/***********************
 * Utils
 ***********************/
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
function pad2(x){ return String(x).padStart(2,"0"); }

function timeToMin(t){
  if(!t || typeof t !== "string") return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if(!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if(hh<0||hh>23||mm<0||mm>59) return null;
  return hh*60+mm;
}
function minToTime(m){
  const hh = Math.floor(m/60), mm = m%60;
  return `${pad2(hh)}:${pad2(mm)}`;
}
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[s]));
}
function hexToRgba(hex, alpha){
  const h = hex.replace("#","").trim();
  const full = (h.length===3) ? h.split("").map(x=>x+x).join("") : h;
  const r = parseInt(full.slice(0,2),16);
  const g = parseInt(full.slice(2,4),16);
  const b = parseInt(full.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const SESSION_START_MIN = timeToMin(SESSION_START);
const SESSION_END_MIN   = timeToMin(SESSION_END);

function normalizePoster(p){
  const out = {...p};
  if(!Array.isArray(out.slots)) out.slots = [];
  if(out.slots.length===0 && out.start && out.end){
    out.slots = [{start: out.start, end: out.end}];
  }
  out.slots = out.slots
    .map(s => ({start: s?.start ?? "", end: s?.end ?? ""}))
    .filter(s => timeToMin(s.start)!==null && timeToMin(s.end)!==null && timeToMin(s.end) > timeToMin(s.start))
    .sort((a,b) => timeToMin(a.start) - timeToMin(b.start));
  return out;
}

function isActiveSlot(slot, nowMin){
  const s = timeToMin(slot.start), e = timeToMin(slot.end);
  if(s===null || e===null) return false;
  return (s <= nowMin) && (nowMin < e);
}
function isActivePoster(p, nowMin){
  const pp = normalizePoster(p);
  return pp.slots.some(sl => isActiveSlot(sl, nowMin));
}
function activeSlotOfPoster(p, nowMin){
  const pp = normalizePoster(p);
  return pp.slots.find(sl => isActiveSlot(sl, nowMin)) || null;
}
function nextSlotOfPoster(p, nowMin){
  const pp = normalizePoster(p);
  return pp.slots.find(sl => timeToMin(sl.start) !== null && timeToMin(sl.start) > nowMin) || null;
}
function intersectsRangeSlot(slot, fromMin, toMin){
  const s = timeToMin(slot.start), e = timeToMin(slot.end);
  if(s===null || e===null) return false;
  const A = (fromMin===null) ? -Infinity : fromMin;
  const B = (toMin===null) ? Infinity : toMin;
  return !(e <= A || B <= s);
}
function intersectsRangePoster(p, fromMin, toMin){
  if(fromMin===null && toMin===null) return true;
  const pp = normalizePoster(p);
  if(pp.slots.length===0) return false;
  return pp.slots.some(sl => intersectsRangeSlot(sl, fromMin, toMin));
}

// lanes if overlap
function computeLanes(slots){
  const items = slots.map((sl, idx) => ({
    ...sl,
    idx,
    s: timeToMin(sl.start),
    e: timeToMin(sl.end)
  })).filter(x => x.s!==null && x.e!==null && x.e>x.s);

  items.sort((a,b)=>a.s-b.s);

  const lanes = [];
  const placed = [];

  for(const it of items){
    let placedLane = -1;
    for(let i=0;i<lanes.length;i++){
      if(lanes[i] <= it.s){ placedLane = i; break; }
    }
    if(placedLane === -1){
      lanes.push(it.e);
      placedLane = lanes.length-1;
    }else{
      lanes[placedLane] = it.e;
    }
    placed.push({slot: it, lane: placedLane});
  }
  return {laneCount: lanes.length, placed};
}

function slotColorByIndex(i){
  return SLOT_COLORS[i % SLOT_COLORS.length];
}

/***********************
 * Data
 ***********************/
let posters = [];

function parseCsv(text){
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  for(let i=0;i<text.length;i++){
    const ch = text[i];
    const next = text[i+1];
    if(inQuotes){
      if(ch === "\"" && next === "\""){ cur += "\""; i++; continue; }
      if(ch === "\""){ inQuotes = false; continue; }
      cur += ch;
      continue;
    }
    if(ch === "\""){ inQuotes = true; continue; }
    if(ch === ","){ row.push(cur); cur=""; continue; }
    if(ch === "\n"){
      row.push(cur); cur="";
      if(row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      continue;
    }
    if(ch === "\r"){ continue; }
    cur += ch;
  }
  row.push(cur);
  if(row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

function slotsFromCell(cell){
  const text = (cell ?? "").trim();
  if(!text) return [];
  // 例: 10:30-11:00|11:30-12:00
  return text.split("|").map(s => s.trim()).filter(Boolean).map(pair => {
    const m = pair.split("-").map(x => x.trim());
    return {start: m[0] ?? "", end: m[1] ?? ""};
  });
}

function postersFromCsv(text){
  const rows = parseCsv(text);
  if(rows.length === 0) return [];
  const header = rows[0].map((h, i) => {
    const v = String(h ?? "");
    const noBom = (i === 0) ? v.replace(/^\uFEFF/, "") : v;
    return noBom.trim().toLowerCase();
  });
  const idx = (name) => header.indexOf(name);
  const iId = idx("id");
  const iTitle = idx("title");
  const iPresenter = idx("presenter");
  const iCategory = idx("category");
  const iBoard = idx("board");
  const iSlots = idx("slots");
  return rows.slice(1).map(r => {
    const p = {
      id: iId >= 0 ? (r[iId] ?? "").trim() : "",
      title: iTitle >= 0 ? (r[iTitle] ?? "").trim() : "",
      presenter: iPresenter >= 0 ? (r[iPresenter] ?? "").trim() : "",
      category: iCategory >= 0 ? (r[iCategory] ?? "").trim() : "",
      board: iBoard >= 0 ? (r[iBoard] ?? "").trim() : "",
      slots: iSlots >= 0 ? slotsFromCell(r[iSlots]) : []
    };
    return normalizePoster(p);
  }).filter(p => p.title || p.presenter || p.board || p.category || p.id);
}

async function loadPosters(){
  // prefer CSV if available, fallback to JSON
  const csvRes = await fetch("data.csv", {cache: "no-store"});
  if(csvRes.ok){
    const text = await csvRes.text();
    return postersFromCsv(text);
  }
  const res = await fetch("data.json", {cache: "no-store"});
  if(!res.ok) throw new Error("data.csv / data.json を読み込めませんでした。");
  const data = await res.json();
  if(!Array.isArray(data)) throw new Error("data.jsonは配列（[]）である必要があります。");
  return data.map(normalizePoster);
}

/***********************
 * State
 ***********************/
const state = {
  onlyNow: false,
  timelineOn: false,
  selectedCats: new Set(), // set after categories are built
  q: "",
  fromMin: null,
  toMin: null
};
let manualNowMin = null;

function getNowMin(){
  if(manualNowMin !== null) return manualNowMin;
  const d = new Date();
  return d.getHours()*60 + d.getMinutes();
}

function updateClock(){
  const nowMin = getNowMin();
  $("#clockText").textContent = minToTime(nowMin);
  $("#clockBadge").textContent = (manualNowMin===null) ? "NOW" : "FIXED";
  $("#clockMode").textContent = (manualNowMin===null) ? "リアルタイム" : "手動固定";

  $("#manualState").textContent = (manualNowMin===null) ? "リアルタイム" : "手動固定中";
  $("#manualStateTime").textContent = (manualNowMin===null) ? "—" : minToTime(manualNowMin);
}

function setOnlyNow(on){
  state.onlyNow = on;
  $("#onlyNowBtn").classList.toggle("primary", on);
  $("#onlyNowCheckbox").checked = on;
  apply();
}
function setTimeline(on){
  state.timelineOn = on;
  $("#timelineToggleBtn").classList.toggle("primary", on);
  apply();
}
function readAdminFilters(){
  state.fromMin = timeToMin($("#fromTime").value);
  state.toMin   = timeToMin($("#toTime").value);
}

function extractCategories(data){
  const set = new Set();
  for(const p of data){
    const c = (p?.category ?? "").trim();
    if(c) set.add(c);
  }
  return [...set].sort((a,b)=>a.localeCompare(b, "ja"));
}

// stable per-category color
function categoryColor(cat){
  // simple hash -> hue
  let h = 0;
  for(let i=0;i<cat.length;i++){ h = (h*31 + cat.charCodeAt(i)) >>> 0; }
  const hue = h % 360;
  return `hsl(${hue} 80% 65%)`;
}

function rebuildCategoryChips(){
  const cats = extractCategories(posters);
  const root = $("#catChips");
  root.innerHTML = "";

  // init selection: if empty, select all
  if(state.selectedCats.size === 0){
    cats.forEach(c => state.selectedCats.add(c));
  }else{
    // remove categories that no longer exist
    for(const c of [...state.selectedCats]){
      if(!cats.includes(c)) state.selectedCats.delete(c);
    }
    // if selection became empty, select all
    if(state.selectedCats.size === 0){
      cats.forEach(c => state.selectedCats.add(c));
    }
  }

  for(const cat of cats){
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.dataset.cat = cat;
    const ccol = categoryColor(cat);
    chip.innerHTML = `<span class="dot" style="background:${ccol}; box-shadow:0 0 0 3px ${hexToRgba("#ffffff",0.06)}"></span><span>${escapeHtml(cat)}</span>`;
    chip.classList.toggle("off", !state.selectedCats.has(cat));
    chip.addEventListener("click", () => {
      if(state.selectedCats.has(cat)) state.selectedCats.delete(cat);
      else state.selectedCats.add(cat);
      chip.classList.toggle("off", !state.selectedCats.has(cat));
      apply();
    });
    root.appendChild(chip);
  }
}

function filteredPosters(){
  const nowMin = getNowMin();
  const q = state.q.trim().toLowerCase();

  let arr = posters.map(normalizePoster).filter(p => {
    if(state.selectedCats.size>0 && !state.selectedCats.has(p.category)) return false;

    if(q){
      const hay = `${p.title} ${p.presenter} ${p.board}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }

    if(!intersectsRangePoster(p, state.fromMin, state.toMin)) return false;
    if(state.onlyNow && !isActivePoster(p, nowMin)) return false;

    return true;
  });

  // sort: active now first, then next soonest, then board
  arr.sort((a,b) => {
    const aAct = isActivePoster(a, nowMin) ? 0 : 1;
    const bAct = isActivePoster(b, nowMin) ? 0 : 1;
    if(aAct !== bAct) return aAct - bAct;

    const aNext = nextSlotOfPoster(a, nowMin);
    const bNext = nextSlotOfPoster(b, nowMin);
    const aT = aNext ? timeToMin(aNext.start) : (a.slots[0] ? timeToMin(a.slots[0].start) : 99999);
    const bT = bNext ? timeToMin(bNext.start) : (b.slots[0] ? timeToMin(b.slots[0].start) : 99999);
    if(aT !== bT) return aT - bT;

    return String(a.board).localeCompare(String(b.board));
  });

  $("#countText").textContent = `${arr.length} / ${posters.length} 件`;
  return arr;
}

function statusTextForPoster(p, nowMin){
  const pp = normalizePoster(p);
  const active = activeSlotOfPoster(pp, nowMin);
  if(active){
    const endMin = timeToMin(active.end);
    const remain = Math.max(0, endMin - nowMin);
    return { cls: "statusText active", text: `発表中 残り${remain}分` };
  }
  const next = nextSlotOfPoster(pp, nowMin);
  if(next){
    const startMin = timeToMin(next.start);
    const mins = Math.max(0, startMin - nowMin);
    return { cls: "statusText soon", text: `${mins}分後に発表` };
  }
  if(pp.slots.length===0){
    return { cls: "statusText", text: "時間未入力" };
  }
  return { cls: "statusText", text: "全発表終了" };
}

function renderTimeTagsHtml(slots){
  if(!slots || slots.length===0) return `<span style="color:#9ca3af;">時間未入力</span>`;
  return slots.map((sl, i) => {
    const c = slotColorByIndex(i);
    const label = `${sl.start}–${sl.end}`;
    return `
      <span class="timeTag"
        style="border-color:${c}; background:${hexToRgba(c,0.12)};">
        ${escapeHtml(label)}
      </span>
    `;
  }).join("");
}

function renderPosterTimeline(p, nowMin){
  const pp = normalizePoster(p);
  const minV = SESSION_START_MIN;
  const maxV = SESSION_END_MIN;
  const span = maxV - minV;

  const wrap = document.createElement("div");
  wrap.className = "pTimeline" + (state.timelineOn ? " on" : "");
  wrap.innerHTML = `
    <div class="pTimelineTop">
      <div class="small">タイムライン</div>
      <div class="range">${SESSION_START}–${SESSION_END}</div>
    </div>
    <div class="pTrack" style="height:34px;"></div>
  `;

  const track = $(".pTrack", wrap);

  // now mark
  if(nowMin>=minV && nowMin<=maxV){
    const nowX = ((nowMin-minV)/span)*100;
    const mark = document.createElement("div");
    mark.className = "pNowMark";
    mark.style.left = `${nowX}%`;
    track.appendChild(mark);
  }

  // lanes if overlap
  const {laneCount, placed} = computeLanes(pp.slots);
  const laneGap = 14;
  const baseTop = 10;
  const neededH = Math.max(34, baseTop + laneCount*laneGap);
  track.style.height = `${neededH}px`;

  placed.forEach(({slot, lane}) => {
    const s = slot.s, e = slot.e;
    const x1 = ((s - minV)/span)*100;
    const x2 = ((e - minV)/span)*100;

    const c = slotColorByIndex(slot.idx);

    const bar = document.createElement("div");
    bar.className = "pBar";
    bar.style.left = `${x1}%`;
    bar.style.width = `${Math.max(1, x2-x1)}%`;
    bar.style.top = `${baseTop + lane*laneGap}px`;

    bar.style.borderColor = c;
    bar.style.background = hexToRgba(c, 0.22);

    if(nowMin >= s && nowMin < e) bar.classList.add("active");
    track.appendChild(bar);
  });

  return wrap;
}

function renderList(items, nowMin){
  const root = $("#viewList");
  root.innerHTML = "";

  if(items.length===0){
    const e = document.createElement("div");
    e.className = "item";
    e.innerHTML = `<p class="title">条件に一致する発表がありません。</p><div class="meta">カテゴリや検索条件を調整してください。</div>`;
    root.appendChild(e);
    return;
  }

  for(const p of items){
    const isAct = isActivePoster(p, nowMin);
    const st = statusTextForPoster(p, nowMin);
    const catCol = categoryColor(p.category);

    const el = document.createElement("div");
    el.className = "item" + (isAct ? " active" : "");

    el.innerHTML = `
      <div class="itemTop">
        <div class="leftBlock">
          <div class="line1">
            <span class="board">${escapeHtml(p.board)}</span>
            <span class="presenterRow">
              <span class="presenter">${escapeHtml(p.presenter)}</span>
              <span class="catMini" data-cat="${escapeHtml(p.category)}">
                <span class="dot" style="background:${catCol};"></span><span>${escapeHtml(p.category)}</span>
              </span>
            </span>
          </div>
          <p class="title">${escapeHtml(p.title)}</p>

          <!-- NEW: status under title, right aligned -->
          <div class="statusBelow">
            <div class="${st.cls}">${escapeHtml(st.text)}</div>
          </div>
        </div>
      </div>

      <div class="meta">
        <span>時間：</span>
        <span class="timeTags">${renderTimeTagsHtml(p.slots)}</span>
      </div>
    `;

    el.appendChild(renderPosterTimeline(p, nowMin));
    root.appendChild(el);
  }
}

function syncJsonArea(){
  $("#jsonArea").value = JSON.stringify(posters.map(normalizePoster), null, 2);
}
function applyJson(){
  try{
    const obj = JSON.parse($("#jsonArea").value);
    if(!Array.isArray(obj)) throw new Error("JSONは配列（[]）である必要があります。");
    posters = obj.map(p => {
      if(!p.title || !p.category || !p.board) throw new Error("各要素に title/category/board が必要です。");
      return normalizePoster(p);
    });
    rebuildCategoryChips();
    apply();
  }catch(e){
    alert("反映できませんでした：\n" + e.message);
  }
}
function demoFillTimes(){
  function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
  posters = posters.map(normalizePoster).map((p, idx) => {
    const slots = [];
    const makeSlot = (base) => {
      const start = base + randInt(0, 55);
      const dur = randInt(8, 16);
      const s = Math.max(SESSION_START_MIN, Math.min(start, SESSION_END_MIN-5));
      const e = Math.min(SESSION_END_MIN, s + dur);
      return {start: minToTime(s), end: minToTime(e)};
    };
    const count = (idx % 3 === 0) ? 2 : 1;
    const base1 = SESSION_START_MIN + (idx*3) % (SESSION_END_MIN-SESSION_START_MIN-20);
    slots.push(makeSlot(base1));
    if(count===2){
      const base2 = SESSION_START_MIN + (idx*7) % (SESSION_END_MIN-SESSION_START_MIN-20);
      slots.push(makeSlot(base2));
    }
    slots.sort((a,b) => timeToMin(a.start)-timeToMin(b.start));
    return {...p, slots};
  });
  rebuildCategoryChips();
  syncJsonArea();
  apply();
}

function apply(){
  const nowMin = getNowMin();
  updateClock();

  const items = filteredPosters();
  renderList(items, nowMin);
}

function wire(){
  $("#sessionText").textContent = `${SESSION_START}–${SESSION_END}`;

  $("#q").addEventListener("input", (e) => { state.q = e.target.value; apply(); });
  $("#clearSearchBtn").addEventListener("click", () => { $("#q").value=""; state.q=""; apply(); });

  $("#onlyNowBtn").addEventListener("click", () => setOnlyNow(!state.onlyNow));
  $("#timelineToggleBtn").addEventListener("click", () => setTimeline(!state.timelineOn));

  $("#fromTime").addEventListener("input", () => { readAdminFilters(); apply(); });
  $("#toTime").addEventListener("input", () => { readAdminFilters(); apply(); });
  $("#onlyNowCheckbox").addEventListener("change", (e) => setOnlyNow(e.target.checked));

  $("#resetBtn").addEventListener("click", () => {
    state.q = ""; $("#q").value="";
    state.selectedCats.clear(); // will be re-selected in rebuild
    $("#fromTime").value=""; $("#toTime").value="";
    state.fromMin=null; state.toMin=null;
    setOnlyNow(false);
    rebuildCategoryChips();
    apply();
  });

  $("#setManualBtn").addEventListener("click", () => {
    const t = $("#manualTime").value;
    const m = timeToMin(t);
    if(m===null){ alert("手動時刻（HH:MM）を入力してください"); return; }
    manualNowMin = m;
    apply();
  });
  $("#clearManualBtn").addEventListener("click", () => { manualNowMin = null; apply(); });

  $("#applyJsonBtn").addEventListener("click", applyJson);
  $("#reloadJsonBtn").addEventListener("click", syncJsonArea);
  $("#exportBtn").addEventListener("click", () => {
    const text = JSON.stringify(posters.map(normalizePoster), null, 2);
    navigator.clipboard?.writeText(text).then(() => alert("JSONをクリップボードにコピーしました。"))
      .catch(() => { syncJsonArea(); alert("コピーに失敗したため、JSON欄から手動でコピーしてください。"); });
  });

  $("#demoFillBtn").addEventListener("click", demoFillTimes);

  $("#scrollTopBtn").addEventListener("click", () => window.scrollTo({top:0,behavior:"smooth"}));
  $("#scrollAdminBtn").addEventListener("click", () => $("#admin").scrollIntoView({behavior:"smooth",block:"start"}));

  syncJsonArea();
  readAdminFilters();
  rebuildCategoryChips();
  updateClock();
  apply();
}

function startTicker(){
  setInterval(() => {
    if(manualNowMin===null) apply();
    else updateClock();
  }, 30 * 1000);
}

async function init(){
  try{
    posters = await loadPosters();
    wire();
    startTicker();
  }catch(e){
    console.error(e);
    alert("データ読み込みに失敗しました。ローカルで開く場合は簡易サーバー経由で開いてください。\n" + e.message);
  }
}

init();
