// ===================== データロード =====================
const GAME_DATA = JSON.parse(document.getElementById('game-data').textContent);

// ===================== タイマー設定 =====================
const SECS_PER_FLOOR = 300; // 1階層 = 5分
let autoInterval = null;    // setIntervalのID

function findWeapon(id) { return GAME_DATA.weapons.find(w => w.id === id); }
function findShield(id) { return GAME_DATA.shields.find(s => s.id === id); }
function findRing(id) { return GAME_DATA.rings.find(r => r.id === id); }
function findEquipDef(category, id) {
  if (category === 'weapon') return findWeapon(id);
  if (category === 'shield') return findShield(id);
  return findRing(id);
}
function categoryLabel(cat) { return cat==='weapon'?'武器':cat==='shield'?'盾':'指輪'; }

// ===================== ダメージ計算（仕様書準拠） =====================
function calcDamage(atk, def, forceKaishin=false) {
  const provisional = Math.max(0, Math.round(atk - def));
  const rand = Math.floor(Math.random() * 6);
  let dmg = provisional + rand;
  const isKaishin = forceKaishin || Math.random() < 0.05;
  if (isKaishin) dmg *= 2;
  return { dmg, isKaishin };
}

// ===================== レアリティ =====================
function rarityOf(corruption) {
  if (corruption >= 250) return { key:'red',   label:'赤', cls:'rarity-red',    expGain:8 };
  if (corruption >= 150) return { key:'yellow', label:'黄', cls:'rarity-yellow', expGain:4 };
  if (corruption >= 50)  return { key:'blue',   label:'青', cls:'rarity-blue',   expGain:2 };
  return                        { key:'white',  label:'白', cls:'rarity-white',  expGain:1 };
}

// ===================== 侵食度 =====================
function rollCorruption(worldLevel) {
  if (worldLevel <= 0) return 0;
  const bias = Math.min(0.6, worldLevel * 0.08);
  return Math.round(Math.pow(Math.random(), 1 - bias) * 300);
}

// ===================== 解析EXP（仕様書: 1,2,4,8,16,32,40,48,56,64,64...） =====================
function expNeededForLevel(lv) {
  const t = [0,1,2,4,8,16,32,40,48,56,64];
  return t[lv] ?? 64;
}

// ===================== 限界突破 =====================
function activeEffectsFor(item) {
  return GAME_DATA.breakthroughLines.filter(l =>
    item.analysisLv >= l.analysisLv && item.corruption >= l.corruption
  );
}
function enhanceCapBonusFor(item) {
  let bonus = 0;
  activeEffectsFor(item).forEach(e => {
    const key = item.category==='shield' ? e.effectShield : e.effectWeapon;
    if (!key) return;
    const m = key.match(/強化上限アップ\+(\d+)/);
    if (m) bonus += parseInt(m[1]);
  });
  return bonus;
}
function corruptionBonus(item) {
  if (item.category==='ring') return 0;
  const hasBoost = item.analysisLv >= 10 && item.corruption >= 250;
  return item.corruption * (hasBoost ? 20 : 10);
}

// ===================== 状態 =====================
let uidCounter = 1;
const SAVE_KEY = 'whipper_v4_save';

function defaultState() {
  return {
    worldLevel: 0,
    bp: 0,
    permanentBoosts: { hp:0, atk:0, def:0, spd:0, luk:0 },
    rareAbilityUnlocked: {},
    materials: {},
    inventory: [],
    equipped: { weapon:null, shield:null, ring:null },
    clearedDungeons: {},
    dungeonLogs: [],  // 過去10件
    // 放置用タイムスタンプ（探索中のみ有効）
    exploreTimestamp: null,   // 最後にターンを処理した時刻（ms）
    exploreSaveData: null,    // 探索中断時のcurrentExploreのスナップショット
  };
}
let state = defaultState();
// 現在進行中の探索（セーブしない一時データ）
let currentExplore = null;

// ===================== セーブ / ロード =====================
function saveGame() {
  try {
    // 探索中ならcurrentExploreのスナップショットをstateに保存
    if (currentExplore && !currentExplore.finished) {
      state.exploreSaveData = JSON.parse(JSON.stringify(currentExplore));
      state.exploreTimestamp = Date.now();
    } else if (!currentExplore || currentExplore.finished) {
      state.exploreSaveData = null;
      state.exploreTimestamp = null;
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify({ state, uidCounter }));
  } catch(e) { console.warn('save fail', e); }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    state = d.state;
    uidCounter = d.uidCounter || 1;
    return true;
  } catch(e) { console.warn('load fail', e); return false; }
}
function resetGame() {
  if (!confirm('セーブデータを削除してリセットしますか？')) return;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
}

// ===================== ダンジョン解放 =====================
function isDungeonUnlocked(dungeonId) {
  const ids = GAME_DATA.dungeons.map(d=>d.id).sort((a,b)=>a-b);
  const idx = ids.indexOf(dungeonId);
  if (idx <= 0) return true;
  return !!state.clearedDungeons[ids[idx-1]];
}
function allDungeonsCleared() {
  return GAME_DATA.dungeons.every(d => state.clearedDungeons[d.id]);
}

// ===================== 素材 =====================
function addMaterial(id, count) { state.materials[id] = (state.materials[id]||0) + count; }

// ===================== アイテム能力値（仕様書PDF表） =====================
const ABILITY_BASE_VALUES = {
  '耐久':       [5,10,15,25,40,65,105,170,275,445,500,750,1000,1500,2000,2500,3000,4000,5000,6000],
  '腕力':       [5,10,15,25,40,65,105,170,275,445,500,750,1000,1500,2000,2500,3000,4000,5000,6000],
  '頑丈':       [5,10,15,25,40,65,105,170,275,445,500,750,1000,1500,2000,2500,3000,4000,5000,6000],
  '機敏':       [2,5,10,15,20,30,45,70,95,135,175,215,270,325,380,435,490,545,600,655],
  '幸運':       [1,2,3,4,5,6,7,8],
  '体力の鍛錬': [2,4,7,11,16,25,35,50,60,70,85,95,120,150,180,210,240,270,300,330],
  '力の鍛錬':   [1,2,3,5,8,13,18,25,35,50,70,95,120,150,180,210,240,270,300,330],
  '守りの鍛錬': [1,2,3,5,8,13,18,25,35,50,70,95,120,150,180,210,240,270,300,330],
};
function abilityValue(name, lv) {
  const t = ABILITY_BASE_VALUES[name];
  if (!t) return 0;
  return t[Math.min(lv-1, t.length-1)] || 0;
}

