// ===================== 定数・データ =====================
const GAME_DATA = JSON.parse(document.getElementById('game-data').textContent);
const SECS_PER_FLOOR = 300; // 1階層 = 5分
const SAVE_KEY = 'whipper_v6_save';
let autoInterval = null;
let clockInterval = null;
let uidCounter = 1;

// ===================== ユーティリティ =====================
function findWeapon(id){ return GAME_DATA.weapons.find(w=>w.id===id); }
function findShield(id){ return GAME_DATA.shields.find(s=>s.id===id); }
function findRing(id){ return GAME_DATA.rings.find(r=>r.id===id); }
function findEquipDef(cat,id){
  if(cat==='weapon') return findWeapon(id);
  if(cat==='shield') return findShield(id);
  return findRing(id);
}
function catLabel(cat){ return cat==='weapon'?'武器':cat==='shield'?'盾':'指輪'; }

// ===================== ダメージ計算（仕様書準拠） =====================
function calcDmg(atk,def,forceKaishin=false){
  const prov=Math.max(0,Math.round(atk-def));
  const rand=Math.floor(Math.random()*6);
  let dmg=prov+rand;
  const isK=forceKaishin||(Math.random()<0.05);
  if(isK) dmg*=2;
  return {dmg,isK};
}

// ===================== レアリティ =====================
function rarityOf(c){
  if(c>=250) return {key:'red',  label:'赤',cls:'rarity-red',   expGain:8};
  if(c>=150) return {key:'yellow',label:'黄',cls:'rarity-yellow',expGain:4};
  if(c>=50)  return {key:'blue', label:'青',cls:'rarity-blue',  expGain:2};
  return             {key:'white',label:'白',cls:'rarity-white', expGain:1};
}

// ===================== 侵食度 =====================
function rollCorruption(wl){
  if(wl<=0) return 0;
  const bias=Math.min(0.6,wl*0.08);
  return Math.round(Math.pow(Math.random(),1-bias)*300);
}

// ===================== 解析EXP（仕様書: 1,2,4,8,16,32,40,48,56,64,64...） =====================
function expForLv(lv){
  const t=[0,1,2,4,8,16,32,40,48,56,64];
  return t[lv]??64;
}

// ===================== 限界突破 =====================
function activeEffects(item){
  return GAME_DATA.breakthroughLines.filter(l=>item.analysisLv>=l.analysisLv&&item.corruption>=l.corruption);
}
function enhanceCapBonus(item){
  let b=0;
  activeEffects(item).forEach(e=>{
    const k=item.category==='shield'?e.effectShield:e.effectWeapon;
    const m=k?.match(/強化上限アップ\+(\d+)/);
    if(m) b+=parseInt(m[1]);
  });
  return b;
}
function corruptionBonus(item){
  if(item.category==='ring') return 0;
  const x=item.analysisLv>=10&&item.corruption>=250?20:10;
  return item.corruption*x;
}

// ===================== ゲームステート =====================
function defaultState(){
  return {
    worldLevel:0, bp:0,
    permanentBoosts:{hp:0,atk:0,def:0,spd:0,luk:0},
    rareAbilityUnlocked:{},
    materials:{}, inventory:[],
    equipped:{weapon:null,shield:null,ring:null},
    clearedDungeons:{},
    dungeonLogs:[],
    // 放置用
    exploreSnapshot:null,  // 探索中のcurrentExploreスナップショット
    exploreTimestamp:null, // 最後にターンを処理したms
  };
}
let state=defaultState();
let currentExplore=null; // 一時データ（セーブに含まれる）

// ===================== セーブ／ロード =====================
function saveGame(){
  try{
    if(currentExplore&&!currentExplore.finished){
      state.exploreSnapshot=JSON.parse(JSON.stringify(currentExplore));
      state.exploreTimestamp=Date.now();
    } else {
      state.exploreSnapshot=null;
      state.exploreTimestamp=null;
    }
    localStorage.setItem(SAVE_KEY,JSON.stringify({state,uidCounter}));
  }catch(e){console.warn('save',e);}
}
function loadGame(){
  try{
    const raw=localStorage.getItem(SAVE_KEY);
    if(!raw) return false;
    const d=JSON.parse(raw);
    state=d.state;
    uidCounter=d.uidCounter||1;
    return true;
  }catch(e){console.warn('load',e);return false;}
}
function resetGame(){
  if(!confirm('セーブデータを削除してリセットしますか？')) return;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
}

// ===================== ダンジョン解放 =====================
function isDungeonUnlocked(id){
  const ids=GAME_DATA.dungeons.map(d=>d.id).sort((a,b)=>a-b);
  const idx=ids.indexOf(id);
  if(idx<=0) return true;
  return !!state.clearedDungeons[ids[idx-1]];
}
function allCleared(){
  return GAME_DATA.dungeons.every(d=>state.clearedDungeons[d.id]);
}

// ===================== 素材 =====================
function addMat(id,n){ state.materials[id]=(state.materials[id]||0)+n; }

// ===================== アイテム能力値（仕様書PDF表） =====================
const AB_BASE={
  '耐久':[5,10,15,25,40,65,105,170,275,445,500,750,1000,1500,2000,2500,3000,4000,5000,6000],
  '腕力':[5,10,15,25,40,65,105,170,275,445,500,750,1000,1500,2000,2500,3000,4000,5000,6000],
  '頑丈':[5,10,15,25,40,65,105,170,275,445,500,750,1000,1500,2000,2500,3000,4000,5000,6000],
  '機敏':[2,5,10,15,20,30,45,70,95,135,175,215,270,325,380,435,490,545,600,655],
  '幸運':[1,2,3,4,5,6,7,8],
  '体力の鍛錬':[2,4,7,11,16,25,35,50,60,70,85,95,120,150,180,210,240,270,300,330],
  '力の鍛錬':  [1,2,3,5,8,13,18,25,35,50,70,95,120,150,180,210,240,270,300,330],
  '守りの鍛錬':[1,2,3,5,8,13,18,25,35,50,70,95,120,150,180,210,240,270,300,330],
};
function abVal(name,lv){
  const t=AB_BASE[name]; if(!t) return 0;
  return t[Math.min(lv-1,t.length-1)]||0;
}
function rollAbilities(corruption){
  const ab=[];
  const canRare=corruption>=150;
  for(let i=0;i<3;i++){
    if(i===0&&canRare&&Math.random()<0.1){
      ab.push({name:GAME_DATA.rareAbilities[Math.floor(Math.random()*GAME_DATA.rareAbilities.length)],lv:1,rare:true});
    } else {
      ab.push({name:GAME_DATA.abilityPool[Math.floor(Math.random()*GAME_DATA.abilityPool.length)],lv:1+Math.floor(Math.random()*8),rare:false});
    }
  }
  return ab;
}
function createItem(cat,defId,corruption){
  return{uid:'i'+(uidCounter++),category:cat,defId,enhanceLv:0,corruption,
         abilities:rollAbilities(corruption),analysisLv:0,analysisExp:0,bpAwardedAt:0,justEvolved:false};
}

