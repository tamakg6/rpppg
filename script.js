// ===================== 定数・データ =====================
const GD = JSON.parse(document.getElementById('game-data').textContent);
const SAVE_KEY = 'whipper_v7';
let uidC = 1;
let autoIv = null, clockIv = null;

// ===================== ユーティリティ =====================
const fW = id => GD.weapons.find(w => w.id === id);
const fS = id => GD.shields.find(s => s.id === id);
const fR = id => GD.rings.find(r => r.id === id);
function fDef(cat, id) {
  return cat === 'weapon' ? fW(id) : cat === 'shield' ? fS(id) : fR(id);
}
function catLbl(cat) { return cat === 'weapon' ? '武器' : cat === 'shield' ? '盾' : '指輪'; }
function fmt(n) { return Math.round(n).toLocaleString(); }

// ===================== ダメージ計算（仕様書準拠） =====================
function calcDmg(atk, def, forceK = false) {
  const prov = Math.max(0, Math.round(atk - def));
  const dmg = prov + Math.floor(Math.random() * 6);
  const isK = forceK || Math.random() < 0.05;
  return { dmg: isK ? dmg * 2 : dmg, isK };
}

// ===================== レアリティ =====================
function rOf(c) {
  if (c >= 250) return { key: 'red',    label: '赤', cls: 'rr', expGain: 8 };
  if (c >= 150) return { key: 'yellow', label: '黄', cls: 'ry', expGain: 4 };
  if (c >= 50)  return { key: 'blue',   label: '青', cls: 'rb', expGain: 2 };
  return               { key: 'white',  label: '白', cls: 'rw', expGain: 1 };
}

// ===================== 侵食度 =====================
function rollCorr(wl) {
  if (wl <= 0) return 0;
  const bias = Math.min(0.6, wl * 0.08);
  return Math.round(Math.pow(Math.random(), 1 - bias) * 300);
}
function corrBonus(item) {
  if (item.category === 'ring') return 0;
  const x = item.analysisLv >= 10 && item.corruption >= 250 ? 20 : 10;
  return item.corruption * x;
}

// ===================== 解析EXP（1,2,4,8,16,32,40,48,56,64,64...） =====================
function expForLv(lv) {
  const t = [0, 1, 2, 4, 8, 16, 32, 40, 48, 56, 64];
  return t[lv] ?? 64;
}

// ===================== 限界突破 =====================
function activeEff(item) {
  return GD.breakthroughLines.filter(l => item.analysisLv >= l.analysisLv && item.corruption >= l.corruption);
}
function capBonus(item) {
  let b = 0;
  activeEff(item).forEach(e => {
    const k = item.category === 'shield' ? e.effectShield : e.effectWeapon;
    const m = k?.match(/強化上限アップ\+(\d+)/);
    if (m) b += parseInt(m[1]);
  });
  return b;
}

// ===================== 状態 =====================
function defState() {
  return {
    worldLevel: 0, bp: 0,
    permanentBoosts: { hp: 0, atk: 0, def: 0, spd: 0, luk: 0 },
    rareUnlocked: {},
    materials: {}, inventory: [],
    equipped: { weapon: null, shield: null, ring: null },
    clearedDungeons: {},
    dungeonLogs: [],
    rewards: [],            // 獲得済み報酬リスト（"アイテム図鑑"など）
    exploreSnap: null,
    exploreTs: null,
    adventureStats: { totalBattles: 0, totalWins: 0, totalDeaths: 0, totalDrops: 0 },
  };
}
let state = defState();
let curExp = null;

// ===================== セーブ／ロード =====================
function save() {
  try {
    if (curExp && !curExp.finished) {
      state.exploreSnap = JSON.parse(JSON.stringify(curExp));
      state.exploreTs = Date.now();
    } else {
      state.exploreSnap = null; state.exploreTs = null;
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify({ state, uidC }));
  } catch (e) { console.warn('save', e); }
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    state = d.state;
    uidC = d.uidC || 1;
    if (!state.rewards) state.rewards = [];
    if (!state.adventureStats) state.adventureStats = { totalBattles: 0, totalWins: 0, totalDeaths: 0, totalDrops: 0 };
    return true;
  } catch (e) { console.warn('load', e); return false; }
}
function resetGame() {
  if (!confirm('セーブデータを削除してリセットしますか？')) return;
  localStorage.removeItem(SAVE_KEY); location.reload();
}

// ===================== ダンジョン解放 =====================
function unlocked(id) {
  const ids = GD.dungeons.map(d => d.id).sort((a, b) => a - b);
  const idx = ids.indexOf(id);
  if (idx <= 0) return true;
  return !!state.clearedDungeons[ids[idx - 1]];
}
function allDone() { return GD.dungeons.every(d => state.clearedDungeons[d.id]); }
function hasReward(r) { return state.rewards.includes(r); }

// ===================== 素材 =====================
function addMat(id, n) { state.materials[id] = (state.materials[id] || 0) + n; }

// ===================== 能力値テーブル =====================
const AB = {
  '耐久':       [5,10,15,25,40,65,105,170,275,445,500,750,1000,1500,2000,2500,3000,4000,5000,6000],
  '腕力':       [5,10,15,25,40,65,105,170,275,445,500,750,1000,1500,2000,2500,3000,4000,5000,6000],
  '頑丈':       [5,10,15,25,40,65,105,170,275,445,500,750,1000,1500,2000,2500,3000,4000,5000,6000],
  '機敏':       [2,5,10,15,20,30,45,70,95,135,175,215,270,325,380,435,490,545,600,655],
  '幸運':       [1,2,3,4,5,6,7,8],
  '体力の鍛錬': [2,4,7,11,16,25,35,50,60,70,85,95,120,150,180,210,240,270,300,330],
  '力の鍛錬':   [1,2,3,5,8,13,18,25,35,50,70,95,120,150,180,210,240,270,300,330],
  '守りの鍛錬': [1,2,3,5,8,13,18,25,35,50,70,95,120,150,180,210,240,270,300,330],
};
function abVal(name, lv) {
  const t = AB[name]; if (!t) return 0;
  return t[Math.min(lv - 1, t.length - 1)] || 0;
}

// LUKによる能力個数（0〜3個、LUKが高いほど多い傾向）
function abilitySlots(luk) {
  const r = Math.random() * 100;
  // LUK0→ほぼ0個、LUK20以上→ほぼ3個
  const bias = Math.min(100, luk * 5);
  if (r < Math.max(5, 40 - bias)) return 0;
  if (r < Math.max(20, 65 - bias / 2)) return 1;
  if (r < Math.max(50, 85 - bias / 4)) return 2;
  return 3;
}

function rollAbilities(corruption, playerLuk) {
  const slots = abilitySlots(playerLuk || 1);
  const abilities = [];
  const canRare = corruption >= 150;
  for (let i = 0; i < slots; i++) {
    if (i === 0 && canRare && Math.random() < 0.1) {
      abilities.push({ name: GD.rareAbilities[Math.floor(Math.random() * GD.rareAbilities.length)], lv: 1, rare: true });
    } else {
      abilities.push({ name: GD.abilityPool[Math.floor(Math.random() * GD.abilityPool.length)], lv: 1 + Math.floor(Math.random() * 8), rare: false });
    }
  }
  return abilities;
}

function mkItem(cat, defId, corruption, luk) {
  return {
    uid: 'i' + (uidC++), category: cat, defId,
    enhanceLv: 0, corruption,
    abilities: rollAbilities(corruption, luk),
    analysisLv: 0, analysisExp: 0, bpAt: 0, justEv: false,
  };
}