function rollAbilities(corruption) {
  const slots = 3;
  const abilities = [];
  const canRare = corruption >= 150;
  for (let i = 0; i < slots; i++) {
    if (i===0 && canRare && Math.random()<0.1) {
      abilities.push({ name: GAME_DATA.rareAbilities[Math.floor(Math.random()*GAME_DATA.rareAbilities.length)], lv:1, rare:true });
    } else {
      abilities.push({ name: GAME_DATA.abilityPool[Math.floor(Math.random()*GAME_DATA.abilityPool.length)], lv:1+Math.floor(Math.random()*8), rare:false });
    }
  }
  return abilities;
}

function createDroppedItem(category, defId, corruption) {
  return { uid:'item'+(uidCounter++), category, defId, enhanceLv:0, corruption,
           abilities:rollAbilities(corruption), analysisLv:0, analysisExp:0, bpAwardedAt:0, justEvolved:false };
}

// ===================== 強化 =====================
function enhanceCapFor(item) {
  const def = findEquipDef(item.category, item.defId);
  return (def?.enhanceCap||0) + enhanceCapBonusFor(item);
}
function enhanceItem(uid, materialId, count) {
  const item = state.inventory.find(it=>it.uid===uid);
  if (!item || item.category==='ring') return false;
  const mat = GAME_DATA.enhanceMaterials.find(m=>m.id===materialId);
  const have = state.materials[materialId]||0;
  if (!mat||have<count||count<=0) return false;
  const cap = enhanceCapFor(item);
  const newLv = Math.min(cap, item.enhanceLv + mat.value*count);
  if (newLv===item.enhanceLv) return false;
  state.materials[materialId] -= count;
  item.enhanceLv = newLv;
  const evolved = checkEvolution(item);
  saveGame();
  return { evolved };
}
function checkEvolution(item) {
  const def = findEquipDef(item.category, item.defId);
  if (!def?.evolvesTo) return false;
  if (item.enhanceLv < enhanceCapFor(item)) return false;
  const carry = item.enhanceLv - enhanceCapFor(item);
  item.defId = def.evolvesTo;
  item.enhanceLv = Math.max(0, carry);
  item.analysisLv = 0; item.analysisExp = 0; item.bpAwardedAt = 0;
  item.justEvolved = true;
  return true;
}

// ===================== 解析（複数素材選択対応） =====================
function gainAnalysisExp(item, amount) {
  item.analysisExp += amount;
  let leveled = false;
  while (true) {
    const need = expNeededForLevel(item.analysisLv+1);
    if (item.analysisExp >= need) {
      item.analysisExp -= need;
      item.analysisLv++;
      leveled = true;
      if (item.analysisLv%5===0 && item.analysisLv>item.bpAwardedAt) {
        state.bp++;
        item.bpAwardedAt = item.analysisLv;
        showToast(`解析Lv${item.analysisLv}達成！BP+1（合計${state.bp}BP）`);
      }
    } else break;
  }
  return leveled;
}
function canUseAsAnalysisMaterial(target, candidate) {
  if (!target || !candidate) return false;
  if (candidate.uid===target.uid) return false;
  if (candidate.defId!==target.defId) return false;
  if (Object.values(state.equipped).includes(candidate.uid)) return false;
  return true;
}
// 複数素材をまとめて解析
function analyzeWithMaterials(targetUid, materialUids) {
  const target = state.inventory.find(it=>it.uid===targetUid);
  if (!target || !materialUids.length) return false;
  let totalExp = 0;
  const validMats = [];
  materialUids.forEach(muid => {
    const mat = state.inventory.find(it=>it.uid===muid);
    if (mat && canUseAsAnalysisMaterial(target, mat)) {
      totalExp += rarityOf(mat.corruption).expGain;
      validMats.push(muid);
    }
  });
  if (!validMats.length) return false;
  gainAnalysisExp(target, totalExp);
  state.inventory = state.inventory.filter(it => !validMats.includes(it.uid));
  Object.keys(state.equipped).forEach(k => {
    if (validMats.includes(state.equipped[k])) state.equipped[k] = null;
  });
  saveGame();
  return true;
}

// ===================== BP =====================
function spendBPOnStat(key) {
  if (state.bp<=0) return false;
  state.bp--;
  state.permanentBoosts[key] = (state.permanentBoosts[key]||0)+1;
  saveGame(); return true;
}
function unlockRareAbility(name) {
  const cost = GAME_DATA.rareAbilityUnlockCost;
  if (state.bp<cost || state.rareAbilityUnlocked[name]) return false;
  state.bp -= cost;
  state.rareAbilityUnlocked[name] = true;
  saveGame(); return true;
}
function respecAll() {
  const ss = Object.values(state.permanentBoosts).reduce((a,b)=>a+b,0);
  const rs = Object.values(state.rareAbilityUnlocked).filter(Boolean).length * GAME_DATA.rareAbilityUnlockCost;
  if (ss+rs<=0) return false;
  state.bp += ss+rs;
  Object.keys(state.permanentBoosts).forEach(k=>state.permanentBoosts[k]=0);
  Object.keys(state.rareAbilityUnlocked).forEach(k=>state.rareAbilityUnlocked[k]=false);
  saveGame(); return true;
}