// ===================== 強化 =====================
function capFor(item){
  const def=findEquipDef(item.category,item.defId);
  return (def?.enhanceCap||0)+enhanceCapBonus(item);
}
function enhance(uid,matId,cnt){
  const item=state.inventory.find(it=>it.uid===uid);
  if(!item||item.category==='ring') return false;
  const mat=GAME_DATA.enhanceMaterials.find(m=>m.id===matId);
  const have=state.materials[matId]||0;
  if(!mat||have<cnt||cnt<=0) return false;
  const cap=capFor(item);
  const nv=Math.min(cap,item.enhanceLv+mat.value*cnt);
  if(nv===item.enhanceLv) return false;
  state.materials[matId]-=cnt;
  item.enhanceLv=nv;
  const evolved=tryEvolve(item);
  saveGame();
  return{evolved};
}
function tryEvolve(item){
  const def=findEquipDef(item.category,item.defId);
  if(!def?.evolvesTo) return false;
  if(item.enhanceLv<capFor(item)) return false;
  const carry=item.enhanceLv-capFor(item);
  item.defId=def.evolvesTo;
  item.enhanceLv=Math.max(0,carry);
  item.analysisLv=0;item.analysisExp=0;item.bpAwardedAt=0;
  item.justEvolved=true;
  return true;
}

// ===================== 解析 =====================
function addAnalysisExp(item,amount){
  item.analysisExp+=amount;
  let lv=false;
  while(true){
    const need=expForLv(item.analysisLv+1);
    if(item.analysisExp>=need){
      item.analysisExp-=need; item.analysisLv++; lv=true;
      if(item.analysisLv%5===0&&item.analysisLv>item.bpAwardedAt){
        state.bp++;item.bpAwardedAt=item.analysisLv;
        toast(`解析Lv${item.analysisLv}達成！BP+1（合計${state.bp}）`);
      }
    } else break;
  }
  return lv;
}
function canBeMaterial(target,cand){
  if(!target||!cand) return false;
  if(cand.uid===target.uid||cand.defId!==target.defId) return false;
  if(Object.values(state.equipped).includes(cand.uid)) return false;
  return true;
}
function analyzeWithMats(targetUid,matUids){
  const target=state.inventory.find(it=>it.uid===targetUid);
  if(!target||!matUids.length) return false;
  let totalExp=0;
  const valid=matUids.filter(uid=>{
    const m=state.inventory.find(it=>it.uid===uid);
    if(m&&canBeMaterial(target,m)){totalExp+=rarityOf(m.corruption).expGain;return true;}
    return false;
  });
  if(!valid.length) return false;
  addAnalysisExp(target,totalExp);
  state.inventory=state.inventory.filter(it=>!valid.includes(it.uid));
  Object.keys(state.equipped).forEach(k=>{if(valid.includes(state.equipped[k]))state.equipped[k]=null;});
  saveGame(); return true;
}

// ===================== BP =====================
function spendBP(key){
  if(state.bp<=0) return false;
  state.bp--;state.permanentBoosts[key]=(state.permanentBoosts[key]||0)+1;
  saveGame();return true;
}
function unlockRare(name){
  const cost=GAME_DATA.rareAbilityUnlockCost;
  if(state.bp<cost||state.rareAbilityUnlocked[name]) return false;
  state.bp-=cost;state.rareAbilityUnlocked[name]=true;saveGame();return true;
}
function respecAll(){
  const ss=Object.values(state.permanentBoosts).reduce((a,b)=>a+b,0);
  const rs=Object.values(state.rareAbilityUnlocked).filter(Boolean).length*GAME_DATA.rareAbilityUnlockCost;
  if(ss+rs<=0) return false;
  state.bp+=ss+rs;
  Object.keys(state.permanentBoosts).forEach(k=>state.permanentBoosts[k]=0);
  Object.keys(state.rareAbilityUnlocked).forEach(k=>state.rareAbilityUnlocked[k]=false);
  saveGame();return true;
}