// ===================== 強化 =====================
function capFor(item) {
  const def = fDef(item.category, item.defId);
  return (def?.enhanceCap || 0) + capBonus(item);
}
function enhance(uid, matId, cnt) {
  const item = state.inventory.find(it => it.uid === uid);
  if (!item || item.category === 'ring') return false;
  const mat = GD.enhanceMaterials.find(m => m.id === matId);
  const have = state.materials[matId] || 0;
  if (!mat || have < cnt || cnt <= 0) return false;
  const cap = capFor(item);
  const nv = Math.min(cap, item.enhanceLv + mat.value * cnt);
  if (nv === item.enhanceLv) return false;
  state.materials[matId] -= cnt;
  item.enhanceLv = nv;
  const ev = tryEvolve(item);
  save(); return { evolved: ev };
}
function tryEvolve(item) {
  const def = fDef(item.category, item.defId);
  if (!def?.evolvesTo || item.enhanceLv < capFor(item)) return false;
  const carry = item.enhanceLv - capFor(item);
  item.defId = def.evolvesTo;
  item.enhanceLv = Math.max(0, carry);
  item.analysisLv = 0; item.analysisExp = 0; item.bpAt = 0;
  item.justEv = true; return true;
}

// ===================== 解析（素材消費なし・解析値を直接加算） =====================
function gainExp(item, amount) {
  item.analysisExp += amount;
  let lv = false;
  while (true) {
    const need = expForLv(item.analysisLv + 1);
    if (item.analysisExp >= need) {
      item.analysisExp -= need; item.analysisLv++; lv = true;
      if (item.analysisLv % 5 === 0 && item.analysisLv > item.bpAt) {
        state.bp++; item.bpAt = item.analysisLv;
        toast(`解析Lv${item.analysisLv}達成！BP+1（合計${state.bp}）`);
      }
    } else break;
  }
  return lv;
}

// ===================== BP =====================
function spendBP(key) {
  if (state.bp <= 0) return false;
  state.bp--; state.permanentBoosts[key] = (state.permanentBoosts[key] || 0) + 1;
  save(); return true;
}
function unlockRare(name) {
  const cost = GD.rareAbilityUnlockCost;
  if (state.bp < cost || state.rareUnlocked[name]) return false;
  state.bp -= cost; state.rareUnlocked[name] = true; save(); return true;
}
function respecAll() {
  const ss = Object.values(state.permanentBoosts).reduce((a, b) => a + b, 0);
  const rs = Object.values(state.rareUnlocked).filter(Boolean).length * GD.rareAbilityUnlockCost;
  if (ss + rs <= 0) return false;
  state.bp += ss + rs;
  Object.keys(state.permanentBoosts).forEach(k => state.permanentBoosts[k] = 0);
  Object.keys(state.rareUnlocked).forEach(k => state.rareUnlocked[k] = false);
  save(); return true;
}

// ===================== ステータス計算 =====================
function getEq(cat) {
  const uid = state.equipped[cat];
  return uid ? state.inventory.find(it => it.uid === uid) : null;
}
function calcStats() {
  const bs = GD.baseStats;
  let hp1 = bs.hp, str1 = bs.str, vit1 = bs.vit, spd1 = bs.spd, luk1 = bs.luk;
  let hpup = GD.growthStats.hp, strup = GD.growthStats.str, vitup = GD.growthStats.vit;
  let wAtk = 0, sDef = 0, hpBoost = 1, aM = 1, dM = 1;
  const rF = {};
  const pb = state.permanentBoosts;
  GD.permanentBoostOptions.forEach(o => {
    const m = { hp: 'hp', atk: 'str', def: 'vit', spd: 'spd', luk: 'luk' };
    const s = m[o.key];
    if (s === 'hp') hp1 += pb[o.key] * o.perPoint;
    else if (s === 'str') str1 += pb[o.key] * o.perPoint;
    else if (s === 'vit') vit1 += pb[o.key] * o.perPoint;
    else if (s === 'spd') spd1 += pb[o.key] * o.perPoint;
    else if (s === 'luk') luk1 += pb[o.key] * o.perPoint;
  });
  Object.keys(state.rareUnlocked).forEach(n => { if (state.rareUnlocked[n]) rF[n] = true; });
  ['weapon', 'shield', 'ring'].forEach(cat => {
    const item = getEq(cat); if (!item) return;
    const def = fDef(cat, item.defId); if (!def) return;
    if (def.lv1) { hp1 += def.lv1.hp || 0; str1 += def.lv1.str || 0; vit1 += def.lv1.vit || 0; spd1 += def.lv1.spd || 0; }
    if (def.lvup) { strup += def.lvup.str || 0; vitup += def.lvup.vit || 0; }
    if (cat === 'weapon') wAtk = (def.atk || 0) + item.enhanceLv + corrBonus(item);
    if (cat === 'shield') sDef = (def.def || 0) + item.enhanceLv + corrBonus(item);
    item.abilities.forEach(ab => {
      if (ab.rare) { rF[ab.name] = true; return; }
      switch (ab.name) {
        case '耐久': hp1 += abVal('耐久', ab.lv); break;
        case '腕力': str1 += abVal('腕力', ab.lv); break;
        case '頑丈': vit1 += abVal('頑丈', ab.lv); break;
        case '機敏': spd1 += abVal('機敏', ab.lv); break;
        case '幸運': luk1 += abVal('幸運', ab.lv); break;
        case '体力の鍛錬': hpup += abVal('体力の鍛錬', ab.lv); break;
        case '力の鍛錬': strup += abVal('力の鍛錬', ab.lv); break;
        case '守りの鍛錬': vitup += abVal('守りの鍛錬', ab.lv); break;
      }
    });
    activeEff(item).forEach(e => {
      const eff = cat === 'shield' ? e.effectShield : e.effectWeapon; if (!eff) return;
      if (eff.includes('HPブースト×1.3')) hpBoost = Math.max(hpBoost, 1.3);
      if (eff.includes('攻撃力ブースト×1.3')) aM = Math.max(aM, 1.3);
      if (eff.includes('守備力ブースト×1.3')) dM = Math.max(dM, 1.3);
    });
  });
  return {
    hp1, str1, vit1, spd1, luk1, hpup, strup, vitup, wAtk, sDef, rF,
    totalAtk: Math.round(wAtk * aM + str1),
    totalDef: Math.round(sDef * dM + vit1),
    totalHp: Math.round(hp1 * hpBoost),
  };
}
function rating(s) { return Math.round(s.totalAtk * 2 + s.totalDef * 2 + s.totalHp * .5); }

// Lv N時のHP/ATK/DEF計算
function statsAtLv(baseStats, lv) {
  const hp = baseStats.hp1 + baseStats.hpup * (lv - 1);
  const atk = baseStats.totalAtk + baseStats.strup * (lv - 1);
  const def = baseStats.totalDef + baseStats.vitup * (lv - 1);
  return { hp: Math.round(hp), atk: Math.round(atk), def: Math.round(def) };
}

// ===================== 危険度 =====================
function dangerOf(dngId) {
  const s = calcStats();
  const pp = s.totalAtk + s.totalDef + s.totalHp * .3;
  const boss = GD.monsters.find(m => m.dungeon === dngId && m.kind === 'ボス');
  if (!boss) return { label: '？', cls: 'dc' };
  const wm = 1 + state.worldLevel * .5;
  const bp = boss.atk * wm + boss.def * wm + boss.hp * wm * .3;
  const r = pp / bp;
  if (r >= 2.0) return { label: '安全', cls: 'ds' };
  if (r >= 1.2) return { label: '注意', cls: 'dc' };
  if (r >= 0.7) return { label: '危険', cls: 'dd' };
  return { label: '自殺行為', cls: 'dsu' };
}