// ===================== ステータス計算 =====================
function getEquippedItem(cat) {
  const uid = state.equipped[cat];
  return uid ? state.inventory.find(it=>it.uid===uid) : null;
}
function computePlayerStats() {
  const bs = GAME_DATA.baseStats;
  let hp1=bs.hp, str1=bs.str, vit1=bs.vit, spd1=bs.spd, luk1=bs.luk;
  let hpup=GAME_DATA.growthStats.hp, strup=GAME_DATA.growthStats.str;
  let vitup=GAME_DATA.growthStats.vit;
  let weaponAtk=0, shieldDef=0, hpBoost=1, atkMult=1, defMult=1;
  const rareFlags={};

  const pb = state.permanentBoosts;
  GAME_DATA.permanentBoostOptions.forEach(o => {
    const m={hp:'hp',atk:'str',def:'vit',spd:'spd',luk:'luk'};
    const s=m[o.key];
    if(s==='hp') hp1+=pb[o.key]*o.perPoint;
    else if(s==='str') str1+=pb[o.key]*o.perPoint;
    else if(s==='vit') vit1+=pb[o.key]*o.perPoint;
    else if(s==='spd') spd1+=pb[o.key]*o.perPoint;
    else if(s==='luk') luk1+=pb[o.key]*o.perPoint;
  });
  Object.keys(state.rareAbilityUnlocked).forEach(n=>{ if(state.rareAbilityUnlocked[n]) rareFlags[n]=true; });

  ['weapon','shield','ring'].forEach(cat=>{
    const item=getEquippedItem(cat); if(!item) return;
    const def=findEquipDef(cat,item.defId); if(!def) return;
    if(def.lv1){ hp1+=def.lv1.hp||0; str1+=def.lv1.str||0; vit1+=def.lv1.vit||0; spd1+=def.lv1.spd||0; }
    if(def.lvup){ strup+=def.lvup.str||0; vitup+=def.lvup.vit||0; }
    if(cat==='weapon') weaponAtk=(def.atk||0)+item.enhanceLv+corruptionBonus(item);
    if(cat==='shield') shieldDef=(def.def||0)+item.enhanceLv+corruptionBonus(item);
    item.abilities.forEach(ab=>{
      if(ab.rare){rareFlags[ab.name]=true;return;}
      switch(ab.name){
        case '耐久': hp1+=abilityValue('耐久',ab.lv); break;
        case '腕力': str1+=abilityValue('腕力',ab.lv); break;
        case '頑丈': vit1+=abilityValue('頑丈',ab.lv); break;
        case '機敏': spd1+=abilityValue('機敏',ab.lv); break;
        case '幸運': luk1+=abilityValue('幸運',ab.lv); break;
        case '体力の鍛錬': hpup+=abilityValue('体力の鍛錬',ab.lv); break;
        case '力の鍛錬': strup+=abilityValue('力の鍛錬',ab.lv); break;
        case '守りの鍛錬': vitup+=abilityValue('守りの鍛錬',ab.lv); break;
      }
    });
    activeEffectsFor(item).forEach(e=>{
      const eff=cat==='shield'?e.effectShield:e.effectWeapon; if(!eff) return;
      if(eff.includes('HPブースト×1.3')) hpBoost=Math.max(hpBoost,1.3);
      if(eff.includes('攻撃力ブースト×1.3')) atkMult=Math.max(atkMult,1.3);
      if(eff.includes('守備力ブースト×1.3')) defMult=Math.max(defMult,1.3);
    });
  });
  return {hp1,str1,vit1,spd1,luk1,hpup,strup,vitup,weaponAtk,shieldDef,
          totalAtk:Math.round(weaponAtk*atkMult+str1),
          totalDef:Math.round(shieldDef*defMult+vit1),
          totalHp:Math.round(hp1*hpBoost), rareFlags};
}
function computeRating(s){ return Math.round(s.totalAtk*2+s.totalDef*2+s.totalHp*0.5); }

// ===================== 危険度 =====================
function dangerLabel(dungeonId) {
  const s=computePlayerStats();
  const pp=s.totalAtk+s.totalDef+s.totalHp*0.3;
  const bosses=GAME_DATA.monsters.filter(m=>m.dungeon===dungeonId&&m.kind==='ボス');
  if(!bosses.length) return {label:'？',cls:'danger-caution'};
  const wm=1+state.worldLevel*0.5;
  const b=bosses[0];
  const bp2=b.atk*wm+b.def*wm+b.hp*wm*0.3;
  const r=pp/bp2;
  if(r>=2.0) return {label:'安全',cls:'danger-safe'};
  if(r>=1.2) return {label:'注意',cls:'danger-caution'};
  if(r>=0.7) return {label:'危険',cls:'danger-danger'};
  return {label:'自殺行為',cls:'danger-suicide'};
}

// ===================== 探索ロジック =====================
// currentExplore: 現在進行中の探索セッション
// { dungeonId, dungeonName, floors, floorIndex, battles:[], drops:[], finished, dead, cleared, retreated, startTime }
function startExplore(dungeonId) {
  const d = GAME_DATA.dungeons.find(x=>x.id===dungeonId);
  currentExplore = {
    dungeonId, dungeonName:d.name, floors:d.floors,
    floorIndex:1, battles:[], drops:[], allDrops:[],
    finished:false, dead:false, cleared:false, retreated:false,
    startTime: new Date().toISOString()
  };
  document.getElementById('explorePanel').classList.remove('hidden');
  document.getElementById('exploreDungeonName').textContent = d.name;
  document.getElementById('currentExploreLog').innerHTML = '';
  updateExploreUI();
}

function getEnemyForFloor(dungeonId, floorIndex, totalFloors) {
  const pool = GAME_DATA.monsters.filter(m=>m.dungeon===dungeonId);
  const isBoss = floorIndex>=totalFloors;
  const cands = pool.filter(m=>isBoss?m.kind==='ボス':m.kind==='雑魚');
  return cands.length ? cands[Math.floor(Math.random()*cands.length)] : pool[0];
}