// ===================== ステータス計算 =====================
function getEquipped(cat){
  const uid=state.equipped[cat];
  return uid?state.inventory.find(it=>it.uid===uid):null;
}
function calcStats(){
  const bs=GAME_DATA.baseStats;
  let hp1=bs.hp,str1=bs.str,vit1=bs.vit,spd1=bs.spd,luk1=bs.luk;
  let hpup=GAME_DATA.growthStats.hp,strup=GAME_DATA.growthStats.str,vitup=GAME_DATA.growthStats.vit;
  let wAtk=0,sDef=0,hpBoost=1,atkM=1,defM=1;
  const rareF={};
  const pb=state.permanentBoosts;
  GAME_DATA.permanentBoostOptions.forEach(o=>{
    const m={hp:'hp',atk:'str',def:'vit',spd:'spd',luk:'luk'};
    const s=m[o.key];
    if(s==='hp') hp1+=pb[o.key]*o.perPoint;
    else if(s==='str') str1+=pb[o.key]*o.perPoint;
    else if(s==='vit') vit1+=pb[o.key]*o.perPoint;
    else if(s==='spd') spd1+=pb[o.key]*o.perPoint;
    else if(s==='luk') luk1+=pb[o.key]*o.perPoint;
  });
  Object.keys(state.rareAbilityUnlocked).forEach(n=>{if(state.rareAbilityUnlocked[n])rareF[n]=true;});
  ['weapon','shield','ring'].forEach(cat=>{
    const item=getEquipped(cat);if(!item)return;
    const def=findEquipDef(cat,item.defId);if(!def)return;
    if(def.lv1){hp1+=def.lv1.hp||0;str1+=def.lv1.str||0;vit1+=def.lv1.vit||0;spd1+=def.lv1.spd||0;}
    if(def.lvup){strup+=def.lvup.str||0;vitup+=def.lvup.vit||0;}
    if(cat==='weapon') wAtk=(def.atk||0)+item.enhanceLv+corruptionBonus(item);
    if(cat==='shield') sDef=(def.def||0)+item.enhanceLv+corruptionBonus(item);
    item.abilities.forEach(ab=>{
      if(ab.rare){rareF[ab.name]=true;return;}
      switch(ab.name){
        case '耐久':hp1+=abVal('耐久',ab.lv);break;
        case '腕力':str1+=abVal('腕力',ab.lv);break;
        case '頑丈':vit1+=abVal('頑丈',ab.lv);break;
        case '機敏':spd1+=abVal('機敏',ab.lv);break;
        case '幸運':luk1+=abVal('幸運',ab.lv);break;
        case '体力の鍛錬':hpup+=abVal('体力の鍛錬',ab.lv);break;
        case '力の鍛錬':strup+=abVal('力の鍛錬',ab.lv);break;
        case '守りの鍛錬':vitup+=abVal('守りの鍛錬',ab.lv);break;
      }
    });
    activeEffects(item).forEach(e=>{
      const eff=cat==='shield'?e.effectShield:e.effectWeapon;if(!eff)return;
      if(eff.includes('HPブースト×1.3'))hpBoost=Math.max(hpBoost,1.3);
      if(eff.includes('攻撃力ブースト×1.3'))atkM=Math.max(atkM,1.3);
      if(eff.includes('守備力ブースト×1.3'))defM=Math.max(defM,1.3);
    });
  });
  return{hp1,str1,vit1,spd1,luk1,hpup,strup,vitup,
         wAtk,sDef,rareF,
         totalAtk:Math.round(wAtk*atkM+str1),
         totalDef:Math.round(sDef*defM+vit1),
         totalHp:Math.round(hp1*hpBoost)};
}
function rating(s){return Math.round(s.totalAtk*2+s.totalDef*2+s.totalHp*.5);}

// ===================== 危険度 =====================
function dangerOf(dngId){
  const s=calcStats();
  const pp=s.totalAtk+s.totalDef+s.totalHp*.3;
  const boss=GAME_DATA.monsters.find(m=>m.dungeon===dngId&&m.kind==='ボス');
  if(!boss) return{label:'？',cls:'danger-caution'};
  const wm=1+state.worldLevel*.5;
  const bp2=boss.atk*wm+boss.def*wm+boss.hp*wm*.3;
  const r=pp/bp2;
  if(r>=2.0)return{label:'安全',cls:'danger-safe'};
  if(r>=1.2)return{label:'注意',cls:'danger-caution'};
  if(r>=0.7)return{label:'危険',cls:'danger-danger'};
  return{label:'自殺行為',cls:'danger-suicide'};
}

// ===================== 探索ロジック =====================
function startExplore(dngId){
  const d=GAME_DATA.dungeons.find(x=>x.id===dngId);
  currentExplore={
    dungeonId:dngId,dungeonName:d.name,floors:d.floors,
    floorIndex:1,battles:[],allDrops:[],
    finished:false,dead:false,cleared:false,retreated:false,
    startTime:new Date().toISOString()
  };
  state.exploreTimestamp=Date.now();
  document.getElementById('explorePanel').classList.remove('hidden');
  document.getElementById('dungeonListCard').classList.add('hidden');
  document.getElementById('exploreDungeonName').textContent=d.name;
  document.getElementById('currentExploreLog').innerHTML='';
  saveGame();
  startTimer();
  updateExploreUI();
}

function getEnemy(dngId,floor,totalFloors){
  const pool=GAME_DATA.monsters.filter(m=>m.dungeon===dngId);
  const isBoss=floor>=totalFloors;
  const cands=pool.filter(m=>isBoss?m.kind==='ボス':m.kind==='雑魚');
  return cands.length?cands[Math.floor(Math.random()*cands.length)]:pool[0];
}

function runFloor(){
  const ex=currentExplore;
  if(!ex||ex.finished) return;
  const wm=1+state.worldLevel*.5;
  const edef=getEnemy(ex.dungeonId,ex.floorIndex,ex.floors);
  if(!edef){ex.floorIndex++;return;}
  const enemy={name:edef.name,hp:Math.round(edef.hp*wm),atk:Math.round(edef.atk*wm),def:Math.round(edef.def*wm),spd:edef.spd};
  const ps=calcStats();
  let eHp=enemy.hp,pHp=ps.totalHp;
  const first=ps.rareF['先制']||ps.spd1>=enemy.spd;
  const actions=[];

  function pAtk(){
    const fc=!!ps.rareF['一撃'];
    const{dmg,isK}=calcDmg(ps.totalAtk,enemy.def,fc);
    eHp-=dmg;actions.push({side:'p',dmg,isK,hp:Math.max(0,eHp)});
    if(ps.rareF['二撃']){
      const{dmg:d2,isK:k2}=calcDmg(ps.totalAtk,enemy.def,fc);
      eHp-=d2;actions.push({side:'p',dmg:d2,isK:k2,second:true,hp:Math.max(0,eHp)});
    }
  }
  function eAtk(){
    const{dmg,isK}=calcDmg(enemy.atk,ps.totalDef);
    pHp-=dmg;actions.push({side:'e',dmg,isK,hp:Math.max(0,pHp)});
  }

  let r=0;
  while(eHp>0&&pHp>0&&r<200){
    if(first){pAtk();if(eHp<=0)break;eAtk();}
    else{eAtk();if(pHp<=0)break;pAtk();}
    r++;
  }

  const battle={floor:ex.floorIndex,enemyName:enemy.name,actions,drops:[],result:null};

  if(pHp<=0){
    battle.result='dead';ex.dead=true;ex.finished=true;
  } else {
    battle.result='win';
    // ドロップ
    const cands=[edef.drop1,edef.drop2].filter(Boolean);
    if(cands.length&&Math.random()<0.6){
      const name=cands[Math.floor(Math.random()*cands.length)];
      const w=GAME_DATA.weapons.find(x=>x.name===name);
      const s=GAME_DATA.shields.find(x=>x.name===name);
      const rg=GAME_DATA.rings.find(x=>x.name===name);
      if(w||s||rg){
        const cat=w?'weapon':s?'shield':'ring';
        const def=w||s||rg;
        const corr=rollCorruption(state.worldLevel);
        state.inventory.push(createItem(cat,def.id,corr));
        const drop={name,category:cat,corruption:corr};
        battle.drops.push(drop);ex.allDrops.push(drop);
      }
    }
    if(Math.random()<0.25){
      const mat=GAME_DATA.enhanceMaterials[Math.floor(Math.random()*3)];
      const cnt=1+Math.floor(Math.random()*2);
      addMat(mat.id,cnt);
      const drop={name:mat.name+' ×'+cnt,category:'material'};
      battle.drops.push(drop);ex.allDrops.push(drop);
    }
    ex.floorIndex++;
    if(ex.floorIndex>ex.floors){
      ex.finished=true;ex.cleared=true;
      state.clearedDungeons[ex.dungeonId]=true;
      if(allCleared()) toast('全ダンジョン制覇！瘴気濃度を上げられます。');
    }
  }

  ex.battles.push(battle);
  appendBattleLog(battle);

  if(ex.finished){
    stopTimer();
    state.exploreSnapshot=null;state.exploreTimestamp=null;
    finalizeLog(ex);
    saveGame();
    if(ex.cleared) {renderDungeonList();}
    // 探索終了後にダンジョン一覧を再表示
    document.getElementById('dungeonListCard').classList.remove('hidden');
  }
}