// ===================== 探索ロジック =====================
function startExplore(dngId) {
  const d = GD.dungeons.find(x => x.id === dngId);
  curExp = {
    dungeonId: dngId, dungeonName: d.name, floors: d.floors,
    secsPerFloor: d.secsPerFloor,
    floorIndex: 1, battles: [], allDrops: [],
    finished: false, dead: false, cleared: false, retreated: false,
    startTime: new Date().toISOString(),
  };
  state.exploreTs = Date.now();
  document.getElementById('explorePanel').classList.remove('hidden');
  document.getElementById('dngListCard').classList.add('hidden');
  document.getElementById('expDngName').textContent = d.name;
  document.getElementById('curExpLog').innerHTML = '';
  save(); startTimer(); updateExpUI();
}
function getEnemy(dngId, floor, totalFloors) {
  const pool = GD.monsters.filter(m => m.dungeon === dngId);
  const isBoss = floor >= totalFloors;
  const cands = pool.filter(m => isBoss ? m.kind === 'ボス' : m.kind === '雑魚');
  return cands.length ? cands[Math.floor(Math.random() * cands.length)] : pool[0];
}
function runFloor() {
  const ex = curExp; if (!ex || ex.finished) return;
  const wm = 1 + state.worldLevel * .5;
  const ed = getEnemy(ex.dungeonId, ex.floorIndex, ex.floors);
  if (!ed) { ex.floorIndex++; return; }
  const enemy = { name: ed.name, hp: Math.round(ed.hp * wm), atk: Math.round(ed.atk * wm), def: Math.round(ed.def * wm), spd: ed.spd };
  const ps = calcStats();
  let eHp = enemy.hp, pHp = ps.totalHp;
  const first = ps.rF['先制'] || ps.spd1 >= enemy.spd;
  const actions = [];

  // 開始時ステータスをログに記録
  const openingLog = {
    type: 'opening',
    playerName: '冒険者',
    playerAtk: ps.totalAtk, playerDef: ps.totalDef, playerSpd: ps.spd1, playerHp: pHp,
    enemyName: enemy.name,
    enemyAtk: enemy.atk, enemyDef: enemy.def, enemySpd: enemy.spd, enemyHp: enemy.hp,
    first: first ? '冒険者' : enemy.name,
  };
  actions.push(openingLog);

  function pAtk() {
    const fc = !!ps.rF['一撃'];
    const { dmg, isK } = calcDmg(ps.totalAtk, enemy.def, fc);
    eHp -= dmg;
    actions.push({ type: 'atk', side: 'p', name: '冒険者', dmg, isK, second: false, targetHp: Math.max(0, eHp), totalHp: enemy.hp });
    if (ps.rF['二撃']) {
      const { dmg: d2, isK: k2 } = calcDmg(ps.totalAtk, enemy.def, fc);
      eHp -= d2;
      actions.push({ type: 'atk', side: 'p', name: '冒険者', dmg: d2, isK: k2, second: true, targetHp: Math.max(0, eHp), totalHp: enemy.hp });
    }
  }
  function eAtk() {
    const { dmg, isK } = calcDmg(enemy.atk, ps.totalDef);
    pHp -= dmg;
    actions.push({ type: 'atk', side: 'e', name: enemy.name, dmg, isK, second: false, targetHp: Math.max(0, pHp), totalHp: ps.totalHp });
  }

  let r = 0;
  while (eHp > 0 && pHp > 0 && r < 200) {
    if (first) { pAtk(); if (eHp <= 0) break; eAtk(); }
    else { eAtk(); if (pHp <= 0) break; pAtk(); }
    r++;
  }

  const battle = { floor: ex.floorIndex, enemyName: enemy.name, actions, drops: [], result: null };
  state.adventureStats.totalBattles++;

  if (pHp <= 0) {
    battle.result = 'dead'; ex.dead = true; ex.finished = true;
    state.adventureStats.totalDeaths++;
  } else {
    battle.result = 'win';
    state.adventureStats.totalWins++;
    // ドロップ
    const cands = [ed.drop1, ed.drop2].filter(Boolean);
    if (cands.length && Math.random() < 0.6) {
      const name = cands[Math.floor(Math.random() * cands.length)];
      const w = GD.weapons.find(x => x.name === name);
      const s = GD.shields.find(x => x.name === name);
      const rg = GD.rings.find(x => x.name === name);
      if (w || s || rg) {
        const cat = w ? 'weapon' : s ? 'shield' : 'ring';
        const def = w || s || rg;
        const corr = rollCorr(state.worldLevel);
        state.inventory.push(mkItem(cat, def.id, corr, ps.luk1));
        const drop = { name, category: cat, corruption: corr };
        battle.drops.push(drop); ex.allDrops.push(drop);
        state.adventureStats.totalDrops++;
      }
    }
    if (Math.random() < 0.25) {
      const mat = GD.enhanceMaterials[Math.floor(Math.random() * 3)];
      const cnt = 1 + Math.floor(Math.random() * 2);
      addMat(mat.id, cnt);
      const drop = { name: mat.name + ' ×' + cnt, category: 'material' };
      battle.drops.push(drop); ex.allDrops.push(drop);
    }
    ex.floorIndex++;
    if (ex.floorIndex > ex.floors) {
      ex.finished = true; ex.cleared = true;
      state.clearedDungeons[ex.dungeonId] = true;
      // 報酬付与
      const dngDef = GD.dungeons.find(d => d.id === ex.dungeonId);
      if (dngDef?.reward && !hasReward(dngDef.reward)) {
        state.rewards.push(dngDef.reward);
        toast(`🎁 ${dngDef.reward} を入手した！`);
      }
      if (allDone()) toast('全ダンジョン制覇！瘴気濃度を上げられます。');
    }
  }

  ex.battles.push(battle);
  appendBattleLog(battle);
  if (ex.finished) {
    stopTimer(); state.exploreSnap = null; state.exploreTs = null;
    finalizeLog(ex); save();
    if (ex.cleared) renderDngList();
    document.getElementById('dngListCard').classList.remove('hidden');
  }
}
function retreat() {
  if (!curExp || curExp.finished) return;
  stopTimer(); curExp.finished = true; curExp.retreated = true;
  state.exploreSnap = null; state.exploreTs = null;
  finalizeLog(curExp); save(); updateExpUI();
  document.getElementById('dngListCard').classList.remove('hidden');
}
function finalizeLog(ex) {
  const e = {
    dungeonId: ex.dungeonId, dungeonName: ex.dungeonName,
    startTime: ex.startTime, endTime: new Date().toISOString(),
    floorsReached: Math.min(ex.floorIndex - (ex.cleared ? 1 : 0), ex.floors),
    totalFloors: ex.floors, battles: ex.battles, allDrops: ex.allDrops,
    result: ex.dead ? 'dead' : ex.cleared ? 'cleared' : ex.retreated ? 'retreated' : 'incomplete',
  };
  state.dungeonLogs.unshift(e);
  if (state.dungeonLogs.length > 10) state.dungeonLogs.length = 10;
}