function runOneTurn() {
  if (!currentExplore || currentExplore.finished) return;
  const ex = currentExplore;
  const dungeonId = ex.dungeonId;
  const enemyDef = getEnemyForFloor(dungeonId, ex.floorIndex, ex.floors);
  const wm = 1+state.worldLevel*0.5;
  const enemy = {
    name:enemyDef.name,
    hp:Math.round(enemyDef.hp*wm),
    atk:Math.round(enemyDef.atk*wm),
    def:Math.round(enemyDef.def*wm),
    spd:enemyDef.spd
  };

  const ps = computePlayerStats();
  let curEnemyHp = enemy.hp;
  let curPlayerHp = ps.totalHp;
  const playerFirst = ps.rareFlags['先制'] || ps.spd1 >= enemy.spd;
  const actions = [];

  function pAtk() {
    const fc = !!ps.rareFlags['一撃'];
    const {dmg,isKaishin} = calcDamage(ps.totalAtk, enemy.def, fc);
    curEnemyHp -= dmg;
    actions.push({side:'player',dmg,isKaishin,hpLeft:Math.max(0,curEnemyHp)});
    if (ps.rareFlags['二撃']) {
      const {dmg:d2,isKaishin:ik2} = calcDamage(ps.totalAtk, enemy.def, fc);
      curEnemyHp -= d2;
      actions.push({side:'player',dmg:d2,isKaishin:ik2,second:true,hpLeft:Math.max(0,curEnemyHp)});
    }
  }
  function eAtk() {
    const {dmg,isKaishin} = calcDamage(enemy.atk, ps.totalDef);
    curPlayerHp -= dmg;
    actions.push({side:'enemy',dmg,isKaishin,hpLeft:Math.max(0,curPlayerHp)});
  }

  let rounds=0;
  while (curEnemyHp>0 && curPlayerHp>0 && rounds<200) {
    if(playerFirst){pAtk();if(curEnemyHp<=0)break;eAtk();}
    else{eAtk();if(curPlayerHp<=0)break;pAtk();}
    rounds++;
  }

  const battle = { floor:ex.floorIndex, enemyName:enemy.name, actions, drops:[], result:null };

  if (curPlayerHp<=0) {
    battle.result = 'dead';
    ex.dead = true;
    ex.finished = true;
  } else {
    battle.result = 'win';
    // ドロップ
    const cands=[enemyDef.drop1,enemyDef.drop2].filter(Boolean);
    if(cands.length && Math.random()<0.6) {
      const name=cands[Math.floor(Math.random()*cands.length)];
      const w=GAME_DATA.weapons.find(x=>x.name===name);
      const s=GAME_DATA.shields.find(x=>x.name===name);
      const r=GAME_DATA.rings.find(x=>x.name===name);
      if(w||s||r){
        const cat=w?'weapon':s?'shield':'ring';
        const def=w||s||r;
        const corr=rollCorruption(state.worldLevel);
        const item=createDroppedItem(cat,def.id,corr);
        state.inventory.push(item);
        const drop={name,category:cat,corruption:corr};
        battle.drops.push(drop);
        ex.allDrops.push(drop);
      }
    }
    if(Math.random()<0.25){
      const mat=GAME_DATA.enhanceMaterials[Math.floor(Math.random()*3)];
      const cnt=1+Math.floor(Math.random()*2);
      addMaterial(mat.id,cnt);
      const drop={name:mat.name+' ×'+cnt,category:'material'};
      battle.drops.push(drop);
      ex.allDrops.push(drop);
    }

    ex.floorIndex++;
    if(ex.floorIndex>ex.floors){
      ex.finished=true;
      ex.cleared=true;
      state.clearedDungeons[dungeonId]=true;
      saveGame();
      if(allDungeonsCleared()) showToast('全ダンジョン制覇！瘴気濃度を上げられます。');
    }
  }

  ex.battles.push(battle);
  updateExploreUI();
  appendBattleToCurrentLog(battle);

  if(ex.finished) {
    finalizeExploreLog(ex);
    saveGame();
    if(ex.cleared) renderDungeonList();
  }
}

function retreatExplore() {
  if(!currentExplore||currentExplore.finished) return;
  currentExplore.finished=true;
  currentExplore.retreated=true;
  finalizeExploreLog(currentExplore);
  saveGame();
  updateExploreUI();
}

// 探索終了時にグローバルログに1件追加（探索丸ごとが1エントリ）
function finalizeExploreLog(ex) {
  const entry = {
    dungeonId: ex.dungeonId,
    dungeonName: ex.dungeonName,
    startTime: ex.startTime,
    endTime: new Date().toISOString(),
    floorsReached: ex.floorIndex - (ex.cleared?1:0),
    totalFloors: ex.floors,
    battles: ex.battles,
    allDrops: ex.allDrops,
    result: ex.dead?'dead':ex.cleared?'cleared':ex.retreated?'retreated':'incomplete',
  };
  state.dungeonLogs.unshift(entry);
  if(state.dungeonLogs.length>10) state.dungeonLogs.length=10;
}

function updateExploreUI() {
  const ex = currentExplore; if(!ex) return;
  const pct = Math.min(100,(ex.floorIndex/ex.floors)*100);
  document.getElementById('exploreProgress').style.width=pct+'%';
  document.getElementById('exploreFloor').textContent=`${Math.min(ex.floorIndex,ex.floors)}/${ex.floors}階`;

  let txt=`${ex.floorIndex}階を探索中`;
  if(ex.dead) txt='全滅…この探索で得たアイテムをすべて失った';
  else if(ex.retreated) txt='途中帰還した';
  else if(ex.cleared) txt='ボスを撃破！次のダンジョンが解放された';
  else if(ex.finished) txt='最深部に到達！';
  document.getElementById('exploreStatus').textContent=txt;

  document.getElementById('btnNextStep').disabled=ex.finished;
  document.getElementById('btnRetreat').disabled=ex.finished;
  renderTopBar();
}

// ダンジョン画面の「現在の探索ログ」（戦闘ごとに追記）
function appendBattleToCurrentLog(battle) {
  const el=document.getElementById('currentExploreLog'); if(!el) return;
  const div=document.createElement('div');
  div.className='log-entry';
  const dropSummary=battle.drops.filter(d=>d.category!=='material').map(d=>{
    const r=rarityOf(d.corruption);
    return `<span class="${r.cls}">★${d.name}</span>`;
  }).join(' ');
  const icon = battle.result==='dead'?'💀':battle.floor>=currentExplore?.floors?'👑':'⚔';
  div.innerHTML=`<span class="t">${icon} ${battle.floor}F</span> ${battle.enemyName}を${ battle.result==='dead'?'<span style="color:var(--danger)">倒せなかった</span>':'倒した'} ${dropSummary}`;
  div.onclick=()=>showBattleDetail(battle);
  el.appendChild(div);
}

// ===================== Toast =====================
function showToast(msg) {
  let t=document.getElementById('toast');
  if(!t){t=document.createElement('div');t.id='toast';t.style='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#7c6df0;color:#fff;padding:8px 16px;border-radius:20px;z-index:100;font-size:13px;pointer-events:none;transition:opacity .4s;';document.body.appendChild(t);}
  t.textContent=msg; t.style.opacity='1';
  clearTimeout(t._timer); t._timer=setTimeout(()=>{t.style.opacity='0';},2500);
}