function retreat(){
  if(!currentExplore||currentExplore.finished) return;
  stopTimer();
  currentExplore.finished=true;currentExplore.retreated=true;
  state.exploreSnapshot=null;state.exploreTimestamp=null;
  finalizeLog(currentExplore);
  saveGame();
  updateExploreUI();
  document.getElementById('dungeonListCard').classList.remove('hidden');
}

function finalizeLog(ex){
  const e={
    dungeonId:ex.dungeonId,dungeonName:ex.dungeonName,
    startTime:ex.startTime,endTime:new Date().toISOString(),
    floorsReached:Math.min(ex.floorIndex-(ex.cleared?1:0),ex.floors),
    totalFloors:ex.floors,battles:ex.battles,allDrops:ex.allDrops,
    result:ex.dead?'dead':ex.cleared?'cleared':ex.retreated?'retreated':'incomplete',
  };
  state.dungeonLogs.unshift(e);
  if(state.dungeonLogs.length>10)state.dungeonLogs.length=10;
}

// ===================== タイマー =====================
function startTimer(){
  stopTimer();
  // 1秒ごとに経過チェック
  autoInterval=setInterval(()=>{
    if(!currentExplore||currentExplore.finished){stopTimer();return;}
    const now=Date.now();
    const last=state.exploreTimestamp||now;
    const elapsed=(now-last)/1000;
    const due=Math.floor(elapsed/SECS_PER_FLOOR);
    if(due>=1){
      state.exploreTimestamp=last+due*SECS_PER_FLOOR*1000;
      for(let i=0;i<due;i++){
        if(currentExplore.finished) break;
        runFloor();
      }
      updateExploreUI();
    }
  },1000);
  // 残り時間表示は毎秒更新
  clockInterval=setInterval(updateReturnTime,1000);
}

function stopTimer(){
  if(autoInterval){clearInterval(autoInterval);autoInterval=null;}
  if(clockInterval){clearInterval(clockInterval);clockInterval=null;}
}

function updateReturnTime(){
  const ex=currentExplore;
  const el=document.getElementById('exploreReturnTime');
  if(!el) return;
  if(!ex||ex.finished){el.textContent='';return;}
  const remaining=Math.max(0,(ex.floors-ex.floorIndex+1)*SECS_PER_FLOOR);
  const returnAt=new Date(Date.now()+remaining*1000);
  const hhmm=returnAt.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
  const mins=Math.ceil(remaining/60);
  el.textContent=`帰還予定 ${hhmm}（残り${mins}分）`;
}

// オフライン計算（ロード時）
function resumeOffline(){
  if(!state.exploreSnapshot||!state.exploreTimestamp) return;
  const snap=state.exploreSnapshot;
  if(snap.finished) return;

  currentExplore=snap;
  const elapsed=(Date.now()-state.exploreTimestamp)/1000;
  const due=Math.floor(elapsed/SECS_PER_FLOOR);

  // UIを復元
  document.getElementById('explorePanel').classList.remove('hidden');
  document.getElementById('dungeonListCard').classList.add('hidden');
  document.getElementById('exploreDungeonName').textContent=snap.dungeonName;
  document.getElementById('currentExploreLog').innerHTML='';
  snap.battles.forEach(b=>appendBattleLog(b));

  if(due>=1){
    toast(`オフライン中に${due}階分進みました`);
    state.exploreTimestamp=state.exploreTimestamp+due*SECS_PER_FLOOR*1000;
    for(let i=0;i<due;i++){
      if(currentExplore.finished) break;
      runFloor();
    }
  }

  if(!currentExplore.finished){
    startTimer();
  } else {
    document.getElementById('dungeonListCard').classList.remove('hidden');
  }
  updateExploreUI();
}

function updateExploreUI(){
  const ex=currentExplore;if(!ex)return;
  const pct=Math.min(100,(ex.floorIndex/ex.floors)*100);
  document.getElementById('exploreProgress').style.width=pct+'%';
  document.getElementById('exploreFloor').textContent=`${Math.min(ex.floorIndex,ex.floors)}/${ex.floors}階`;
  let txt=`${ex.floorIndex}階を探索中`;
  if(ex.dead) txt='全滅…この探索で得たアイテムをすべて失った';
  else if(ex.retreated) txt='途中帰還した';
  else if(ex.cleared) txt='ボスを撃破！次のダンジョンが解放された';
  else if(ex.finished) txt='探索終了';
  document.getElementById('exploreStatus').textContent=txt;
  document.getElementById('btnRetreat').disabled=ex.finished;
  updateReturnTime();
  renderTopBar();
}