// ===================== タイマー =====================
function startTimer() {
  stopTimer();
  const secs = curExp?.secsPerFloor || 300;
  autoIv = setInterval(() => {
    if (!curExp || curExp.finished) { stopTimer(); return; }
    const now = Date.now();
    const last = state.exploreTs || now;
    const due = Math.floor((now - last) / 1000 / secs);
    if (due >= 1) {
      state.exploreTs = last + due * secs * 1000;
      for (let i = 0; i < due; i++) { if (curExp.finished) break; runFloor(); }
      updateExpUI();
    }
  }, 1000);
  clockIv = setInterval(updateReturnTime, 1000);
}
function stopTimer() {
  if (autoIv) { clearInterval(autoIv); autoIv = null; }
  if (clockIv) { clearInterval(clockIv); clockIv = null; }
}
function updateReturnTime() {
  const ex = curExp; const el = document.getElementById('expReturnTime');
  if (!el) return;
  if (!ex || ex.finished) { el.textContent = ''; return; }
  const secs = ex.secsPerFloor || 300;
  const rem = Math.max(0, (ex.floors - ex.floorIndex + 1) * secs);
  const at = new Date(Date.now() + rem * 1000);
  const hhmm = at.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  el.textContent = `帰還予定 ${hhmm}（残り${Math.ceil(rem / 60)}分）`;
}
function resumeOffline() {
  if (!state.exploreSnap || !state.exploreTs) return;
  const snap = state.exploreSnap; if (snap.finished) return;
  curExp = snap;
  const secs = snap.secsPerFloor || 300;
  const due = Math.floor((Date.now() - state.exploreTs) / 1000 / secs);
  document.getElementById('explorePanel').classList.remove('hidden');
  document.getElementById('dngListCard').classList.add('hidden');
  document.getElementById('expDngName').textContent = snap.dungeonName;
  document.getElementById('curExpLog').innerHTML = '';
  snap.battles.forEach(b => appendBattleLog(b));
  if (due >= 1) {
    toast(`オフライン中に${due}階分進みました`);
    state.exploreTs = state.exploreTs + due * secs * 1000;
    for (let i = 0; i < due; i++) { if (curExp.finished) break; runFloor(); }
  }
  if (!curExp.finished) startTimer();
  else document.getElementById('dngListCard').classList.remove('hidden');
  updateExpUI();
}
function updateExpUI() {
  const ex = curExp; if (!ex) return;
  const pct = Math.min(100, (ex.floorIndex / ex.floors) * 100);
  document.getElementById('expProg').style.width = pct + '%';
  document.getElementById('expFloor').textContent = `${Math.min(ex.floorIndex, ex.floors)}/${ex.floors}階`;
  let txt = `${ex.floorIndex}階を探索中`;
  if (ex.dead) txt = '全滅…この探索で得たアイテムをすべて失った';
  else if (ex.retreated) txt = '途中帰還した';
  else if (ex.cleared) txt = 'ボスを撃破！次のダンジョンが解放された';
  else if (ex.finished) txt = '探索終了';
  document.getElementById('expStatus').textContent = txt;
  document.getElementById('btnRetreat').disabled = ex.finished;
  updateReturnTime(); renderTopBar();
}

// ===================== バトルログUI =====================
function appendBattleLog(battle) {
  const el = document.getElementById('curExpLog'); if (!el) return;
  const div = document.createElement('div'); div.className = 'log-entry';
  const icon = battle.result === 'dead' ? '💀' : battle.floor >= (curExp?.floors || 99) ? '👑' : '⚔';
  const drops = battle.drops.filter(d => d.category !== 'material').map(d => {
    const r = rOf(d.corruption); return `<span class="${r.cls}">★${d.name}</span>`;
  }).join(' ');
  div.innerHTML = `<span class="t">${icon} ${battle.floor}F</span>${battle.enemyName}を${battle.result === 'dead' ? '<span style="color:var(--danger)">倒せなかった</span>' : '倒した'} ${drops}`;
  div.onclick = () => showBattleDetail(battle);
  el.insertBefore(div, el.firstChild);
}

// ===================== DUNGEON画面 =====================
function renderDngList() {
  const area = document.getElementById('wlArea');
  const cl = allDone();
  area.innerHTML = `<div class="card"><div class="row">
    <span>瘴気濃度：<b style="color:var(--gold)">${state.worldLevel}</b></span>
    ${cl ? `<button class="sm gold" id="btnUpWL">瘴気濃度を上げる</button>` : `<span class="dim">全制覇で上昇可</span>`}
    <button class="sm sec" onclick="resetGame()">リセット</button>
  </div></div>`;
  document.getElementById('btnUpWL')?.addEventListener('click', () => {
    state.worldLevel++; state.clearedDungeons = {}; save(); renderDngList();
    toast(`瘴気濃度が${state.worldLevel}になった！`);
  });
  const el = document.getElementById('dngList'); el.innerHTML = '';
  GD.dungeons.slice().sort((a, b) => a.id - b.id).forEach(d => {
    if (!unlocked(d.id)) return;
    const dl = dangerOf(d.id); const isC = !!state.clearedDungeons[d.id];
    const inProg = curExp && !curExp.finished;
    const mins = Math.round(d.secsPerFloor / 60);
    const div = document.createElement('div'); div.className = 'dng-item';
    div.style.opacity = inProg ? '0.4' : '1';
    const rewardBadge = d.reward ? `<span class="reward-badge">🎁 ${d.reward}</span>` : '';
    div.innerHTML = `<div>
      <div style="font-weight:600;">${d.id}. ${d.name}${isC ? ' ✓' : ''} ${rewardBadge}</div>
      <div class="dim">全${d.floors}階 / 1階${mins}分 / 合計${mins * d.floors}分</div>
      ${d.hint ? `<div class="dim" style="font-size:11px;margin-top:2px;">${d.hint}</div>` : ''}
    </div>
    <span class="dl ${dl.cls}">${dl.label}</span>`;
    if (!inProg) div.onclick = () => startExplore(d.id);
    el.appendChild(div);
  });
}