// ===================== DUNGEON画面 =====================
function renderDungeonList() {
  document.getElementById('worldLevelWrapper')?.remove();
  const parent=document.getElementById('dungeonList').parentElement;
  const wrap=document.createElement('div');
  wrap.id='worldLevelWrapper'; wrap.style='margin-bottom:10px;';
  const cleared=allDungeonsCleared();
  wrap.innerHTML=`<div class="row">
    <span style="font-size:13px;">瘴気濃度：<b style="color:var(--gold)">${state.worldLevel}</b></span>
    ${cleared?`<button class="small gold" id="btnUpWL">瘴気濃度を上げる</button>`:`<span class="muted">全制覇で上昇可</span>`}
    <button class="small secondary" id="btnReset">リセット</button>
  </div>`;
  parent.insertBefore(wrap,document.getElementById('dungeonList'));
  document.getElementById('btnReset')?.addEventListener('click',resetGame);
  document.getElementById('btnUpWL')?.addEventListener('click',()=>{
    state.worldLevel++; state.clearedDungeons={}; saveGame(); renderDungeonList();
    showToast(`瘴気濃度が${state.worldLevel}になった！侵食度付きアイテムが出る`);
  });

  const el=document.getElementById('dungeonList');
  el.innerHTML='';
  GAME_DATA.dungeons.slice().sort((a,b)=>a.id-b.id).forEach(d=>{
    if(!isDungeonUnlocked(d.id)) return;  // 未解放は非表示
    const dl=dangerLabel(d.id);
    const isCleared=!!state.clearedDungeons[d.id];
    const div=document.createElement('div');
    div.className='dungeon-item';
    div.innerHTML=`<div>
      <div style="font-weight:600;">${d.id}. ${d.name}${isCleared?' ✓':''}</div>
      <div class="muted">全${d.floors}階</div>
    </div>
    <span class="danger-label ${dl.cls}">${dl.label}</span>`;
    div.onclick=()=>startExplore(d.id);
    el.appendChild(div);
  });
}

// ===================== LOG画面（探索単位、過去10件） =====================
function renderLogList() {
  const el=document.getElementById('logList');
  el.innerHTML='';
  const logs=state.dungeonLogs||[];
  if(!logs.length){el.innerHTML='<p class="muted">まだ記録がありません。</p>';return;}
  logs.forEach(entry=>{
    const div=document.createElement('div');
    div.className='log-entry';
    const t=entry.startTime?new Date(entry.startTime).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'--:--';
    const icon=entry.result==='cleared'?'👑':entry.result==='dead'?'💀':'🏃';
    const resultTxt=entry.result==='cleared'?`制覇（${entry.totalFloors}階）`:entry.result==='dead'?`全滅（${entry.floorsReached}/${entry.totalFloors}階）`:`撤退（${entry.floorsReached}/${entry.totalFloors}階）`;
    div.innerHTML=`<span class="t">${t}</span>${icon} ${entry.dungeonName} ${resultTxt}`;
    div.onclick=()=>showExploreLogDetail(entry);
    el.appendChild(div);
  });
}

// 探索ログ詳細（全戦闘を表示）
function showExploreLogDetail(entry) {
  const modal=document.getElementById('modalRoot');
  const battlesHtml=(entry.battles||[]).map(b=>{
    const icon=b.result==='dead'?'💀':b.floor>=entry.totalFloors?'👑':'⚔';
    const drops=b.drops.filter(d=>d.category!=='material').map(d=>{
      const r=rarityOf(d.corruption); return `<span class="${r.cls}">★${d.name}[${r.label}]</span>`;
    }).join(' ');
    return `<div class="log-entry" data-battle-idx="${entry.battles.indexOf(b)}">${icon} ${b.floor}F ${b.enemyName}を${b.result==='dead'?'<span style="color:var(--danger)">倒せなかった</span>':'倒した'} ${drops}</div>`;
  }).join('');
  modal.innerHTML=`<div class="modal-overlay" id="exploreLogO">
    <div class="modal">
      <div class="modal-header"><h3 style="margin:0">${entry.dungeonName} 探索記録</h3><span class="close-x" id="closeEL">✕</span></div>
      <div class="muted" style="margin-bottom:8px;">${entry.result==='cleared'?'👑制覇':entry.result==='dead'?'💀全滅':'🏃撤退'} ${entry.floorsReached}/${entry.totalFloors}階</div>
      ${battlesHtml}
    </div>
  </div>`;
  document.getElementById('closeEL').onclick=()=>modal.innerHTML='';
  document.getElementById('exploreLogO').onclick=e=>{if(e.target.id==='exploreLogO')modal.innerHTML='';};
  // 各戦闘をタップで個別詳細
  modal.querySelectorAll('[data-battle-idx]').forEach(el=>{
    el.onclick=e=>{
      e.stopPropagation();
      showBattleDetail(entry.battles[parseInt(el.dataset.battleIdx)]);
    };
  });
}

// 個別戦闘詳細
function showBattleDetail(battle) {
  const modal=document.getElementById('modalRoot');
  const actHtml=(battle.actions||[]).map(a=>{
    if(a.side==='player'){
      const tag=a.isKaishin?'会心の一撃！':a.second?'二撃目':'';
      return `<div class="log-entry">あなたの攻撃${tag?`（${tag}）`:''}：${battle.enemyName}に${a.dmg}ダメージ（残り${a.hpLeft}）</div>`;
    }
    return `<div class="log-entry">${a.isKaishin?'痛恨の一撃！':''}${battle.enemyName}の攻撃：あなたに${a.dmg}ダメージ（残り${a.hpLeft}）</div>`;
  }).join('');
  const dropHtml=(battle.drops||[]).map(d=>{
    if(d.category==='material') return `<div class="log-entry">🔧${d.name}を入手</div>`;
    const r=rarityOf(d.corruption);
    return `<div class="log-entry">★${categoryLabel(d.category)}「<span class="${r.cls}">${d.name}</span>」入手 [${r.label}] 侵食度${d.corruption}</div>`;
  }).join('')||'<div class="muted" style="padding:4px 8px">ドロップなし</div>';
  const resHtml=battle.result==='dead'
    ?`<div class="log-entry" style="color:var(--danger)">全滅した…</div>`
    :`<div class="log-entry">${battle.enemyName}を倒した</div>`;

  modal.innerHTML=`<div class="modal-overlay" id="battleO">
    <div class="modal centered">
      <div class="modal-header"><h3 style="margin:0">${battle.floor}階 vs ${battle.enemyName}</h3><span class="close-x" id="closeBattle">✕</span></div>
      ${actHtml}${resHtml}${dropHtml}
    </div>
  </div>`;
  document.getElementById('closeBattle').onclick=()=>modal.innerHTML='';
  document.getElementById('battleO').onclick=e=>{if(e.target.id==='battleO')modal.innerHTML='';};
}