// ===================== バトルログUI =====================
function appendBattleLog(battle){
  const el=document.getElementById('currentExploreLog');if(!el)return;
  const div=document.createElement('div');
  div.className='log-entry';
  const icon=battle.result==='dead'?'💀':battle.floor>=(currentExplore?.floors||99)?'👑':'⚔';
  const drops=battle.drops.filter(d=>d.category!=='material').map(d=>{
    const r=rarityOf(d.corruption);
    return `<span class="${r.cls}">★${d.name}</span>`;
  }).join(' ');
  div.innerHTML=`<span class="t">${icon} ${battle.floor}F</span>${battle.enemyName}を${battle.result==='dead'?'<span style="color:var(--danger)">倒せなかった</span>':'倒した'} ${drops}`;
  div.onclick=()=>showBattleDetail(battle);
  el.insertBefore(div,el.firstChild);
}

// ===================== DUNGEON画面 =====================
function renderDungeonList(){
  const area=document.getElementById('worldLevelArea');
  const cl=allCleared();
  area.innerHTML=`<div class="card">
    <div class="row">
      <span>瘴気濃度：<b style="color:var(--gold)">${state.worldLevel}</b></span>
      ${cl?`<button class="small gold" id="btnUpWL">瘴気濃度を上げる</button>`:`<span class="muted">全制覇で上昇可</span>`}
      <button class="small secondary" onclick="resetGame()">リセット</button>
    </div>
  </div>`;
  document.getElementById('btnUpWL')?.addEventListener('click',()=>{
    state.worldLevel++;state.clearedDungeons={};saveGame();renderDungeonList();
    toast(`瘴気濃度が${state.worldLevel}になった！侵食度付きアイテムが出るように`);
  });

  const el=document.getElementById('dungeonList');
  el.innerHTML='';
  GAME_DATA.dungeons.slice().sort((a,b)=>a.id-b.id).forEach(d=>{
    if(!isDungeonUnlocked(d.id))return;
    const dl=dangerOf(d.id);
    const isC=!!state.clearedDungeons[d.id];
    const div=document.createElement('div');
    div.className='dungeon-item';
    // 探索中は探索中のダンジョンしか選べない
    const inProgress=currentExplore&&!currentExplore.finished;
    div.style.opacity=inProgress?'0.4':'1';
    div.innerHTML=`<div>
      <div style="font-weight:600;">${d.id}. ${d.name}${isC?' ✓':''}</div>
      <div class="muted">全${d.floors}階 / 1階${SECS_PER_FLOOR/60}分</div>
    </div>
    <span class="danger-label ${dl.cls}">${dl.label}</span>`;
    if(!inProgress) div.onclick=()=>startExplore(d.id);
    el.appendChild(div);
  });
}

// ===================== LOG画面 =====================
function renderLogList(){
  const el=document.getElementById('logList');
  el.innerHTML='';
  if(!(state.dungeonLogs||[]).length){el.innerHTML='<p class="muted">まだ記録がありません。</p>';return;}
  state.dungeonLogs.forEach(entry=>{
    const div=document.createElement('div');
    div.className='log-entry';
    const t=entry.startTime?new Date(entry.startTime).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'--:--';
    const icon=entry.result==='cleared'?'👑':entry.result==='dead'?'💀':'🏃';
    const res=entry.result==='cleared'?`制覇（${entry.totalFloors}階）`:entry.result==='dead'?`全滅（${entry.floorsReached}/${entry.totalFloors}階）`:`撤退（${entry.floorsReached}/${entry.totalFloors}階）`;
    div.innerHTML=`<span class="t">${t}</span>${icon} ${entry.dungeonName} ${res}`;
    div.onclick=()=>showExploreDetail(entry);
    el.appendChild(div);
  });
}

function showExploreDetail(entry){
  const modal=document.getElementById('modalRoot');
  const battles=(entry.battles||[]).map((b,i)=>{
    const icon=b.result==='dead'?'💀':b.floor>=entry.totalFloors?'👑':'⚔';
    const drops=b.drops.filter(d=>d.category!=='material').map(d=>{
      const r=rarityOf(d.corruption);return `<span class="${r.cls}">★${d.name}[${r.label}]</span>`;
    }).join(' ');
    return `<div class="log-entry" data-bi="${i}">${icon} ${b.floor}F ${b.enemyName}を${b.result==='dead'?'<span style="color:var(--danger)">倒せなかった</span>':'倒した'} ${drops}</div>`;
  }).join('');
  modal.innerHTML=`<div class="modal-overlay" id="expLogO">
    <div class="modal">
      <div class="modal-header"><h3 style="margin:0">${entry.dungeonName} 探索記録</h3><span class="close-x" id="closeEL">✕</span></div>
      <div class="muted" style="margin-bottom:8px;">${entry.result==='cleared'?'👑制覇':entry.result==='dead'?'💀全滅':'🏃撤退'} ${entry.floorsReached}/${entry.totalFloors}階</div>
      ${battles}
    </div>
  </div>`;
  document.getElementById('closeEL').onclick=()=>modal.innerHTML='';
  document.getElementById('expLogO').onclick=e=>{if(e.target.id==='expLogO')modal.innerHTML='';};
  modal.querySelectorAll('[data-bi]').forEach(el=>{
    el.onclick=e=>{e.stopPropagation();showBattleDetail(entry.battles[+el.dataset.bi]);};
  });
}

function showBattleDetail(battle){
  const modal=document.getElementById('modalRoot');
  const acts=(battle.actions||[]).map(a=>{
    if(a.side==='p'){
      const tag=a.isK?'会心の一撃！':a.second?'二撃目':'';
      return `<div class="log-entry">あなたの攻撃${tag?`（${tag}）`:''}：${battle.enemyName}に${a.dmg}ダメージ（残り${a.hp}）</div>`;
    }
    return `<div class="log-entry">${a.isK?'痛恨の一撃！':''}${battle.enemyName}の攻撃：あなたに${a.dmg}ダメージ（残り${a.hp}）</div>`;
  }).join('');
  const drops=(battle.drops||[]).map(d=>{
    if(d.category==='material')return `<div class="log-entry">🔧${d.name}を入手</div>`;
    const r=rarityOf(d.corruption);
    return `<div class="log-entry">★${catLabel(d.category)}「<span class="${r.cls}">${d.name}</span>」入手 [${r.label}] 侵食度${d.corruption}</div>`;
  }).join('')||'<div class="muted" style="padding:4px 8px">ドロップなし</div>';
  const res=battle.result==='dead'
    ?`<div class="log-entry" style="color:var(--danger)">全滅した…</div>`
    :`<div class="log-entry">${battle.enemyName}を倒した</div>`;
  modal.innerHTML=`<div class="modal-overlay" id="btlO">
    <div class="modal centered">
      <div class="modal-header"><h3 style="margin:0">${battle.floor}階 vs ${battle.enemyName}</h3><span class="close-x" id="closeBtl">✕</span></div>
      ${acts}${res}${drops}
    </div>
  </div>`;
  document.getElementById('closeBtl').onclick=()=>modal.innerHTML='';
  document.getElementById('btlO').onclick=e=>{if(e.target.id==='btlO')modal.innerHTML='';};
}