// ===================== LOG画面 =====================
function renderLogList() {
  const el = document.getElementById('logList'); el.innerHTML = '';
  if (!(state.dungeonLogs || []).length) { el.innerHTML = '<p class="dim">まだ記録がありません。</p>'; return; }
  state.dungeonLogs.forEach(entry => {
    const div = document.createElement('div'); div.className = 'log-entry';
    const t = entry.startTime ? new Date(entry.startTime).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '--:--';
    const icon = entry.result === 'cleared' ? '👑' : entry.result === 'dead' ? '💀' : '🏃';
    const res = entry.result === 'cleared' ? `制覇（${entry.totalFloors}階）` : entry.result === 'dead' ? `全滅（${entry.floorsReached}/${entry.totalFloors}階）` : `撤退（${entry.floorsReached}/${entry.totalFloors}階）`;
    div.innerHTML = `<span class="t">${t}</span>${icon} ${entry.dungeonName} ${res}`;
    div.onclick = () => showExpDetail(entry);
    el.appendChild(div);
  });
}
function showExpDetail(entry) {
  const modal = document.getElementById('modalRoot');
  const bHtml = (entry.battles || []).map((b, i) => {
    const icon = b.result === 'dead' ? '💀' : b.floor >= entry.totalFloors ? '👑' : '⚔';
    const drops = b.drops.filter(d => d.category !== 'material').map(d => {
      const r = rOf(d.corruption); return `<span class="${r.cls}">★${d.name}[${r.label}]</span>`;
    }).join(' ');
    return `<div class="log-entry" data-bi="${i}">${icon} ${b.floor}F ${b.enemyName}を${b.result === 'dead' ? '<span style="color:var(--danger)">倒せなかった</span>' : '倒した'} ${drops}</div>`;
  }).join('');
  modal.innerHTML = `<div class="modal-overlay" id="expO">
    <div class="modal">
      <div class="mhdr"><h3 style="margin:0">${entry.dungeonName} 探索記録</h3><span class="cx" id="closeExp">✕</span></div>
      <div class="dim" style="margin-bottom:8px;">${entry.result === 'cleared' ? '👑制覇' : entry.result === 'dead' ? '💀全滅' : '🏃撤退'} ${entry.floorsReached}/${entry.totalFloors}階</div>
      ${bHtml}
    </div>
  </div>`;
  document.getElementById('closeExp').onclick = () => modal.innerHTML = '';
  document.getElementById('expO').onclick = e => { if (e.target.id === 'expO') modal.innerHTML = ''; };
  modal.querySelectorAll('[data-bi]').forEach(el => {
    el.onclick = e => { e.stopPropagation(); showBattleDetail(entry.battles[+el.dataset.bi]); };
  });
}
function showBattleDetail(battle) {
  const modal = document.getElementById('modalRoot');
  const aHtml = (battle.actions || []).map(a => {
    if (a.type === 'opening') {
      return `<div class="log-entry" style="background:var(--panel);border-color:var(--accent);">
        <div style="font-weight:600;">${a.playerName} と ${a.enemyName} が対峙した！</div>
        <div class="dim">${a.playerName} Lv?　ATK:${a.playerAtk}　DEF:${a.playerDef}　SPD:${a.playerSpd}　HP:${a.playerHp}</div>
        <div class="dim">vs ${a.enemyName}　ATK:${a.enemyAtk}　DEF:${a.enemyDef}　SPD:${a.enemySpd}　HP:${a.enemyHp}</div>
        <div style="color:var(--gold);font-size:12px;margin-top:4px;">⚡ ${a.first}が先攻だ！</div>
      </div>`;
    }
    if (a.side === 'p') {
      const tag = a.isK ? '会心の一撃！' : a.second ? '二撃目' : '';
      return `<div class="log-entry">⚔ 冒険者の攻撃${tag ? `（${tag}）` : ''}：${battle.enemyName}に<b>${a.dmg}</b>ダメージ
        <span class="dim">（${battle.enemyName} 残HP: ${a.targetHp}/${a.totalHp}）</span></div>`;
    }
    return `<div class="log-entry">${a.isK ? '💥 痛恨の一撃！' : '🛡 '}${battle.enemyName}の攻撃：冒険者に<b>${a.dmg}</b>ダメージ
      <span class="dim">（冒険者 残HP: ${a.targetHp}/${a.totalHp}）</span></div>`;
  }).join('');
  const dHtml = (battle.drops || []).map(d => {
    if (d.category === 'material') return `<div class="log-entry">🔧 ${d.name}を入手</div>`;
    const r = rOf(d.corruption);
    return `<div class="log-entry">★ ${catLbl(d.category)}「<span class="${r.cls}">${d.name}</span>」入手 [${r.label}] 侵食度${d.corruption}</div>`;
  }).join('') || '<div class="dim" style="padding:4px 8px">ドロップなし</div>';
  const res = battle.result === 'dead'
    ? `<div class="log-entry" style="color:var(--danger)">💀 全滅した…</div>`
    : `<div class="log-entry">✅ ${battle.enemyName}を倒した！</div>`;
  modal.innerHTML = `<div class="modal-overlay" id="btlO">
    <div class="modal ctr">
      <div class="mhdr"><h3 style="margin:0">${battle.floor}階 vs ${battle.enemyName}</h3><span class="cx" id="closeBtl">✕</span></div>
      ${aHtml}${res}${dHtml}
    </div>
  </div>`;
  document.getElementById('closeBtl').onclick = () => modal.innerHTML = '';
  document.getElementById('btlO').onclick = e => { if (e.target.id === 'btlO') modal.innerHTML = ''; };
}

// ===================== ITEM画面 =====================
let itemCat = 'weapon';
document.querySelectorAll('#itemTabs button').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('#itemTabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); itemCat = btn.dataset.cat; renderItemList();
  };
});
document.getElementById('btnOpenAnalysis').onclick = () => {
  if (!hasReward('アイテム図鑑')) { toast('アイテム図鑑を入手すると解析できるようになります（はじめの草むらをクリア）'); return; }
  openAnalysisScreen();
};
document.getElementById('btnOpenCollection').onclick = () => {
  if (!hasReward('アイテム図鑑')) { toast('アイテム図鑑を入手すると解析できるようになります（はじめの草むらをクリア）'); return; }
  openCollectionScreen();
};

function iName(item) { return fDef(item.category, item.defId)?.name || '???'; }
function renderItemCard(item) {
  const def = fDef(item.category, item.defId); if (!def) return null;
  const isEq = state.equipped[item.category] === item.uid;
  const r = rOf(item.corruption); const alv = item.analysisLv;
  const div = document.createElement('div');
  div.className = 'icard' + (isEq ? ' eq' : '') + (item.justEv ? ' flash-ev' : '');
  item.justEv = false;
  const showStat = alv >= 2 && item.category !== 'ring';
  const statLine = showStat ? (item.category === 'weapon' ? `ATK:${fmt(def.atk + item.enhanceLv + corrBonus(item))}` : `DEF:${fmt(def.def + item.enhanceLv + corrBonus(item))}`) : '';
  const capLine = alv >= 1 && item.category !== 'ring' ? `<div class="dim">強化 +${item.enhanceLv}/${capFor(item)}</div>` : '';
  const evoLine = alv >= 3 && def.evolvesTo ? `<div class="dim">進化先: ${fDef(item.category, def.evolvesTo)?.name || '?'}</div>` : '';
  const abHtml = item.abilities.map(ab => `<span class="abtag${ab.rare ? ' rare' : ''}">${ab.name}${ab.rare ? '' : ' Lv' + ab.lv}</span>`).join('');
  const need = expForLv(alv + 1); const ep = Math.min(100, item.analysisExp / need * 100);
  div.innerHTML = `<div class="row">
    <span class="iname ${state.worldLevel > 0 ? r.cls : ''}">${isEq ? '【E】' : ''}${iName(item)}${statLine ? ` (${statLine})` : ''}</span>
    <button class="sm ${isEq ? 'sec' : ''}" data-uid="${item.uid}" data-cat="${item.category}">${isEq ? '解除' : '装備'}</button>
  </div>
  <div class="dim">解析Lv${alv}${state.worldLevel > 0 ? ` <span class="cbadge">侵食度${item.corruption}</span>` : ''} ${item.analysisExp}/${need}EXP</div>
  <div class="exp-mini"><div class="exp-mini-fill" style="width:${ep}%;"></div></div>
  ${capLine}${evoLine}<div>${abHtml}</div>`;
  return div;
}
function renderItemList() {
  const el = document.getElementById('itemList'); el.innerHTML = '';
  const items = state.inventory.filter(it => it.category === itemCat).sort((a, b) => b.corruption - a.corruption);
  if (!items.length) { el.innerHTML = '<p class="dim">まだ装備がありません。</p>'; return; }
  items.forEach(item => {
    const card = renderItemCard(item); if (!card) return;
    card.onclick = e => { if (e.target.dataset.uid) return; openItemDetail(item.uid); };
    card.querySelectorAll('[data-uid]').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const cat = btn.dataset.cat, uid = btn.dataset.uid;
        state.equipped[cat] = state.equipped[cat] === uid ? null : uid;
        save(); renderItemList(); renderStatusScreen(); renderDngList(); renderTopBar();
      };
    });
    el.appendChild(card);
  });
}
function renderMatGrid() {
  const el = document.getElementById('matGrid'); el.innerHTML = '';
  let any = false;
  GD.enhanceMaterials.forEach(m => {
    const cnt = state.materials[m.id] || 0; if (!cnt) return; any = true;
    const div = document.createElement('div'); div.className = 'mat-card';
    div.innerHTML = `<div>${m.name}</div><div class="cnt">×${cnt}</div><div class="dim">+${m.value}</div>`;
    el.appendChild(div);
  });
  if (!any) el.innerHTML = '<p class="dim">強化素材がありません。</p>';
}