// ===================== ITEM画面 =====================
let currentItemFilter='weapon';
document.querySelectorAll('#itemCategoryTabs button').forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll('#itemCategoryTabs button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentItemFilter=btn.dataset.cat;
    renderItemList();
  };
});
document.getElementById('btnOpenAnalysis').onclick=openAnalysisModal;

function itemDisplayName(item) {
  return findEquipDef(item.category,item.defId)?.name||'???';
}

function renderItemCard(item) {
  const def=findEquipDef(item.category,item.defId); if(!def) return null;
  const isEquipped=state.equipped[item.category]===item.uid;
  const r=rarityOf(item.corruption);
  const div=document.createElement('div');
  div.className='item-card'+(isEquipped?' equipped':'')+(item.justEvolved?' flash-evolve':'');
  item.justEvolved=false;
  const alv=item.analysisLv;
  const statLine=(alv>=2&&item.category!=='ring')
    ?(item.category==='weapon'?`ATK:${def.atk+item.enhanceLv+corruptionBonus(item)}`:`DEF:${def.def+item.enhanceLv+corruptionBonus(item)}`):'';
  const capLine=alv>=1&&item.category!=='ring'
    ?`<div class="muted">強化 +${item.enhanceLv}/${enhanceCapFor(item)}</div>`:'';
  const evoLine=alv>=3&&def.evolvesTo
    ?`<div class="muted">進化先: ${findEquipDef(item.category,def.evolvesTo)?.name||'?'}</div>`:'';
  const abHtml=item.abilities.map(ab=>
    `<span class="ability-tag${ab.rare?' rare':''}">${ab.name}${ab.rare?'':' Lv'+ab.lv}</span>`
  ).join('');
  const need=expNeededForLevel(alv+1);
  const epct=Math.min(100,(item.analysisExp/need)*100);
  div.innerHTML=`<div class="row">
    <span class="item-name ${state.worldLevel>0?r.cls:''}">${isEquipped?'【E】':''}${itemDisplayName(item)}${statLine?` (${statLine})`:''}</span>
    <button class="small ${isEquipped?'secondary':''}" data-equip="${item.uid}" data-cat="${item.category}">${isEquipped?'解除':'装備'}</button>
  </div>
  <div class="muted">解析Lv${alv}${state.worldLevel>0?` <span class="corrupt-badge">侵食度${item.corruption}</span>`:''} <span style="color:var(--text-dim);font-size:11px;">${item.analysisExp}/${need}EXP</span></div>
  <div style="height:3px;background:var(--panel2);border-radius:3px;overflow:hidden;margin:2px 0 4px;"><div style="height:100%;width:${epct}%;background:var(--accent);"></div></div>
  ${capLine}${evoLine}<div>${abHtml}</div>`;
  return div;
}

function renderItemList() {
  const el=document.getElementById('itemList');
  el.innerHTML='';
  const items=state.inventory.filter(it=>it.category===currentItemFilter).sort((a,b)=>b.corruption-a.corruption);
  if(!items.length){el.innerHTML='<p class="muted">まだ装備がありません。</p>';return;}
  items.forEach(item=>{
    const card=renderItemCard(item); if(!card) return;
    card.onclick=e=>{
      if(e.target.dataset.equip) return;
      openItemDetail(item.uid);
    };
    card.querySelectorAll('[data-equip]').forEach(btn=>{
      btn.onclick=e=>{
        e.stopPropagation();
        const cat=btn.dataset.cat; const uid=btn.dataset.equip;
        state.equipped[cat]=state.equipped[cat]===uid?null:uid;
        saveGame(); renderItemList(); renderStatusScreen(); renderDungeonList(); renderTopBar();
      };
    });
    el.appendChild(card);
  });
}

function renderMaterialGrid() {
  const el=document.getElementById('materialGrid');
  el.innerHTML='';
  let any=false;
  GAME_DATA.enhanceMaterials.forEach(m=>{
    const cnt=state.materials[m.id]||0; if(!cnt) return;
    any=true;
    const div=document.createElement('div');
    div.className='mat-card';
    div.innerHTML=`<div>${m.name}</div><div class="cnt">×${cnt}</div><div class="muted">+${m.value}</div>`;
    el.appendChild(div);
  });
  if(!any) el.innerHTML='<p class="muted">強化素材がありません。</p>';
}

function openItemDetail(uid) {
  const item=state.inventory.find(it=>it.uid===uid);
  const def=findEquipDef(item.category,item.defId);
  const modal=document.getElementById('modalRoot');
  modal.innerHTML=`<div class="modal-overlay" id="detailO">
    <div class="modal centered">
      <div class="modal-header"><h3 style="margin:0">${def?.name}</h3><span class="close-x" id="closeDetail">✕</span></div>
      <div class="exp-bar-bg" style="margin-bottom:6px;"><div class="exp-bar-fill" style="width:${Math.min(100,item.analysisExp/expNeededForLevel(item.analysisLv+1)*100)}%;"></div></div>
      <p class="muted">解析Lv${item.analysisLv}（次まで ${item.analysisExp}/${expNeededForLevel(item.analysisLv+1)} EXP）</p>
      ${item.category!=='ring'?`<button class="small full" id="btnOpenEnh">強化する</button>`:'<p class="muted">指輪は強化できません</p>'}
    </div>
  </div>`;
  document.getElementById('closeDetail').onclick=()=>modal.innerHTML='';
  document.getElementById('detailO').onclick=e=>{if(e.target.id==='detailO')modal.innerHTML='';};
  document.getElementById('btnOpenEnh')?.addEventListener('click',()=>{modal.innerHTML='';openEnhanceModal(uid);});
}