// ===================== ITEM画面 =====================
let itemFilter='weapon';
document.querySelectorAll('#itemCategoryTabs button').forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll('#itemCategoryTabs button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');itemFilter=btn.dataset.cat;renderItemList();
  };
});
document.getElementById('btnOpenAnalysis').onclick=openAnalysisModal;

function itemName(item){
  return findEquipDef(item.category,item.defId)?.name||'???';
}
function renderItemCard(item){
  const def=findEquipDef(item.category,item.defId);if(!def)return null;
  const isEq=state.equipped[item.category]===item.uid;
  const r=rarityOf(item.corruption);
  const div=document.createElement('div');
  div.className='item-card'+(isEq?' equipped':'')+(item.justEvolved?' flash-evolve':'');
  item.justEvolved=false;
  const alv=item.analysisLv;
  const showStat=alv>=2&&item.category!=='ring';
  const statLine=showStat?(item.category==='weapon'?`ATK:${def.atk+item.enhanceLv+corruptionBonus(item)}`:`DEF:${def.def+item.enhanceLv+corruptionBonus(item)}`):'';
  const capLine=alv>=1&&item.category!=='ring'?`<div class="muted">強化 +${item.enhanceLv}/${capFor(item)}</div>`:'';
  const evoLine=alv>=3&&def.evolvesTo?`<div class="muted">進化先: ${findEquipDef(item.category,def.evolvesTo)?.name||'?'}</div>`:'';
  const abHtml=item.abilities.map(ab=>`<span class="ability-tag${ab.rare?' rare':''}">${ab.name}${ab.rare?'':' Lv'+ab.lv}</span>`).join('');
  const need=expForLv(alv+1);
  const ep=Math.min(100,item.analysisExp/need*100);
  div.innerHTML=`<div class="row">
    <span class="item-name ${state.worldLevel>0?r.cls:''}">${isEq?'【E】':''}${itemName(item)}${statLine?` (${statLine})`:''}</span>
    <button class="small ${isEq?'secondary':''}" data-uid="${item.uid}" data-cat="${item.category}">${isEq?'解除':'装備'}</button>
  </div>
  <div class="muted">解析Lv${alv}${state.worldLevel>0?` <span class="corrupt-badge">侵食度${item.corruption}</span>`:''} <span style="color:var(--text-dim);font-size:11px;">${item.analysisExp}/${need}EXP</span></div>
  <div style="height:3px;background:var(--panel2);border-radius:3px;overflow:hidden;margin:2px 0 4px;"><div style="height:100%;width:${ep}%;background:var(--accent);"></div></div>
  ${capLine}${evoLine}<div>${abHtml}</div>`;
  return div;
}
function renderItemList(){
  const el=document.getElementById('itemList');el.innerHTML='';
  const items=state.inventory.filter(it=>it.category===itemFilter).sort((a,b)=>b.corruption-a.corruption);
  if(!items.length){el.innerHTML='<p class="muted">まだ装備がありません。</p>';return;}
  items.forEach(item=>{
    const card=renderItemCard(item);if(!card)return;
    card.onclick=e=>{if(e.target.dataset.uid)return;openItemDetail(item.uid);};
    card.querySelectorAll('[data-uid]').forEach(btn=>{
      btn.onclick=e=>{
        e.stopPropagation();
        const cat=btn.dataset.cat,uid=btn.dataset.uid;
        state.equipped[cat]=state.equipped[cat]===uid?null:uid;
        saveGame();renderItemList();renderStatusScreen();renderDungeonList();renderTopBar();
      };
    });
    el.appendChild(card);
  });
}
function renderMatGrid(){
  const el=document.getElementById('materialGrid');el.innerHTML='';
  let any=false;
  GAME_DATA.enhanceMaterials.forEach(m=>{
    const cnt=state.materials[m.id]||0;if(!cnt)return;
    any=true;
    const div=document.createElement('div');div.className='mat-card';
    div.innerHTML=`<div>${m.name}</div><div class="cnt">×${cnt}</div><div class="muted">+${m.value}</div>`;
    el.appendChild(div);
  });
  if(!any)el.innerHTML='<p class="muted">強化素材がありません。</p>';
}
function openItemDetail(uid){
  const item=state.inventory.find(it=>it.uid===uid);
  const def=findEquipDef(item.category,item.defId);
  const modal=document.getElementById('modalRoot');
  const need=expForLv(item.analysisLv+1);
  const ep=Math.min(100,item.analysisExp/need*100);
  modal.innerHTML=`<div class="modal-overlay" id="dtlO">
    <div class="modal centered">
      <div class="modal-header"><h3 style="margin:0">${def?.name}</h3><span class="close-x" id="closeDtl">✕</span></div>
      <div class="exp-bar-bg" style="margin-bottom:6px;"><div class="exp-bar-fill" style="width:${ep}%;"></div></div>
      <p class="muted">解析Lv${item.analysisLv}（次まで ${item.analysisExp}/${need} EXP）</p>
      ${item.category!=='ring'?`<button class="small full" id="btnEnh">強化する</button>`:'<p class="muted">指輪は強化できません</p>'}
    </div>
  </div>`;
  document.getElementById('closeDtl').onclick=()=>modal.innerHTML='';
  document.getElementById('dtlO').onclick=e=>{if(e.target.id==='dtlO')modal.innerHTML='';};
  document.getElementById('btnEnh')?.addEventListener('click',()=>{modal.innerHTML='';openEnhModal(uid);});
}