// ===================== アイテム詳細モーダル =====================
function openItemDetail(uid) {
  const item = state.inventory.find(it => it.uid === uid);
  const def = fDef(item.category, item.defId);
  const r = rOf(item.corruption);
  const alv = item.analysisLv;
  const modal = document.getElementById('modalRoot');
  // 解析段階に応じた情報
  const needExp = expForLv(alv + 1);
  const ep = Math.min(100, item.analysisExp / needExp * 100);
  const statStr = item.category === 'weapon'
    ? `ATK: ${fmt(def.atk + item.enhanceLv + corrBonus(item))}（基礎${def.atk} + 強化${item.enhanceLv} + 侵食度${corrBonus(item)}）`
    : item.category === 'shield'
    ? `DEF: ${fmt(def.def + item.enhanceLv + corrBonus(item))}（基礎${def.def} + 強化${item.enhanceLv} + 侵食度${corrBonus(item)}）`
    : '指輪は武器・盾の効果はなし';
  const lv1Info = alv >= 2 && def.lv1
    ? `<div class="dim" style="margin-top:4px;">Lv1ステータス：HP+${def.lv1.hp || 0}  STR+${def.lv1.str || 0}  VIT+${def.lv1.vit || 0}  SPD+${def.lv1.spd || 0}</div>` : '';
  const lvupInfo = alv >= 4 && def.lvup
    ? `<div class="dim">LvUP上昇：STR+${def.lvup.str || 0}  VIT+${def.lvup.vit || 0}</div>` : '';
  const evoInfo = alv >= 3 && def.evolvesTo
    ? `<div class="dim" style="color:var(--gold);">進化先：${fDef(item.category, def.evolvesTo)?.name || '?'}</div>` : '';
  const abHtml = item.abilities.map(ab => `<span class="abtag${ab.rare ? ' rare' : ''}">${ab.name}${ab.rare ? '' : ' Lv' + ab.lv}</span>`).join('');
  const capInfo = alv >= 1 && item.category !== 'ring'
    ? `<div class="dim">強化 +${item.enhanceLv} / 上限 ${capFor(item)}</div>` : '';
  // 限界突破情報（Lv5以降）
  const btLines = alv >= 5 ? activeEff(item).map(e => {
    const eff = item.category === 'shield' ? e.effectShield : e.effectWeapon;
    return `<div class="dim" style="color:var(--gold);">✓ Lv${e.analysisLv}（侵食度${e.corruption}+）: ${eff}</div>`;
  }).join('') : '';
  modal.innerHTML = `<div class="modal-overlay" id="dtlO">
    <div class="modal ctr">
      <div class="mhdr">
        <h3 style="margin:0" class="${r.cls}">${def?.name || '???'}</h3>
        <span class="cx" id="closeDtl">✕</span>
      </div>
      <div class="dim" style="margin-bottom:8px;">${catLbl(item.category)} ${state.worldLevel > 0 ? `<span class="cbadge">[${r.label}] 侵食度${item.corruption}</span>` : ''}</div>
      <div style="margin-bottom:8px;"><b>${statStr}</b></div>
      ${capInfo}${lv1Info}${lvupInfo}${evoInfo}
      <div style="margin:8px 0;">${abHtml || '<span class="dim">能力なし</span>'}</div>
      ${btLines ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);"><div class="dim" style="font-size:11px;margin-bottom:4px;">限界突破（発現中）</div>${btLines}</div>` : ''}
      <div class="xb-bg" style="margin:10px 0 4px;"><div class="xb-fill" style="width:${ep}%;"></div></div>
      <div class="dim">解析Lv${alv}（次まで ${item.analysisExp}/${needExp} EXP）</div>
      ${item.category !== 'ring' ? `<button class="sm full" style="margin-top:10px;" id="btnEnh">強化する</button>` : ''}
    </div>
  </div>`;
  document.getElementById('closeDtl').onclick = () => modal.innerHTML = '';
  document.getElementById('dtlO').onclick = e => { if (e.target.id === 'dtlO') modal.innerHTML = ''; };
  document.getElementById('btnEnh')?.addEventListener('click', () => { modal.innerHTML = ''; openEnhModal(uid); });
}

// ===================== 強化モーダル =====================
function openEnhModal(uid) {
  const item = state.inventory.find(it => it.uid === uid);
  const def = fDef(item.category, item.defId);
  const cap = capFor(item); const pct = Math.min(100, item.enhanceLv / Math.max(1, cap) * 100);
  const modal = document.getElementById('modalRoot');
  const opts = GD.enhanceMaterials.map(m => {
    const h = state.materials[m.id] || 0;
    return `<option value="${m.id}" ${h <= 0 ? 'disabled' : ''}>${m.name}（+${m.value}） 所持${h}個</option>`;
  }).join('');
  modal.innerHTML = `<div class="modal-overlay" id="enhO">
    <div class="modal ctr">
      <div class="mhdr"><h3 style="margin:0">${def?.name}を強化</h3><span class="cx" id="closeEnh">✕</span></div>
      <div class="eb-bg" style="margin-bottom:10px;"><div class="eb-fill" style="width:${pct}%;"></div><div class="eb-txt">+${item.enhanceLv} / ${cap}</div></div>
      <div class="row" style="gap:6px;margin-bottom:10px;">
        <select id="enhMat" style="flex:2;">${opts}</select>
        <input type="number" id="enhCnt" value="1" min="1" style="flex:1;">
      </div>
      <button class="full gold" id="btnDoEnh">強化する</button>
      ${def?.evolvesTo ? '<p class="dim" style="margin-top:8px;">上限まで強化すると進化する可能性があります</p>' : ''}
    </div>
  </div>`;
  document.getElementById('closeEnh').onclick = () => modal.innerHTML = '';
  document.getElementById('enhO').onclick = e => { if (e.target.id === 'enhO') modal.innerHTML = ''; };
  document.getElementById('btnDoEnh').onclick = () => {
    const matId = document.getElementById('enhMat').value;
    const cnt = parseInt(document.getElementById('enhCnt').value) || 1;
    const res = enhance(uid, matId, cnt);
    if (res) {
      modal.innerHTML = '';
      renderItemList(); renderMatGrid(); renderStatusScreen();
      if (item.justEv) toast(`${fDef(item.category, item.defId)?.name}に進化した！`);
    } else alert('強化できません（素材不足または上限到達）');
  };
}

// ===================== 解析画面（別画面遷移・素材なし） =====================
function openAnalysisScreen() {
  const modal = document.getElementById('modalRoot');
  const items = state.inventory.slice().sort((a, b) => b.corruption - a.corruption);

  function renderAnaContent(selectedUid) {
    const sel = selectedUid ? state.inventory.find(it => it.uid === selectedUid) : null;
    const selDef = sel ? fDef(sel.category, sel.defId) : null;
    const alv = sel?.analysisLv || 0;
    const need = sel ? expForLv(alv + 1) : 0;
    const ep = sel ? Math.min(100, sel.analysisExp / need * 100) : 0;

    const gainOptions = [1, 2, 4, 8, 16, 32, 40, 48, 56, 64].map(v =>
      `<option value="${v}">${v} EXP（Lv${v <= 16 ? Math.ceil(Math.log2(v + 1)) : '上位'}相当）</option>`
    ).join('');

    const itemsHtml = ['weapon', 'shield', 'ring'].map(cat => {
      const catItems = items.filter(it => it.category === cat);
      if (!catItems.length) return '';
      return `<div style="margin-bottom:10px;">
        <div class="dim" style="font-size:11px;margin-bottom:4px;">${catLbl(cat)}</div>
        ${catItems.map(it => {
          const r = rOf(it.corruption); const d = fDef(it.category, it.defId);
          const isSel = it.uid === selectedUid;
          const need2 = expForLv(it.analysisLv + 1);
          const ep2 = Math.min(100, it.analysisExp / need2 * 100);
          return `<div class="coll-item ${isSel ? 'sel' : ''}" data-ana="${it.uid}">
            <div class="row">
              <span class="iname ${state.worldLevel > 0 ? r.cls : ''}">${d?.name || '?'}</span>
              <span class="dim">解析Lv${it.analysisLv}</span>
            </div>
            <div class="exp-mini"><div class="exp-mini-fill" style="width:${ep2}%;"></div></div>
            <div class="dim" style="font-size:11px;">${it.analysisExp}/${need2}EXP${state.worldLevel > 0 ? ` [${r.label}] 侵食度${it.corruption}` : ''}</div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');

    modal.innerHTML = `<div class="modal-overlay" id="anaO">
      <div class="modal">
        <div class="mhdr"><h3 style="margin:0">🔬 解析</h3><span class="cx" id="closeAna">✕</span></div>
        <p class="dim" style="margin:0 0 10px;">装備を選んで解析値を上げます。解析Lvが5の倍数に達するとBP+1。</p>
        <div style="display:flex;flex-direction:column;max-height:calc(90vh - 200px);overflow:hidden;">
          <div style="flex:1;overflow-y:auto;border-bottom:1px solid var(--border);padding-bottom:8px;">
            <div class="dim" style="font-size:11px;position:sticky;top:0;background:var(--panel);padding:4px 0;">装備を選択</div>
            ${itemsHtml}
          </div>
          ${sel ? `<div style="padding-top:10px;flex-shrink:0;">
            <div style="font-weight:600;margin-bottom:6px;">${selDef?.name} を解析</div>
            <div class="xb-bg" style="margin-bottom:4px;"><div class="xb-fill" style="width:${ep}%;"></div></div>
            <div class="dim" style="margin-bottom:8px;">Lv${alv} → ${alv + (sel.analysisExp > 0 ? '' : '次までに必要: ')}${need}EXP</div>
            <div class="row" style="gap:6px;margin-bottom:8px;">
              <select id="anaExpSel" style="flex:1;">${gainOptions}</select>
              <button class="gold" id="btnDoAna">解析する</button>
            </div>
          </div>` : `<div class="dim" style="padding-top:10px;">装備を選んでください</div>`}
        </div>
      </div>
    </div>`;

    document.getElementById('closeAna').onclick = () => modal.innerHTML = '';
    document.getElementById('anaO').onclick = e => { if (e.target.id === 'anaO') modal.innerHTML = ''; };
    modal.querySelectorAll('[data-ana]').forEach(el => {
      el.onclick = () => renderAnaContent(el.dataset.ana);
    });
    document.getElementById('btnDoAna')?.addEventListener('click', () => {
      const expGain = parseInt(document.getElementById('anaExpSel').value) || 1;
      gainExp(sel, expGain);
      save(); renderAnaContent(selectedUid);
      renderItemList(); renderStatusScreen(); renderTopBar();
    });
  }

  renderAnaContent(null);
}

// ===================== アイテム図鑑画面 =====================
function openCollectionScreen() {
  const modal = document.getElementById('modalRoot');
  const allItems = state.inventory.slice().sort((a, b) => b.analysisLv - a.analysisLv || b.corruption - a.corruption);

  function renderCollContent(filterCat) {
    const filtered = filterCat === 'all' ? allItems : allItems.filter(it => it.category === filterCat);
    const html = filtered.map(item => {
      const def = fDef(item.category, item.defId); if (!def) return '';
      const r = rOf(item.corruption); const alv = item.analysisLv;
      const need = expForLv(alv + 1); const ep = Math.min(100, item.analysisExp / need * 100);
      const showStat = alv >= 2;
      const statTxt = showStat && item.category !== 'ring'
        ? (item.category === 'weapon' ? `ATK:${fmt(def.atk + item.enhanceLv + corrBonus(item))}` : `DEF:${fmt(def.def + item.enhanceLv + corrBonus(item))}`) : '';
      return `<div class="coll-item" data-coll="${item.uid}">
        <div class="row">
          <span class="iname ${state.worldLevel > 0 ? r.cls : ''}">${def.name}${statTxt ? ` (${statTxt})` : ''}</span>
          <span class="dim">解析Lv${alv}</span>
        </div>
        <div class="exp-mini"><div class="exp-mini-fill" style="width:${ep}%;"></div></div>
        <div class="dim" style="font-size:11px;">${item.analysisExp}/${need}EXP ${state.worldLevel > 0 ? `[${r.label}]侵食度${item.corruption}` : ''} ${catLbl(item.category)}</div>
      </div>`;
    }).join('') || '<p class="dim">装備がありません</p>';

    modal.innerHTML = `<div class="modal-overlay" id="collO">
      <div class="modal">
        <div class="mhdr"><h3 style="margin:0">📖 アイテム図鑑</h3><span class="cx" id="closeColl">✕</span></div>
        <div class="segctrl" style="margin-bottom:8px;">
          <button class="${filterCat === 'weapon' ? 'active' : ''}" data-cf="weapon">武器</button>
          <button class="${filterCat === 'shield' ? 'active' : ''}" data-cf="shield">盾</button>
          <button class="${filterCat === 'ring' ? 'active' : ''}" data-cf="ring">指輪</button>
        </div>
        <div style="overflow-y:auto;max-height:calc(90vh - 140px);">${html}</div>
      </div>
    </div>`;
    document.getElementById('closeColl').onclick = () => modal.innerHTML = '';
    document.getElementById('collO').onclick = e => { if (e.target.id === 'collO') modal.innerHTML = ''; };
    modal.querySelectorAll('[data-cf]').forEach(btn => { btn.onclick = () => renderCollContent(btn.dataset.cf); });
    modal.querySelectorAll('[data-coll]').forEach(el => {
      el.onclick = () => { modal.innerHTML = ''; openItemDetail(el.dataset.coll); };
    });
  }
  renderCollContent('weapon');
}

// ===================== STATUS画面（タブ3つ） =====================
let sTabs = 'stats';
document.querySelectorAll('.inner-tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.inner-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); sTabs = btn.dataset.stab;
    ['stats', 'boost', 'record'].forEach(t => {
      document.getElementById('stab-' + t)?.classList.toggle('hidden', t !== sTabs);
    });
    if (sTabs === 'stats') renderStatsTab();
    if (sTabs === 'boost') renderBoostTab();
    if (sTabs === 'record') renderRecordTab();
  };
});
function renderStatusScreen() {
  if (sTabs === 'stats') renderStatsTab();
  if (sTabs === 'boost') renderBoostTab();
  if (sTabs === 'record') renderRecordTab();
}
function renderStatsTab() {
  const s = calcStats();
  // 装備中の装備情報
  const eqHtml = ['weapon', 'shield', 'ring'].map(cat => {
    const item = getEq(cat); if (!item) return `<div class="dim">${catLbl(cat)}: 未装備</div>`;
    const def = fDef(cat, item.defId); if (!def) return '';
    const r = rOf(item.corruption);
    let detail = '';
    if (cat !== 'ring') {
      const base = cat === 'weapon' ? `基礎ATK:${def.atk}` : `基礎DEF:${def.def}`;
      const lv1s = def.lv1 ? `HP+${def.lv1.hp || 0}/STR+${def.lv1.str || 0}/VIT+${def.lv1.vit || 0}/SPD+${def.lv1.spd || 0}` : '';
      const lvups = def.lvup ? `STR+${def.lvup.str || 0}/VIT+${def.lvup.vit || 0}` : '';
      detail = `<div class="dim" style="font-size:11px;">${base} | Lv1: ${lv1s} | LvUP: ${lvups}</div>`;
    }
    return `<div style="margin-bottom:8px;">
      <span class="iname ${r.cls}">${catLbl(cat)}: ${def.name}</span> +${item.enhanceLv}
      ${detail}
    </div>`;
  }).join('');
  document.getElementById('equippedList').innerHTML = eqHtml;

  // ステータスサマリ
  const table = document.getElementById('statusTable');
  const ar = Object.keys(s.rF).filter(k => s.rF[k]);
  table.innerHTML = `<tr><th>ステータス</th><th>Lv1値</th><th>LvUP</th></tr>
    <tr><td>HP</td><td>${fmt(s.totalHp)}</td><td>+${s.hpup}</td></tr>
    <tr><td>ATK（武器込）</td><td>${fmt(s.totalAtk)}</td><td>+${s.strup}</td></tr>
    <tr><td>DEF（盾込）</td><td>${fmt(s.totalDef)}</td><td>+${s.vitup}</td></tr>
    <tr><td>SPD</td><td>${s.spd1}</td><td>+1</td></tr>
    <tr><td>LUK</td><td>${s.luk1}</td><td>+0</td></tr>
    ${ar.length ? `<tr><td colspan="3" class="dim">特殊：${ar.join(' / ')}</td></tr>` : ''}`;

  // 成長テーブル
  const gt = document.getElementById('growthTable');
  gt.innerHTML = `<tr><th>Lv</th><th>HP</th><th>ATK</th><th>DEF</th></tr>`;
  [1, 10, 20, 30, 40, 50].forEach(lv => {
    const sv = statsAtLv(s, lv);
    gt.innerHTML += `<tr><td>Lv${lv}</td><td>${fmt(sv.hp)}</td><td>${fmt(sv.atk)}</td><td>${fmt(sv.def)}</td></tr>`;
  });

  document.getElementById('topRating').textContent = rating(s).toLocaleString();
}
function renderBoostTab() {
  document.getElementById('bpAvail').textContent = state.bp;
  const el = document.getElementById('boostList');
  el.innerHTML = GD.permanentBoostOptions.map(o => `
    <div class="row" style="margin-bottom:6px;">
      <span>${o.label}（現在+${(state.permanentBoosts[o.key] || 0) * o.perPoint} / 1BPごと+${o.perPoint}）</span>
      <button class="sm gold" data-sp="${o.key}" ${state.bp <= 0 ? 'disabled' : ''}>BP消費</button>
    </div>`).join('');
  el.querySelectorAll('[data-sp]').forEach(btn => { btn.onclick = () => { spendBP(btn.dataset.sp); renderBoostTab(); }; });
  const cost = GD.rareAbilityUnlockCost;
  const ss = Object.values(state.permanentBoosts).reduce((a, b) => a + b, 0);
  const rs = Object.values(state.rareUnlocked).filter(Boolean).length * cost;
  const rEl = document.getElementById('rareUnlockList');
  rEl.innerHTML = `<p class="dim">特殊能力の永久固定化（${cost}BP）</p>` +
    GD.rareAbilities.slice(0, 8).map(name => {
      const done = !!state.rareUnlocked[name];
      return `<div class="row" style="margin-bottom:6px;"><span>${name} ${done ? '<span class="abtag rare">固定化済み</span>' : ''}</span>
      <button class="sm gold" data-ul="${name}" ${done || state.bp < cost ? 'disabled' : ''}>${done ? '済み' : `${cost}BP`}</button></div>`;
    }).join('') +
    `<button class="sm sec full" id="btnRespec" ${ss + rs > 0 ? '' : 'disabled'} style="margin-top:8px;">すべて振り直し（${ss + rs}BP回収）</button>`;
  rEl.querySelectorAll('[data-ul]').forEach(btn => { btn.onclick = () => { unlockRare(btn.dataset.ul); renderBoostTab(); }; });
  document.getElementById('btnRespec')?.addEventListener('click', () => {
    if (confirm('すべてのBP振り分けを回収しますか？')) { respecAll(); renderBoostTab(); }
  });
}
function renderRecordTab() {
  const st = state.adventureStats || {};
  const rewards = state.rewards || [];
  document.getElementById('recordList').innerHTML = `
    <table class="stbl">
      <tr><td>総戦闘数</td><td>${(st.totalBattles || 0).toLocaleString()}</td></tr>
      <tr><td>勝利数</td><td>${(st.totalWins || 0).toLocaleString()}</td></tr>
      <tr><td>全滅数</td><td>${(st.totalDeaths || 0).toLocaleString()}</td></tr>
      <tr><td>ドロップ数</td><td>${(st.totalDrops || 0).toLocaleString()}</td></tr>
      <tr><td>所持装備数</td><td>${state.inventory.length}</td></tr>
      <tr><td>瘴気濃度</td><td>${state.worldLevel}</td></tr>
      <tr><td>累計BP</td><td>${state.bp}</td></tr>
    </table>
    ${rewards.length ? `<div style="margin-top:12px;"><div class="dim" style="margin-bottom:6px;">獲得済みアイテム</div>${rewards.map(r => `<span class="abtag rare">🎁 ${r}</span>`).join('')}</div>` : ''}
  `;
}

// ===================== トップバー =====================
function renderTopBar() {
  document.getElementById('topBP').textContent = state.bp;
  document.getElementById('topRating').textContent = rating(calcStats()).toLocaleString();
}

// ===================== Toast =====================
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._t); t._t = setTimeout(() => { t.style.opacity = '0'; }, 2500);
}

// ===================== タブ切り替え =====================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById('screen-' + btn.dataset.screen).classList.remove('hidden');
    if (btn.dataset.screen === 'dungeon') renderDngList();
    if (btn.dataset.screen === 'log') renderLogList();
    if (btn.dataset.screen === 'item') { renderItemList(); renderMatGrid(); }
    if (btn.dataset.screen === 'status') { renderStatusScreen(); }
  };
});
document.getElementById('btnRetreat').onclick = retreat;

// ===================== 初期化 =====================
function init() {
  const loaded = load();
  if (!loaded) {
    // 初期装備（仕様書通り: 木の棒・なべのふた・銅の指輪、能力なし）
    const sw = mkItem('weapon', 'w_001', 0, 1); sw.abilities = [];
    const ss = mkItem('shield', 's_001', 0, 1); ss.abilities = [];
    const sr = mkItem('ring', 'r_001', 0, 1); sr.abilities = [];
    state.inventory.push(sw, ss, sr);
    state.equipped.weapon = sw.uid;
    state.equipped.shield = ss.uid;
    state.equipped.ring = sr.uid;
    addMat('m_kat', 10);
    addMat('m_katx', 3);
    save();
  }
  renderDngList();
  renderTopBar();
  resumeOffline();
}
init();