// ===================== 強化モーダル =====================
function openEnhanceModal(uid) {
  const item=state.inventory.find(it=>it.uid===uid);
  const def=findEquipDef(item.category,item.defId);
  const cap=enhanceCapFor(item);
  const pct=Math.min(100,(item.enhanceLv/Math.max(1,cap))*100);
  const modal=document.getElementById('modalRoot');
  const opts=GAME_DATA.enhanceMaterials.map(m=>{
    const have=state.materials[m.id]||0;
    return `<option value="${m.id}" ${have<=0?'disabled':''}>${m.name}（+${m.value}） 所持${have}個</option>`;
  }).join('');
  modal.innerHTML=`<div class="modal-overlay" id="enhO">
    <div class="modal centered">
      <div class="modal-header"><h3 style="margin:0">${def?.name}を強化</h3><span class="close-x" id="closeEnh">✕</span></div>
      <div class="enhance-bar-bg" style="margin-bottom:10px;"><div class="enhance-bar-fill" style="width:${pct}%;"></div><div class="enhance-bar-text">+${item.enhanceLv} / ${cap}</div></div>
      <div class="row" style="gap:6px;margin-bottom:10px;">
        <select id="enhMatSel" style="flex:2;">${opts}</select>
        <input type="number" id="enhCnt" value="1" min="1" style="flex:1;background:var(--panel2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px;font-size:13px;">
      </div>
      <button class="full gold" id="btnDoEnh">強化する</button>
      ${def?.evolvesTo?'<p class="muted" style="margin-top:8px;">上限まで強化すると進化する可能性があります</p>':''}
    </div>
  </div>`;
  document.getElementById('closeEnh').onclick=()=>modal.innerHTML='';
  document.getElementById('enhO').onclick=e=>{if(e.target.id==='enhO')modal.innerHTML='';};
  document.getElementById('btnDoEnh').onclick=()=>{
    const matId=document.getElementById('enhMatSel').value;
    const cnt=parseInt(document.getElementById('enhCnt').value)||1;
    const result=enhanceItem(uid,matId,cnt);
    if(result){
      modal.innerHTML='';
      renderItemList(); renderMaterialGrid(); renderStatusScreen();
      if(item.justEvolved) showToast(`${findEquipDef(item.category,item.defId)?.name}に進化した！`);
    } else alert('強化できません（素材不足または上限到達）');
  };
}