// ===================== 強化モーダル =====================
function openEnhModal(uid){
  const item=state.inventory.find(it=>it.uid===uid);
  const def=findEquipDef(item.category,item.defId);
  const cap=capFor(item);
  const pct=Math.min(100,item.enhanceLv/Math.max(1,cap)*100);
  const modal=document.getElementById('modalRoot');
  const opts=GAME_DATA.enhanceMaterials.map(m=>{
    const h=state.materials[m.id]||0;
    return `<option value="${m.id}" ${h<=0?'disabled':''}>${m.name}（+${m.value}） 所持${h}個</option>`;
  }).join('');
  modal.innerHTML=`<div class="modal-overlay" id="enhO">
    <div class="modal centered">
      <div class="modal-header"><h3 style="margin:0">${def?.name}を強化</h3><span class="close-x" id="closeEnh">✕</span></div>
      <div class="enhance-bar-bg" style="margin-bottom:10px;"><div class="enhance-bar-fill" style="width:${pct}%;"></div><div class="enhance-bar-text">+${item.enhanceLv} / ${cap}</div></div>
      <div class="row" style="gap:6px;margin-bottom:10px;">
        <select id="enhMat" style="flex:2;">${opts}</select>
        <input type="number" id="enhCnt" value="1" min="1" style="flex:1;">
      </div>
      <button class="full gold" id="btnDoEnh">強化する</button>
      ${def?.evolvesTo?'<p class="muted" style="margin-top:8px;">上限まで強化すると進化する可能性があります</p>':''}
    </div>
  </div>`;
  document.getElementById('closeEnh').onclick=()=>modal.innerHTML='';
  document.getElementById('enhO').onclick=e=>{if(e.target.id==='enhO')modal.innerHTML='';};
  document.getElementById('btnDoEnh').onclick=()=>{
    const matId=document.getElementById('enhMat').value;
    const cnt=parseInt(document.getElementById('enhCnt').value)||1;
    const res=enhance(uid,matId,cnt);
    if(res){
      modal.innerHTML='';
      renderItemList();renderMatGrid();renderStatusScreen();
      if(item.justEvolved)toast(`${findEquipDef(item.category,item.defId)?.name}に進化した！`);
    } else alert('強化できません（素材不足または上限到達）');
  };
}

// ===================== 解析モーダル（複数素材・2段構成） =====================
let anaSel={target:null,mats:new Set()};
function openAnalysisModal(){anaSel={target:null,mats:new Set()};renderAnaModal();}
function renderAnaModal(){
  const modal=document.getElementById('modalRoot');
  const allItems=state.inventory.slice().sort((a,b)=>b.corruption-a.corruption);
  const target=anaSel.target?state.inventory.find(it=>it.uid===anaSel.target):null;

  const bycat={weapon:[],shield:[],ring:[]};
  allItems.forEach(it=>bycat[it.category].push(it));
  const targetSec=['weapon','shield','ring'].map(cat=>{
    if(!bycat[cat].length)return'';
    return`<div style="margin-bottom:8px;"><div class="muted" style="font-size:11px;margin-bottom:4px;">${catLabel(cat)}</div>
    ${bycat[cat].map(it=>{
      const def=findEquipDef(it.category,it.defId);
      const r=rarityOf(it.corruption);
      const sel=anaSel.target===it.uid;
      return`<div class="item-card ${sel?'selected':''}" data-t="${it.uid}" style="margin-bottom:4px;padding:8px 10px;">
        <div class="row"><span class="item-name ${state.worldLevel>0?r.cls:''}">${def?.name||'?'}</span>
        <span class="muted">Lv${it.analysisLv} | ${it.analysisExp}/${expForLv(it.analysisLv+1)}EXP</span></div>
      </div>`;
    }).join('')}</div>`;
  }).join('');

  const matSec=()=>{
    if(!target)return'';
    const cands=allItems.filter(it=>canBeMaterial(target,it));
    if(!cands.length)return'<p class="muted">素材にできる同じ装備がありません（装備中は使用不可）</p>';
    const totalExp=[...anaSel.mats].reduce((s,uid)=>{
      const m=state.inventory.find(it=>it.uid===uid);
      return s+(m?rarityOf(m.corruption).expGain:0);
    },0);
    return`<div class="muted" style="margin-bottom:6px;">選択中：${anaSel.mats.size}個（合計EXP+${totalExp}）</div>
    ${cands.map(it=>{
      const r=rarityOf(it.corruption);
      const sel=anaSel.mats.has(it.uid);
      return`<div class="item-card ${sel?'selected':''}" data-m="${it.uid}" style="margin-bottom:4px;padding:8px 10px;">
        <div class="row"><span class="${r.cls}">${itemName(it)} <span class="corrupt-badge">[${r.label}] +${r.expGain}EXP</span></span>
        <span class="muted">侵食度${it.corruption}</span></div>
      </div>`;
    }).join('')}`;
  };

  const totalExp=[...anaSel.mats].reduce((s,uid)=>{
    const m=state.inventory.find(it=>it.uid===uid);
    return s+(m?rarityOf(m.corruption).expGain:0);
  },0);

  modal.innerHTML=`<div class="modal-overlay" id="anaO">
    <div class="modal">
      <div class="modal-header"><h3 style="margin:0">解析</h3><span class="close-x" id="closeAna">✕</span></div>
      <p class="muted" style="margin:0 0 8px;">① 解析する装備を選ぶ → ② 同じ装備を素材に選ぶ（複数可・装備中は不可）</p>
      <div style="display:flex;flex-direction:column;gap:0;max-height:calc(80vh - 140px);overflow:hidden;">
        <div style="flex:1;overflow-y:auto;border-bottom:1px solid var(--border);padding-bottom:8px;">
          <div class="muted" style="font-size:11px;margin-bottom:6px;position:sticky;top:0;background:var(--panel);">① 解析する装備${target?`：<b style="color:var(--gold)">${itemName(target)}</b>`:'（タップして選択）'}</div>
          ${targetSec}
        </div>
        <div style="flex:1;overflow-y:auto;padding-top:8px;">
          <div class="muted" style="font-size:11px;margin-bottom:6px;position:sticky;top:0;background:var(--panel);">② 素材にする装備</div>
          ${matSec()}
        </div>
      </div>
      <button class="full gold" id="btnDoAna" style="margin-top:8px;" ${target&&anaSel.mats.size>0?'':'disabled'}>解析する（EXP+${totalExp}）</button>
    </div>
  </div>`;
  document.getElementById('closeAna').onclick=()=>modal.innerHTML='';
  document.getElementById('anaO').onclick=e=>{if(e.target.id==='anaO')modal.innerHTML='';};
  modal.querySelectorAll('[data-t]').forEach(c=>{
    c.onclick=()=>{anaSel.target=c.dataset.t;anaSel.mats=new Set();renderAnaModal();};
  });
  modal.querySelectorAll('[data-m]').forEach(c=>{
    c.onclick=()=>{
      const uid=c.dataset.m;
      anaSel.mats.has(uid)?anaSel.mats.delete(uid):anaSel.mats.add(uid);
      renderAnaModal();
    };
  });
  document.getElementById('btnDoAna')?.addEventListener('click',()=>{
    if(analyzeWithMats(anaSel.target,[...anaSel.mats])){
      modal.innerHTML='';
      renderItemList();renderMatGrid();renderStatusScreen();renderTopBar();
      toast('解析した！');
    }
  });
}