// ===================== 解析モーダル（複数素材選択・見やすいUI） =====================
let analysisSel = { target: null, materials: new Set() };
function openAnalysisModal() {
  analysisSel = { target: null, materials: new Set() };
  renderAnalysisModal();
}
function renderAnalysisModal() {
  const modal=document.getElementById('modalRoot');
  const allItems=state.inventory.slice().sort((a,b)=>b.corruption-a.corruption);
  const target=analysisSel.target?state.inventory.find(it=>it.uid===analysisSel.target):null;

  // ① 解析対象選択（装備カテゴリ別・見やすく）
  function targetSection() {
    const byCategory = { weapon:[], shield:[], ring:[] };
    allItems.forEach(it=>byCategory[it.category].push(it));
    return ['weapon','shield','ring'].map(cat=>{
      if(!byCategory[cat].length) return '';
      return `<div style="margin-bottom:8px;">
        <div class="muted" style="font-size:11px;margin-bottom:4px;">${categoryLabel(cat)}</div>
        ${byCategory[cat].map(it=>{
          const def=findEquipDef(it.category,it.defId);
          const r=rarityOf(it.corruption);
          const isSel=analysisSel.target===it.uid;
          return `<div class="item-card ${isSel?'selected':''}" data-mode="target" data-uid="${it.uid}" style="margin-bottom:4px;padding:8px 10px;">
            <div class="row">
              <span class="item-name ${state.worldLevel>0?r.cls:''}">${def?.name||'?'}</span>
              <span class="muted">解析Lv${it.analysisLv} | ${it.analysisExp}/${expNeededForLevel(it.analysisLv+1)}EXP</span>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');
  }

  // ② 素材選択（同じ装備のみ・複数選択可）
  function materialSection() {
    if(!target) return '';
    const cands=allItems.filter(it=>canUseAsAnalysisMaterial(target,it));
    if(!cands.length) return '<p class="muted">素材にできる同じ装備がありません（装備中は使用不可）</p>';
    const totalExp=[...analysisSel.materials].reduce((sum,uid)=>{
      const mat=state.inventory.find(it=>it.uid===uid);
      return sum+(mat?rarityOf(mat.corruption).expGain:0);
    },0);
    return `<div style="margin-bottom:6px;" class="muted">選択中：${analysisSel.materials.size}個（合計EXP+${totalExp}）</div>
    ${cands.map(it=>{
      const def=findEquipDef(it.category,it.defId);
      const r=rarityOf(it.corruption);
      const isSel=analysisSel.materials.has(it.uid);
      return `<div class="item-card ${isSel?'selected':''}" data-mode="material" data-uid="${it.uid}" style="margin-bottom:4px;padding:8px 10px;">
        <div class="row">
          <span class="${r.cls}">${def?.name||'?'} <span class="corrupt-badge">[${r.label}] +${r.expGain}EXP</span></span>
          <span class="muted">侵食度${it.corruption}</span>
        </div>
      </div>`;
    }).join('')}`;
  }

  const mats=[...analysisSel.materials];
  const totalExpPreview=mats.reduce((sum,uid)=>{
    const mat=state.inventory.find(it=>it.uid===uid);
    return sum+(mat?rarityOf(mat.corruption).expGain:0);
  },0);

  modal.innerHTML=`<div class="modal-overlay" id="analysisO">
    <div class="modal">
      <div class="modal-header"><h3 style="margin:0">解析</h3><span class="close-x" id="closeAna">✕</span></div>
      <div style="display:flex;gap:0;flex-direction:column;height:calc(80vh - 100px);overflow:hidden;">
        <!-- 上半分：解析対象 -->
        <div style="flex:1;overflow-y:auto;border-bottom:1px solid var(--border);padding-bottom:8px;">
          <h4 style="margin:0 0 6px;font-size:13px;position:sticky;top:0;background:var(--panel);padding:6px 0;">① 解析する装備${target?`：<span style="color:var(--gold)">${itemDisplayName(target)}</span>`:'（タップして選択）'}</h4>
          ${targetSection()}
        </div>
        <!-- 下半分：素材 -->
        <div style="flex:1;overflow-y:auto;padding-top:8px;">
          <h4 style="margin:0 0 6px;font-size:13px;position:sticky;top:0;background:var(--panel);padding:6px 0;">② 素材にする装備（複数選択可・装備中は不可）</h4>
          ${materialSection()}
        </div>
      </div>
      <button class="full gold" id="btnDoAna" style="margin-top:8px;" ${target&&analysisSel.materials.size>0?'':'disabled'}>解析する（EXP+${totalExpPreview}）</button>
    </div>
  </div>`;

  document.getElementById('closeAna').onclick=()=>modal.innerHTML='';
  document.getElementById('analysisO').onclick=e=>{if(e.target.id==='analysisO')modal.innerHTML='';};
  modal.querySelectorAll('[data-mode="target"]').forEach(card=>{
    card.onclick=()=>{
      analysisSel.target=card.dataset.uid;
      analysisSel.materials=new Set();
      renderAnalysisModal();
    };
  });
  modal.querySelectorAll('[data-mode="material"]').forEach(card=>{
    card.onclick=()=>{
      const uid=card.dataset.uid;
      if(analysisSel.materials.has(uid)) analysisSel.materials.delete(uid);
      else analysisSel.materials.add(uid);
      renderAnalysisModal();
    };
  });
  document.getElementById('btnDoAna')?.addEventListener('click',()=>{
    if(analyzeWithMaterials(analysisSel.target,[...analysisSel.materials])){
      modal.innerHTML='';
      renderItemList(); renderMaterialGrid(); renderStatusScreen(); renderTopBar();
      showToast('解析した！');
    }
  });
}

// ===================== STATUS画面 =====================
function renderStatusScreen() {
  const s=computePlayerStats();
  const table=document.getElementById('statusTable');
  table.innerHTML=`<tr><th>ステータス</th><th>Lv1値</th><th>LvUP</th></tr>
    <tr><td>HP</td><td>${s.hp1}</td><td>+${s.hpup}</td></tr>
    <tr><td>ATK（武器込）</td><td>${s.totalAtk}</td><td>+${s.strup}</td></tr>
    <tr><td>DEF（盾込）</td><td>${s.totalDef}</td><td>+${s.vitup}</td></tr>
    <tr><td>SPD</td><td>${s.spd1}</td><td>+1</td></tr>
    <tr><td>LUK</td><td>${s.luk1}</td><td>+0</td></tr>`;
  const ar=Object.keys(s.rareFlags).filter(k=>s.rareFlags[k]);
  if(ar.length) table.innerHTML+=`<tr><td colspan="3" class="muted">特殊：${ar.join(' / ')}</td></tr>`;

  document.getElementById('equippedList').innerHTML=['weapon','shield','ring'].map(cat=>{
    const item=getEquippedItem(cat); if(!item) return `<div class="muted">${categoryLabel(cat)}: 未装備</div>`;
    const def=findEquipDef(cat,item.defId);
    return `<div>${categoryLabel(cat)}: <b>${def?.name}</b> +${item.enhanceLv}</div>`;
  }).join('');

  renderPermanentBoostList();
  document.getElementById('topRating').textContent=computeRating(s).toLocaleString();
}

function renderPermanentBoostList() {
  document.getElementById('bpAvailable').textContent=state.bp;
  const el=document.getElementById('permanentBoostList');
  el.innerHTML=GAME_DATA.permanentBoostOptions.map(o=>`
    <div class="row" style="margin-bottom:6px;">
      <span>${o.label}（現在+${(state.permanentBoosts[o.key]||0)*o.perPoint} / 1BPごと+${o.perPoint}）</span>
      <button class="small gold" data-spend="${o.key}" ${state.bp<=0?'disabled':''}>BP消費</button>
    </div>`).join('');
  el.querySelectorAll('[data-spend]').forEach(btn=>{
    btn.onclick=()=>{spendBPOnStat(btn.dataset.spend);renderStatusScreen();};
  });

  const rareEl=document.getElementById('rareAbilityUnlockList');
  const cost=GAME_DATA.rareAbilityUnlockCost;
  const ss=Object.values(state.permanentBoosts).reduce((a,b)=>a+b,0);
  const rs=Object.values(state.rareAbilityUnlocked).filter(Boolean).length*cost;
  rareEl.innerHTML=`<p class="muted">特殊能力の永久固定化（${cost}BP）</p>`+
    GAME_DATA.rareAbilities.slice(0,8).map(name=>{
      const done=!!state.rareAbilityUnlocked[name];
      return `<div class="row" style="margin-bottom:6px;">
        <span>${name} ${done?'<span class="ability-tag rare">固定化済み</span>':''}</span>
        <button class="small gold" data-unlock="${name}" ${done||state.bp<cost?'disabled':''}>${done?'済み':`${cost}BP`}</button>
      </div>`;
    }).join('')+
    `<button class="small secondary full" id="btnRespecAll" ${ss+rs>0?'':'disabled'} style="margin-top:8px;">すべて振り直し（${ss+rs}BP回収）</button>`;
  rareEl.querySelectorAll('[data-unlock]').forEach(btn=>{
    btn.onclick=()=>{unlockRareAbility(btn.dataset.unlock);renderStatusScreen();};
  });
  document.getElementById('btnRespecAll')?.addEventListener('click',()=>{
    if(confirm('ステータスと特殊能力に振ったBPをすべて回収しますか？')){respecAll();renderStatusScreen();}
  });
}

// ===================== トップバー =====================
function renderTopBar() {
  document.getElementById('topBP').textContent=state.bp;
  const s=computePlayerStats();
  document.getElementById('topRating').textContent=computeRating(s).toLocaleString();
}

// ===================== タブ切り替え =====================
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
    document.getElementById('screen-'+btn.dataset.screen).classList.remove('hidden');
    if(btn.dataset.screen==='dungeon') renderDungeonList();
    if(btn.dataset.screen==='log') renderLogList();
    if(btn.dataset.screen==='item'){renderItemList();renderMaterialGrid();}
    if(btn.dataset.screen==='status') renderStatusScreen();
  };
});

document.getElementById('btnNextStep').onclick=runOneTurn;
document.getElementById('btnRetreat').onclick=retreatExplore;

// ===================== 初期化 =====================
function init() {
  const loaded=loadGame();
  if(!loaded){
    const sw=createDroppedItem('weapon','w_001',0);
    const ss=createDroppedItem('shield','s_001',0);
    const sr=createDroppedItem('ring','r_001',0);
    [sw,ss,sr].forEach(it=>{it.abilities=[];});
    state.inventory.push(sw,ss,sr);
    state.equipped.weapon=sw.uid;
    state.equipped.shield=ss.uid;
    state.equipped.ring=sr.uid;
    addMaterial('m_katakunaru',10);
    addMaterial('m_katakunaru_x',3);
    saveGame();
  }
  renderDungeonList();
  renderTopBar();
}
init();