// ===================== STATUS画面 =====================
function renderStatusScreen(){
  const s=calcStats();
  const table=document.getElementById('statusTable');
  table.innerHTML=`<tr><th>ステータス</th><th>Lv1値</th><th>LvUP</th></tr>
    <tr><td>HP</td><td>${s.hp1}</td><td>+${s.hpup}</td></tr>
    <tr><td>ATK（武器込）</td><td>${s.totalAtk}</td><td>+${s.strup}</td></tr>
    <tr><td>DEF（盾込）</td><td>${s.totalDef}</td><td>+${s.vitup}</td></tr>
    <tr><td>SPD</td><td>${s.spd1}</td><td>+1</td></tr>
    <tr><td>LUK</td><td>${s.luk1}</td><td>+0</td></tr>`;
  const ar=Object.keys(s.rareF).filter(k=>s.rareF[k]);
  if(ar.length)table.innerHTML+=`<tr><td colspan="3" class="muted">特殊：${ar.join(' / ')}</td></tr>`;
  document.getElementById('equippedList').innerHTML=['weapon','shield','ring'].map(cat=>{
    const item=getEquipped(cat);if(!item)return`<div class="muted">${catLabel(cat)}: 未装備</div>`;
    const def=findEquipDef(cat,item.defId);
    return`<div>${catLabel(cat)}: <b>${def?.name}</b> +${item.enhanceLv}</div>`;
  }).join('');
  renderBPList();
  document.getElementById('topRating').textContent=rating(s).toLocaleString();
}
function renderBPList(){
  document.getElementById('bpAvailable').textContent=state.bp;
  const el=document.getElementById('permanentBoostList');
  el.innerHTML=GAME_DATA.permanentBoostOptions.map(o=>`
    <div class="row" style="margin-bottom:6px;">
      <span>${o.label}（現在+${(state.permanentBoosts[o.key]||0)*o.perPoint} / 1BPごと+${o.perPoint}）</span>
      <button class="small gold" data-sp="${o.key}" ${state.bp<=0?'disabled':''}>BP消費</button>
    </div>`).join('');
  el.querySelectorAll('[data-sp]').forEach(btn=>{btn.onclick=()=>{spendBP(btn.dataset.sp);renderStatusScreen();};});
  const cost=GAME_DATA.rareAbilityUnlockCost;
  const ss=Object.values(state.permanentBoosts).reduce((a,b)=>a+b,0);
  const rs=Object.values(state.rareAbilityUnlocked).filter(Boolean).length*cost;
  const rareEl=document.getElementById('rareAbilityUnlockList');
  rareEl.innerHTML=`<p class="muted">特殊能力の永久固定化（${cost}BP）</p>`+
    GAME_DATA.rareAbilities.slice(0,8).map(name=>{
      const done=!!state.rareAbilityUnlocked[name];
      return`<div class="row" style="margin-bottom:6px;"><span>${name} ${done?'<span class="ability-tag rare">固定化済み</span>':''}</span>
      <button class="small gold" data-ul="${name}" ${done||state.bp<cost?'disabled':''}>${done?'済み':`${cost}BP`}</button></div>`;
    }).join('')+
    `<button class="small secondary full" id="btnRespec" ${ss+rs>0?'':'disabled'} style="margin-top:8px;">すべて振り直し（${ss+rs}BP回収）</button>`;
  rareEl.querySelectorAll('[data-ul]').forEach(btn=>{btn.onclick=()=>{unlockRare(btn.dataset.ul);renderStatusScreen();};});
  document.getElementById('btnRespec')?.addEventListener('click',()=>{
    if(confirm('すべてのBP振り分けを回収しますか？')){respecAll();renderStatusScreen();}
  });
}

// ===================== トップバー =====================
function renderTopBar(){
  document.getElementById('topBP').textContent=state.bp;
  const s=calcStats();
  document.getElementById('topRating').textContent=rating(s).toLocaleString();
}

// ===================== Toast =====================
function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;t.style.opacity='1';
  clearTimeout(t._t);t._t=setTimeout(()=>{t.style.opacity='0';},2500);
}

// ===================== タブ切り替え =====================
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
    document.getElementById('screen-'+btn.dataset.screen).classList.remove('hidden');
    if(btn.dataset.screen==='dungeon')renderDungeonList();
    if(btn.dataset.screen==='log')renderLogList();
    if(btn.dataset.screen==='item'){renderItemList();renderMatGrid();}
    if(btn.dataset.screen==='status')renderStatusScreen();
  };
});
document.getElementById('btnRetreat').onclick=retreat;

// ===================== 初期化 =====================
function init(){
  const loaded=loadGame();
  if(!loaded){
    const sw=createItem('weapon','w_001',0);
    const ss=createItem('shield','s_001',0);
    const sr=createItem('ring','r_001',0);
    [sw,ss,sr].forEach(it=>{it.abilities=[];});
    state.inventory.push(sw,ss,sr);
    state.equipped.weapon=sw.uid;
    state.equipped.shield=ss.uid;
    state.equipped.ring=sr.uid;
    addMat('m_katakunaru',10);
    addMat('m_katakunaru_x',3);
    saveGame();
  }
  renderDungeonList();
  renderTopBar();
  // オフライン進行を復元
  resumeOffline();
}
init();
