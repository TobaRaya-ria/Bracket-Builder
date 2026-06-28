import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@supabase/supabase-js";
import { strFromU8, strToU8, unzipSync, unzlibSync, zipSync, zlibSync } from "fflate";

// ─── Country map ─────────────────────────────────────────────────────────────
const COUNTRY_MAP = {"afghanistan":"af","albania":"al","algeria":"dz","argentina":"ar","australia":"au","austria":"at","bangladesh":"bd","belgium":"be","bolivia":"bo","brazil":"br","cambodia":"kh","cameroon":"cm","canada":"ca","chile":"cl","china":"cn","colombia":"co","costa rica":"cr","croatia":"hr","cuba":"cu","czech republic":"cz","denmark":"dk","ecuador":"ec","egypt":"eg","england":"gb","ethiopia":"et","finland":"fi","france":"fr","germany":"de","ghana":"gh","greece":"gr","guatemala":"gt","hungary":"hu","india":"in","indonesia":"id","iran":"ir","iraq":"iq","ireland":"ie","israel":"il","italy":"it","ivory coast":"ci","jamaica":"jm","japan":"jp","jordan":"jo","kenya":"ke","kuwait":"kw","malaysia":"my","mali":"ml","mexico":"mx","morocco":"ma","mozambique":"mz","myanmar":"mm","nepal":"np","netherlands":"nl","new zealand":"nz","nigeria":"ng","north korea":"kp","norway":"no","pakistan":"pk","panama":"pa","paraguay":"py","peru":"pe","philippines":"ph","poland":"pl","portugal":"pt","qatar":"qa","romania":"ro","russia":"ru","saudi arabia":"sa","scotland":"gb","senegal":"sn","serbia":"rs","singapore":"sg","slovakia":"sk","south africa":"za","south korea":"kr","spain":"es","sri lanka":"lk","sweden":"se","switzerland":"ch","taiwan":"tw","tanzania":"tz","thailand":"th","tunisia":"tn","turkey":"tr","ukraine":"ua","united kingdom":"gb","united states":"us","usa":"us","uk":"gb","uruguay":"uy","venezuela":"ve","vietnam":"vn","wales":"gb","zambia":"zm","zimbabwe":"zw"};
const FLAG = (code) => { if(!code)return""; const c=code.trim().toUpperCase().slice(0,2); if(c.length<2)return""; try{return String.fromCodePoint(...[...c].map(ch=>0x1F1E6-65+ch.charCodeAt(0)));}catch{return"";} };
const regionFlag = (region) => { if(!region)return""; const iso=COUNTRY_MAP[region.trim().toLowerCase()]; return iso?FLAG(iso):""; };

// ─── Palette ─────────────────────────────────────────────────────────────────
const palette=["#e63946","#457b9d","#2a9d8f","#e9c46a","#f4a261","#8338ec","#06d6a0","#fb8500","#118ab2","#d62828","#3a86ff","#ff006e","#219ebc","#ffb703","#c77dff","#52b788","#f77f00","#4cc9f0","#b5179e","#7209b7","#3a0ca3","#4361ee","#80b918","#e07a5f","#3d405b","#81b29a","#264653","#2b2d42","#ef233c","#06aed5"];

const DEFAULT_STANDINGS_RULES={
  mainMetric:"football",
  tiebreakers:["matchWins","scoreFor","scoreDiff","none"],
  scoringSystem:"football",
  customPoints:{matchWin:3,matchTie:1,matchLoss:0,gameWin:0,gameTie:0,gameLoss:0},
  pointMode:"football",
  winPoints:3,
  drawPoints:1,
  lossPoints:0,
  pointRules:[{metric:"matchWin",points:3}],
  scoreDiffBands:[],
  criteria:["points","matchWins","scoreFor","scoreDiff"],
  summary:"Football system. Ranking: Points, Match wins, Pts scored, Pts difference."
};

const METRIC_MAIN_OPTIONS=[
  ["matchWins","Match win"],
  ["scoreFor","Pts scored"],
  ["scoreDiff","Pts difference"],
  ["customPoints","Custom pts"],
  ["football","Football system"],
  ["kitakana","Kitakana system"]
];

const METRIC_TIEBREAKER_OPTIONS=[
  ["none","None"],
  ["matchWins","Match win"],
  ["scoreFor","Pts scored"],
  ["scoreDiff","Pts difference"]
];

const POINT_RULE_METRICS=[
  ["matchWin","Match win"],
  ["matchTie","Match tie"],
  ["matchLoss","Match loss"],
  ["gameWin","Game win"],
  ["gameTie","Game tie"],
  ["gameLoss","Game loss"],
  ["scoreDiff","Score diff"],
  ["scoreFor","Score for"],
  ["scoreAgainst","Score against"],
  ["scoreDiffBand","Score-diff band"]
];

const STANDINGS_CRITERIA=[
  ["points","Points"],
  ["scoreFor","Score for"],
  ["scoreDiff","Score diff"],
  ["matchWins","Match wins"],
  ["gameWins","Game wins"],
  ["gameDiff","Game diff"],
  ["fewestLosses","Fewest losses"]
];

function metricLabel(id){
  return [...METRIC_MAIN_OPTIONS,...METRIC_TIEBREAKER_OPTIONS].find(([key])=>key===id)?.[1]||id;
}

function metricCriterion(id){
  if(id==="football"||id==="kitakana"||id==="customPoints")return"points";
  if(id==="scoreFor")return"scoreFor";
  if(id==="scoreDiff")return"scoreDiff";
  if(id==="matchWins")return"matchWins";
  return null;
}

function criteriaFromMetricConfig(mainMetric,tiebreakers){
  return uniqCriteria([metricCriterion(mainMetric),...(tiebreakers||[]).map(metricCriterion)].filter(Boolean));
}

function customPointsFromRules(base){
  const fallback={...DEFAULT_STANDINGS_RULES.customPoints};
  if(base.customPoints&&typeof base.customPoints==="object"){
    return Object.fromEntries(Object.keys(fallback).map(key=>[key,Number.isFinite(Number(base.customPoints[key]))?Number(base.customPoints[key]):fallback[key]]));
  }
  const byMetric={};
  (Array.isArray(base.pointRules)?base.pointRules:[]).forEach(rule=>{byMetric[rule.metric]=Number(rule.points);});
  return {
    matchWin:Number.isFinite(byMetric.matchWin)?byMetric.matchWin:(Number.isFinite(Number(base.winPoints))?Number(base.winPoints):fallback.matchWin),
    matchTie:Number.isFinite(byMetric.matchTie)?byMetric.matchTie:(Number.isFinite(Number(base.drawPoints))?Number(base.drawPoints):fallback.matchTie),
    matchLoss:Number.isFinite(byMetric.matchLoss)?byMetric.matchLoss:(Number.isFinite(Number(base.lossPoints))?Number(base.lossPoints):fallback.matchLoss),
    gameWin:Number.isFinite(byMetric.gameWin)?byMetric.gameWin:fallback.gameWin,
    gameTie:Number.isFinite(byMetric.gameTie)?byMetric.gameTie:fallback.gameTie,
    gameLoss:Number.isFinite(byMetric.gameLoss)?byMetric.gameLoss:fallback.gameLoss
  };
}

function pointRulesFromSystem(scoringSystem,customPoints){
  if(scoringSystem==="custom")return [
    {metric:"matchWin",points:customPoints.matchWin},
    {metric:"matchTie",points:customPoints.matchTie},
    {metric:"matchLoss",points:customPoints.matchLoss},
    {metric:"gameWin",points:customPoints.gameWin},
    {metric:"gameTie",points:customPoints.gameTie},
    {metric:"gameLoss",points:customPoints.gameLoss}
  ].filter(rule=>rule.points!==0);
  if(scoringSystem==="kitakana")return [];
  return [{metric:"matchWin",points:3},{metric:"matchTie",points:1}];
}

function normalizeStandingsRules(rules){
  const base={...DEFAULT_STANDINGS_RULES,...(rules||{})};
  const mainValid=new Set(METRIC_MAIN_OPTIONS.map(([id])=>id));
  const tiebreakerValid=new Set(METRIC_TIEBREAKER_OPTIONS.map(([id])=>id));
  let mainMetric=mainValid.has(base.mainMetric)?base.mainMetric:null;
  if(!mainMetric){
    const oldPointRules=Array.isArray(base.pointRules)?base.pointRules:[];
    const hasLegacyCustomRules=base.scoringSystem==="custom"||base.pointMode==="custom"||oldPointRules.some(rule=>{
      const points=Number(rule.points);
      if(["gameWin","gameTie","gameLoss","matchLoss","scoreDiff","scoreFor","scoreAgainst","scoreDiffBand"].includes(rule.metric))return Number.isFinite(points)&&points!==0;
      if(rule.metric==="matchWin")return Number.isFinite(points)&&points!==3;
      if(rule.metric==="matchTie")return Number.isFinite(points)&&points!==1;
      return false;
    });
    const firstCriterion=Array.isArray(base.criteria)?base.criteria[0]:null;
    mainMetric=base.scoringSystem==="kitakana"?"kitakana":hasLegacyCustomRules?"customPoints":firstCriterion==="scoreFor"?"scoreFor":firstCriterion==="scoreDiff"?"scoreDiff":firstCriterion==="matchWins"?"matchWins":"football";
  }
  const tiebreakers=Array.from({length:4},(_,idx)=>{
    const value=Array.isArray(base.tiebreakers)?base.tiebreakers[idx]:null;
    if(tiebreakerValid.has(value))return value;
    const oldCriterion=Array.isArray(base.criteria)?base.criteria[idx+1]:null;
    return tiebreakerValid.has(oldCriterion)?oldCriterion:"none";
  });
  const customPoints=customPointsFromRules(base);
  const scoringSystem=mainMetric==="kitakana"?"kitakana":mainMetric==="customPoints"?"custom":"football";
  const valid=new Set(STANDINGS_CRITERIA.map(([id])=>id));
  const criteria=criteriaFromMetricConfig(mainMetric,tiebreakers).filter(id=>valid.has(id));
  const metricValid=new Set(POINT_RULE_METRICS.map(([id])=>id));
  const scoreDiffBands=Array.isArray(base.scoreDiffBands)?base.scoreDiffBands.map(b=>({type:b.type==="below"?"below":"atLeast",diff:Number(b.diff)||0,points:Number(b.points)||0})):[];
  let pointRules=pointRulesFromSystem(scoringSystem,customPoints).filter(rule=>metricValid.has(rule.metric)&&Number.isFinite(rule.points));
  if(!pointRules.length){
    pointRules=scoringSystem==="kitakana"?[]:Array.isArray(base.pointRules)?base.pointRules.map(rule=>({metric:rule.metric,points:Number(rule.points)})).filter(rule=>metricValid.has(rule.metric)&&Number.isFinite(rule.points)):[];
    if(!pointRules.length&&scoringSystem!=="kitakana")pointRules=[
      {metric:"matchWin",points:Number.isFinite(Number(base.winPoints))?Number(base.winPoints):3},
      {metric:"matchTie",points:Number.isFinite(Number(base.drawPoints))?Number(base.drawPoints):1},
      {metric:"matchLoss",points:Number.isFinite(Number(base.lossPoints))?Number(base.lossPoints):0}
    ].filter(rule=>rule.points!==0);
  }
  const normalized={
    ...base,
    mainMetric,
    tiebreakers,
    scoringSystem,
    customPoints,
    winPoints:Number.isFinite(Number(base.winPoints))?Number(base.winPoints):3,
    drawPoints:Number.isFinite(Number(base.drawPoints))?Number(base.drawPoints):1,
    lossPoints:Number.isFinite(Number(base.lossPoints))?Number(base.lossPoints):0,
    pointRules,
    scoreDiffBands,
    criteria:criteria.length?criteria:DEFAULT_STANDINGS_RULES.criteria,
    summary:""
  };
  normalized.summary=summarizeStandingsRules(normalized);
  return normalized;
}

function scoreDiffPoints(diff,rules){
  const bands=[...(rules.scoreDiffBands||[])].sort((a,b)=>a.type===b.type?b.diff-a.diff:a.type==="atLeast"?-1:1);
  const band=bands.find(b=>b.type==="below"?diff<b.diff:diff>=b.diff);
  return band?band.points:rules.winPoints;
}

function pointRuleUnit(rule,ctx,rules){
  if(rule.metric==="matchWin")return ctx.matchOutcome==="win"?1:0;
  if(rule.metric==="matchTie")return ctx.matchOutcome==="tie"?1:0;
  if(rule.metric==="matchLoss")return ctx.matchOutcome==="loss"?1:0;
  if(rule.metric==="gameWin")return ctx.gameWins;
  if(rule.metric==="gameTie")return ctx.gameTies;
  if(rule.metric==="gameLoss")return ctx.gameLosses;
  if(rule.metric==="scoreDiff")return ctx.scoreDiff;
  if(rule.metric==="scoreFor")return ctx.scoreFor;
  if(rule.metric==="scoreAgainst")return ctx.scoreAgainst;
  if(rule.metric==="scoreDiffBand")return ctx.matchOutcome==="win"?scoreDiffPoints(Math.max(0,ctx.scoreDiff),rules):0;
  return 0;
}

function standingsPointsForMatch(ctx,rules){
  if(rules.scoringSystem==="kitakana"){
    const diff=Math.abs(ctx.scoreDiff);
    if(ctx.matchOutcome==="tie")return 1;
    if(ctx.matchOutcome==="win"){
      if(diff>5)return 3;
      if(diff===5)return 2;
      return 1.5;
    }
    if(ctx.matchOutcome==="loss")return diff<5?0.5:0;
  }
  return (rules.pointRules||[]).reduce((sum,rule)=>{
    if(rule.metric==="scoreDiffBand")return sum+pointRuleUnit(rule,ctx,rules);
    return sum+(pointRuleUnit(rule,ctx,rules)*rule.points);
  },0);
}

function standingsValue(row,criterion){
  if(criterion==="points")return row.pts;
  if(criterion==="scoreFor")return row.sw;
  if(criterion==="scoreDiff")return row.sw-row.sl;
  if(criterion==="matchWins")return row.mw;
  if(criterion==="gameWins")return row.gw;
  if(criterion==="gameDiff")return row.gw-row.gl;
  if(criterion==="fewestLosses")return -row.ml;
  return 0;
}

function sortStandingsRows(rows,rules){
  const cfg=normalizeStandingsRules(rules);
  return rows.sort((a,b)=>{
    for(const criterion of cfg.criteria){
      const diff=standingsValue(b,criterion)-standingsValue(a,criterion);
      if(diff!==0)return diff;
    }
    return a.team.name.localeCompare(b.team.name);
  });
}

function standingTieSignature(row,rules){
  const cfg=normalizeStandingsRules(rules);
  return cfg.criteria.map(criterion=>standingsValue(row,criterion)).join("|");
}

function uniqCriteria(list){
  const valid=new Set(STANDINGS_CRITERIA.map(([id])=>id));
  const next=[];
  list.forEach(item=>{if(valid.has(item)&&!next.includes(item))next.push(item);});
  return next.length?next:DEFAULT_STANDINGS_RULES.criteria;
}

function summarizeStandingsRules(rules){
  const cfg={...DEFAULT_STANDINGS_RULES,...(rules||{})};
  const mainMetric=cfg.mainMetric||DEFAULT_STANDINGS_RULES.mainMetric;
  const tiebreakers=Array.from({length:4},(_,idx)=>Array.isArray(cfg.tiebreakers)?cfg.tiebreakers[idx]||"none":"none");
  const ranking=[metricLabel(mainMetric),...tiebreakers.filter(metric=>metric&&metric!=="none").map(metricLabel)].join(", ");
  if(mainMetric==="customPoints"){
    const points={...DEFAULT_STANDINGS_RULES.customPoints,...(cfg.customPoints||{})};
    return `Custom pts. Match W/T/L: ${points.matchWin}/${points.matchTie}/${points.matchLoss}; Game W/T/L: ${points.gameWin}/${points.gameTie}/${points.gameLoss}. Ranking: ${ranking}.`;
  }
  if(mainMetric==="football"){
    return `Football system. Win = 3, tie = 1, loss = 0. Ranking: ${ranking}.`;
  }
  if(mainMetric==="kitakana"){
    return `Kitakana system. Win by >5 = 3, win by 5 = 2, win by <5 = 1.5, tie = 1, lose by <5 = 0.5, other loss = 0. Close wins/losses count as MT in the table. Ranking: ${ranking}.`;
  }
  return `Ranking: ${ranking}. Points column uses football scoring.`;
}

// ─── Match helpers ────────────────────────────────────────────────────────────
function makeMatch(id, teamA, teamB, gpm, mode) {
  return { id, teamA: teamA||null, teamB: teamB||null, matchMode: mode, mvp: null, _autoWinner: null,
    games: Array.from({ length: gpm }, (_, i) => ({ id: i, winnerName: null, isTie: false, scoreA: "", scoreB: "", gameMvp: null, stats: {} })) };
}

function matchResult(match) {
  if (!match?.teamA || !match?.teamB) return { wA:0,wB:0,scoreA:0,scoreB:0,winner:null,loser:null };
  const mode = match.matchMode; let wA=0,wB=0,gameTies=0,scoreA=0,scoreB=0,completedGames=0;
  for (const g of match.games) {
    if (mode==="wl"||mode==="games") {
      if(g.isTie){completedGames++;gameTies++;}
      else if(g.winnerName){completedGames++;if(g.winnerName===match.teamA.name)wA++;if(g.winnerName===match.teamB.name)wB++;}
    } else if (mode==="score") {
      const hasScore=g.scoreA!==""&&g.scoreB!=="";
      const a=parseFloat(g.scoreA)||0,b=parseFloat(g.scoreB)||0;
      scoreA+=a;scoreB+=b;
      if(hasScore){
        completedGames++;
        if(a>b)wA++;
        else if(b>a)wB++;
        else gameTies++;
      }
    }
  }
  let winner=null,loser=null;
  if (mode==="wl"&&match.games.length===1) { const w=match.games[0]?.winnerName; winner=w===match.teamA.name?match.teamA:w===match.teamB.name?match.teamB:null; }
  else if (mode==="games"||mode==="wl") {
    const hasMajority=Math.max(wA,wB)>match.games.length/2;
    const allGamesEntered=completedGames===match.games.length;
    if(wA>wB&&(hasMajority||allGamesEntered))winner=match.teamA;
    else if(wB>wA&&(hasMajority||allGamesEntered))winner=match.teamB;
  }
  else if (mode==="score"&&completedGames===match.games.length&&match.games.length>0) { winner=scoreA>scoreB?match.teamA:scoreB>scoreA?match.teamB:null; }
  if (winner) loser=winner===match.teamA?match.teamB:match.teamA;
  return { wA,wB,gameTies,scoreA,scoreB,winner,loser };
}

function teamName(team){
  return team?.name||"";
}

function sameTeam(a,b){
  return teamName(a)===teamName(b);
}

function uniqueTeams(list){
  const seen=new Set();
  return (list||[]).filter(team=>{
    const name=teamName(team);
    if(!name||seen.has(name))return false;
    seen.add(name);
    return true;
  });
}

function bracketMatchWinner(match){
  return match?._autoWinner||matchResult(match).winner||null;
}

function bracketMatchLoser(match){
  if(match?._splitLoser)return match._splitLoser;
  if(!match?.teamA||!match?.teamB)return null;
  return matchResult(match).loser||null;
}

function bracketMatchResolved(match){
  if(!match)return true;
  if(match._autoWinner||match._splitDrop)return true;
  if(match.teamA&&match.teamB)return !!matchResult(match).winner;
  return false;
}

function bracketRoundResolved(round){
  return (round||[]).every(bracketMatchResolved);
}

function matchIsComplete(match){
  if(!match?.teamA||!match?.teamB)return false;
  const res=matchResult(match);
  if(res.winner)return true;
  if(match.matchMode==="score")return (match.games||[]).length>0&&(match.games||[]).every(g=>g.scoreA!==""&&g.scoreB!=="");
  return (match.games||[]).length>0&&(match.games||[]).every(g=>g.winnerName||g.isTie);
}

function matchAllowsTie(match){
  return !!match?.allowTie||/(?:^|-)rr-\d+-\d+$/.test(match?.id||"");
}

function adjGames(m, ng) {
  return { ...m, games: Array.from({ length: ng }, (_,i) => m.games[i] || { id:i,winnerName:null,isTie:false,scoreA:"",scoreB:"",gameMvp:null,stats:{} }) };
}

function isByeMatch(match){
  return !!match?._splitDrop||!!match?._autoWinner && !(match.teamA&&match.teamB);
}

function playableMatches(matches){
  return (matches||[]).filter(m=>m&&m.teamA&&m.teamB&&!isByeMatch(m));
}

function stageDataComplete(data){
  if(!data)return false;
  if(data.type==="roundrobin"||data.type==="groupstage"){
    const matches=playableMatches(dataMatches(data));
    return matches.length>0&&matches.every(matchIsComplete);
  }
  if(data.type==="single")return !!matchResult(data.winners?.[data.winners.length-1]?.[0]).winner;
  if(data.type==="double"){
    const propagated=propagateDoubleElim(data),gf=matchResult(propagated.grandFinal);
    if(gf.winner?.name===propagated.grandFinal.teamA?.name)return true;
    return !!matchResult(propagated.grandFinalReset).winner;
  }
  return false;
}

// ─── Seeding ──────────────────────────────────────────────────────────────────
function buildSeededSlots(size) {
  let order=[1,2];
  while(order.length<size){const next=[],len=order.length*2+1;for(const s of order){next.push(s);next.push(len-s);}order=next;}
  return order;
}

// ─── Single Elimination ───────────────────────────────────────────────────────
function generateElim(teams, gpm, mode) {
  const n=teams.length; let size=1; while(size<n)size*=2;
  const slots=buildSeededSlots(size).map(s=>s<=n?teams[s-1]:null);
  const round1=[];
  for(let i=0;i<size;i+=2){
    const a=slots[i],b=slots[i+1];
    const m=makeMatch(`w0-${i/2}`,a,b,gpm,mode);
    if(a&&!b)m._autoWinner=a; if(!a&&b)m._autoWinner=b;
    round1.push(m);
  }
  const rounds=[round1]; let prev=round1;
  while(prev.length>1){
    const next=[];
    for(let i=0;i<prev.length;i+=2){
      const ma=prev[i],mb=prev[i+1];
      next.push(makeMatch(`w${rounds.length}-${i/2}`,ma._autoWinner||null,mb._autoWinner||null,gpm,mode));
    }
    rounds.push(next); prev=next;
  }
  return { type:"single", winners:rounds };
}

// ─── Double Elimination (fixed) ───────────────────────────────────────────────
function generateDoubleElim(teams, gpm, mode, options={}) {
  const n=teams.length; let size=1; while(size<n)size*=2;
  const slots=buildSeededSlots(size).map(s=>s<=n?teams[s-1]:null);
  const splitCount=Math.max(0,Math.min(Math.floor(n/2),Number(options.splitStartCount)||0));
  const splitNames=new Set(splitCount>0?teams.slice(n-splitCount).map(t=>t.name):[]);

  // Winners bracket
  const wRound1=[];
  for(let i=0;i<size;i+=2){
    const a=slots[i],b=slots[i+1];
    let m=makeMatch(`w0-${i/2}`,a,b,gpm,mode);
    if(a&&!b)m._autoWinner=a; if(!a&&b)m._autoWinner=b;
    const aSplit=a&&splitNames.has(a.name),bSplit=b&&splitNames.has(b.name);
    if(a&&b&&aSplit!==bSplit){
      m={...m,_autoWinner:aSplit?b:a,_splitLoser:aSplit?a:b,_splitDrop:true};
    }
    wRound1.push(m);
  }
  const wRounds=[wRound1]; let wPrev=wRound1;
  while(wPrev.length>1){
    const next=[];
    for(let i=0;i<wPrev.length;i+=2)
      next.push(makeMatch(`w${wRounds.length}-${i/2}`,wPrev[i]._autoWinner||null,wPrev[i+1]._autoWinner||null,gpm,mode));
    wRounds.push(next); wPrev=next;
  }

  // Losers bracket.
  const lRounds=[];
  let lrIdx=0;
  doubleElimLoserRoundSizes(wRounds).forEach(size=>{
    const round=[];
    for(let i=0;i<size;i++)round.push(makeMatch(`l${lrIdx++}`,null,null,gpm,mode));
    lRounds.push(round);
  });

  const grandFinal=makeMatch("gf",null,null,gpm,mode);
  const grandFinalReset=makeMatch("gf-reset",null,null,gpm,mode);
  grandFinalReset._isReset=true;

  return { type:"double", winners:wRounds, losers:lRounds, grandFinal, grandFinalReset, splitStartCount:splitCount };
}

function doubleElimLoserRoundSizes(wRounds){
  const sizes=[];
  const firstRoundCount=wRounds?.[0]?.length||0;
  if(firstRoundCount>1)sizes.push(Math.floor(firstRoundCount/2));
  for(let wr=1;wr<(wRounds?.length||0);wr++){
    const receiveCount=wRounds[wr]?.length||0;
    if(receiveCount>0)sizes.push(receiveCount);
    if(receiveCount>1)sizes.push(Math.floor(receiveCount/2));
  }
  return sizes;
}

function matchConfigFromDoubleElim(data){
  const sample=[...(data?.winners||[]).flat(),...(data?.losers||[]).flat(),data?.grandFinal,data?.grandFinalReset].find(Boolean);
  return {gpm:sample?.games?.length||1,mode:sample?.matchMode||"wl"};
}

function normalizeDoubleElimData(data){
  if(!data||data.type!=="double"||!data.winners?.length)return data;
  const sizes=doubleElimLoserRoundSizes(data.winners);
  const {gpm,mode}=matchConfigFromDoubleElim(data);
  const existing=data.losers||[];
  let changed=existing.length!==sizes.length;
  let nextLoserIdx=Math.max(-1,...existing.flat().map(m=>{
    const match=String(m?.id||"").match(/^l(\d+)$/);
    return match?Number(match[1]):-1;
  }))+1;
  const losers=sizes.map((size,rIdx)=>{
    const round=existing[rIdx]||[];
    if(round.length!==size)changed=true;
    return Array.from({length:size},(_,mIdx)=>round[mIdx]||makeMatch(`l${nextLoserIdx++}`,null,null,gpm,mode));
  });
  return changed?{...data,losers}:data;
}

const EMPTY_ENTRY={team:null,possible:false};
const PENDING_ENTRY={team:null,possible:true};

function winnerBracketLoserEntry(match){
  if(!match)return EMPTY_ENTRY;
  if(match._splitLoser)return {team:match._splitLoser,possible:true};
  if(match._autoWinner)return EMPTY_ENTRY;
  if(match.teamA&&match.teamB)return {team:matchResult(match).loser||null,possible:true};
  return match.teamA||match.teamB?PENDING_ENTRY:PENDING_ENTRY;
}

function lowerAutoWinner(match,aEntry=EMPTY_ENTRY,bEntry=EMPTY_ENTRY){
  if(match?.teamA&&!match.teamB&&!bEntry.possible)return match.teamA;
  if(match?.teamB&&!match.teamA&&!aEntry.possible)return match.teamB;
  return null;
}

function withLowerEntrants(match,aEntry=EMPTY_ENTRY,bEntry=EMPTY_ENTRY){
  const next={...match,teamA:aEntry.team||null,teamB:bEntry.team||null,_autoWinner:null};
  if(next.teamA&&next.teamB&&next.teamA.name===next.teamB.name)next.teamB=null;
  const auto=lowerAutoWinner(next,aEntry,bEntry);
  return auto?{...next,_autoWinner:auto}:next;
}

function lowerWinnerEntry(match,aEntry=EMPTY_ENTRY,bEntry=EMPTY_ENTRY){
  const auto=lowerAutoWinner(match,aEntry,bEntry);
  if(auto)return {team:auto,possible:true};
  if(match?.teamA&&match.teamB)return {team:bracketMatchWinner(match),possible:true};
  return aEntry.possible||bEntry.possible||match?.teamA||match?.teamB?PENDING_ENTRY:EMPTY_ENTRY;
}

// Propagate results through double elim bracket (pure function, called on every render)
function propagateDoubleElim(data) {
  if(!data)return data;
  data=normalizeDoubleElimData(data);
  // Deep-clone mutable parts
  const d={
    ...data,
    winners:data.winners.map(r=>r.map(m=>({...m}))),
    losers:data.losers.map(r=>r.map(m=>({...m}))),
    grandFinal:{...data.grandFinal},
    grandFinalReset:{...data.grandFinalReset}
  };

  // ── 1. Propagate WR winners forward ─────────────────────────────────────────
  for(let rIdx=0;rIdx<d.winners.length-1;rIdx++){
    for(let mIdx=0;mIdx<d.winners[rIdx].length;mIdx++){
      const m=d.winners[rIdx][mIdx];
      const w=bracketMatchWinner(m);
      const nextIdx=Math.floor(mIdx/2);
      const slot=mIdx%2===0?"teamA":"teamB";
      if(d.winners[rIdx+1]?.[nextIdx]){
        d.winners[rIdx+1][nextIdx]={...d.winners[rIdx+1][nextIdx],[slot]:w};
      }
    }
  }

  // ── 2. Collect WR losers per fixed source slot ──────────────────────────────
  const wrLosers=d.winners.map(round=>round.map(winnerBracketLoserEntry));

  // ── 3. Fill LR[0]: WR[0] loser slots play mirrored slots ───────────────────
  const wr0L=wrLosers[0]||[];
  const lr0=d.losers[0]||[];
  const lr0Entries=lr0.map((_,i)=>[wr0L[i]||EMPTY_ENTRY,wr0L[wr0L.length-1-i]||EMPTY_ENTRY]);
  if(d.losers.length>0)d.losers[0]=lr0.map((m,i)=>withLowerEntrants(m,lr0Entries[i][0],lr0Entries[i][1]));

  // ── 4. Walk remaining LR rounds ─────────────────────────────────────────────
  // Pattern after LR[0]:
  //   LR[1] = receive WR[1] losers  (LR survivor vs WR loser)
  //   LR[2] = play-each-other among LR[1] survivors
  //   LR[3] = receive WR[2] losers
  //   LR[4] = play-each-other
  //   ...
  let lrSurvivors=d.losers[0]?.map((m,i)=>lowerWinnerEntry(m,lr0Entries[i]?.[0],lr0Entries[i]?.[1]))||[];
  let wrDropIdx=1; // next WR round to pull losers from

  for(let lrIdx=1;lrIdx<d.losers.length;lrIdx++){
    const round=d.losers[lrIdx];
    const isReceiveRound=(lrIdx%2===1); // odd = receive, even = play-each-other
    const entryPairs=[];

    if(isReceiveRound){
      // pair each LR survivor against a WR drop-in
      const dropIns=wrLosers[wrDropIdx]||[];
      wrDropIdx++;
      for(let i=0;i<round.length;i++){
        entryPairs[i]=[lrSurvivors[i]||EMPTY_ENTRY,dropIns[i]||EMPTY_ENTRY];
      }
    } else {
      // survivors play each other
      for(let i=0;i<round.length;i++){
        entryPairs[i]=[lrSurvivors[i*2]||EMPTY_ENTRY,lrSurvivors[i*2+1]||EMPTY_ENTRY];
      }
    }
    d.losers[lrIdx]=round.map((m,i)=>withLowerEntrants(m,entryPairs[i][0],entryPairs[i][1]));
    lrSurvivors=d.losers[lrIdx].map((m,i)=>lowerWinnerEntry(m,entryPairs[i][0],entryPairs[i][1]));
  }

  // ── 5. Grand Final ───────────────────────────────────────────────────────────
  const wbFinal=d.winners[d.winners.length-1][0];
  const wbWinner=bracketMatchWinner(wbFinal);
  const lbWinner=(lrSurvivors[0]||winnerBracketLoserEntry(wbFinal)).team||null;
  d.grandFinal={...d.grandFinal,teamA:wbWinner,teamB:lbWinner};

  // Grand Final Reset — always has same teams as GF (reset is only played if LB side wins)
  d.grandFinalReset={...d.grandFinalReset,teamA:wbWinner,teamB:lbWinner};

  return d;
}

// ─── Round Robin ──────────────────────────────────────────────────────────────
function scheduleRoundRobin(teams, gpm, mode) {
  const list=[...teams]; if(list.length%2!==0)list.push(null);
  const n=list.length,pins=[...list],rounds=[];
  for(let r=0;r<n-1;r++){
    const round=[];
    for(let i=0;i<n/2;i++){
      const a=pins[i],b=pins[n-1-i];
      if(a&&b)round.push({...makeMatch(`rr-${r}-${i}`,a,b,gpm,mode),allowTie:true});
    }
    rounds.push(round);
    const last=pins[n-1];for(let i=n-1;i>1;i--)pins[i]=pins[i-1];pins[1]=last;
  }
  return rounds;
}

function prefixMatchIds(rounds,prefix){
  return rounds.map(round=>round.map(m=>({...m,id:`${prefix}-${m.id}`})));
}

function makeGroup(name,teams,idx,gpm,mode){
  return {name,teams,rounds:prefixMatchIds(scheduleRoundRobin(teams,gpm,mode),`g${idx}`)};
}

function makeSeededGroups(teams, groupCount, gpm, mode) {
  const groups=Array.from({length:groupCount},(_,i)=>({name:`Group ${String.fromCharCode(65+i)}`,teams:[]}));
  teams.forEach((team,idx)=>groups[idx%groupCount].teams.push(team));
  return groups.map((g,idx)=>makeGroup(g.name,g.teams,idx,gpm,mode));
}

function makePools(teams, groupCount) {
  const pools=[];
  for(let i=0;i<teams.length;i+=groupCount){
    pools.push({name:`Pool ${pools.length+1}`,teams:teams.slice(i,i+groupCount)});
  }
  return pools;
}

function rechunkPools(flatTeams, groupCount) {
  return makePools(flatTeams,groupCount);
}

function movePooledTeam(pools,poolIdx,teamIdx,delta,groupCount) {
  const flat=pools.flatMap(p=>p.teams);
  const absolute=pools.slice(0,poolIdx).reduce((sum,p)=>sum+p.teams.length,0)+teamIdx;
  const target=Math.max(0,Math.min(flat.length-1,absolute+delta));
  if(target===absolute)return pools;
  const next=[...flat];
  const [team]=next.splice(absolute,1);
  next.splice(target,0,team);
  return rechunkPools(next,groupCount);
}

function shuffleList(list) {
  const next=[...list];
  for(let i=next.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [next[i],next[j]]=[next[j],next[i]];
  }
  return next;
}

function makeGroupsFromPools(pools, groupCount, gpm, mode) {
  const groupTeams=Array.from({length:groupCount},()=>[]);
  pools.forEach(pool=>{
    shuffleList(pool.teams).forEach((team,idx)=>{
      if(idx<groupCount)groupTeams[idx].push(team);
    });
  });
  return groupTeams.map((teams,idx)=>makeGroup(`Group ${String.fromCharCode(65+idx)}`,teams,idx,gpm,mode));
}

function generateGroupStage(teams, groupCount, gpm, mode) {
  const count=Math.max(2,Math.min(groupCount||2,teams.length));
  return { type:"groupstage", groups:[], teams, groupCount:count, gpm, matchMode:mode, poolChoice:null, pools:[], poolsConfirmed:false };
}

function buildStageData(stage, teams, extra={}) {
  const gpm=stage.matchMode==="wl"?1:stage.gamesPerMatch;
  const shouldGroup=stage.format==="roundrobin"&&stage.groupStage&&stage.groupCount>1;
  if(shouldGroup)return {...generateGroupStage(teams,stage.groupCount,gpm,stage.matchMode),...extra};
  if(stage.format==="single")return {...generateElim(teams,gpm,stage.matchMode),teams,...extra};
  if(stage.format==="double")return {...generateDoubleElim(teams,gpm,stage.matchMode,{splitStartCount:stage.splitStart?stage.splitStartCount:0}),teams,...extra};
  return {type:"roundrobin",rounds:scheduleRoundRobin(teams,gpm,stage.matchMode),teams,...extra};
}

function groupTiebreakInfo(stageData, stageConfig) {
  if(stageData?.type!=="groupstage")return null;
  const groupCount=stageData.groups?.length||stageConfig.groupCount||0;
  const advance=stageConfig.advance||0;
  const remainder=groupCount?advance%groupCount:0;
  if(!groupCount||!remainder)return null;
  const base=Math.floor(advance/groupCount);
  const groupStandings=(stageData.groups||[]).map(group=>computeTeamStandings(group.teams,(group.rounds||[]).flat(),stageConfig.standingsRules));
  const guaranteed=groupStandings.flatMap(rows=>rows.slice(0,base).map(r=>r.team));
  const candidates=groupStandings.map((rows,idx)=>({group:idx,row:rows[base]})).filter(x=>x.row);
  const byPerformance=[...candidates].sort((a,b)=>b.row.mw-a.row.mw||b.row.gw-a.row.gw||b.row.sw-a.row.sw);
  return {groupCount,advance,remainder,base,guaranteed,candidates,byPerformance};
}

function makeTieKey(row, matchMode, standingsRules) {
  if(standingsRules)return standingTieSignature(row,standingsRules);
  return matchMode==="score"?`score-${row.sw}`:`wins-${row.mw}`;
}

function buildRoundRobinTiebreakRound(teams, rounds, matchMode, gpm, standingsRules) {
  const regular=rounds.filter(round=>!round.some(m=>m._tiebreak));
  const existing=rounds.some(round=>round.some(m=>m._tiebreak));
  const all=regular.flat().filter(m=>m?.teamA&&m?.teamB);
  if(existing||all.length===0||!all.every(matchIsComplete))return null;
  const standings=computeTeamStandings(teams,all,standingsRules);
  const groups=new Map();
  standings.forEach(row=>{
    const key=makeTieKey(row,matchMode,standingsRules);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row.team);
  });
  const tied=[...groups.values()].filter(list=>list.length>1);
  if(!tied.length)return null;
  const matches=[];
  tied.forEach((list,gIdx)=>{
    for(let i=0;i<list.length;i++){
      for(let j=i+1;j<list.length;j++){
        const match=makeMatch(`tb-${gIdx}-${i}-${j}`,list[i],list[j],gpm,matchMode);
        match._tiebreak=true;
        matches.push(match);
      }
    }
  });
  return matches.length?matches:null;
}

function orderedTeams(list){
  return uniqueTeams(list).sort((a,b)=>(a.seed??9999)-(b.seed??9999)||teamName(a).localeCompare(teamName(b)));
}

function qualificationSourceKey(kind,roundIdx,target,baseQualifiers,candidates){
  const names=list=>orderedTeams(list).map(teamName).join(",");
  return `${kind}-${roundIdx}-${target}-${names(baseQualifiers)}-${names(candidates)}`;
}

function survivalRoundPlan(teams,target){
  const ordered=orderedTeams(teams);
  const matchCount=Math.min(Math.floor(ordered.length/2),Math.max(0,ordered.length-target));
  const byeCount=Math.max(0,ordered.length-matchCount*2);
  const byes=ordered.slice(0,byeCount);
  const pool=ordered.slice(byeCount);
  const pairs=Array.from({length:matchCount},(_,idx)=>[pool[idx],pool[pool.length-1-idx]]);
  return {byes,pairs};
}

function reconcileMatchForTeams(match,id,teamA,teamB,gpm,mode){
  if(match&&sameTeam(match.teamA,teamA)&&sameTeam(match.teamB,teamB)){
    return {...match,teamA,teamB,matchMode:mode,games:adjGames(match,gpm).games};
  }
  return makeMatch(id,teamA,teamB,gpm,mode);
}

function syncSurvivalTiebreaker(tb,gpm,mode){
  if(!tb)return null;
  const target=Math.max(1,Number(tb.target)||1);
  let current=orderedTeams(tb.candidateTeams||[]);
  const rounds=[];
  for(let roundIdx=0;current.length>target&&roundIdx<16;roundIdx++){
    const plan=survivalRoundPlan(current,target);
    const existingRound=tb.rounds?.[roundIdx]||[];
    const round=plan.pairs.map(([teamA,teamB],matchIdx)=>{
      const id=existingRound[matchIdx]?.id||`${tb.id||"qtb"}-r${roundIdx}-${matchIdx}`;
      return reconcileMatchForTeams(existingRound[matchIdx],id,teamA,teamB,gpm,mode);
    });
    rounds.push(round);
    if(!bracketRoundResolved(round))return {...tb,target,rounds,complete:false,qualifiedTeams:[]};
    current=orderedTeams([...plan.byes,...round.map(bracketMatchWinner).filter(Boolean)]);
  }
  return {...tb,target,rounds,complete:current.length<=target,qualifiedTeams:current.slice(0,target)};
}

function qualificationMatchConfig(data,stageConfig){
  const match=[...(data?.winners||[]).flat(),...(data?.losers||[]).flat(),...(data?.qualificationTiebreaker?.rounds||[]).flat(),data?.grandFinal,data?.grandFinalReset].find(Boolean);
  return {gpm:match?.games?.length||(stageConfig?.matchMode==="wl"?1:stageConfig?.gamesPerMatch||1),mode:match?.matchMode||stageConfig?.matchMode||"wl"};
}

function singleQualificationBaseStatus(data,stageConfig){
  const advance=stageConfig?.advance||0;
  let alive=orderedTeams(data?.teams||[]);
  for(let roundIdx=0;roundIdx<(data?.winners?.length||0);roundIdx++){
    const round=data.winners[roundIdx]||[];
    if(!bracketRoundResolved(round))return {ready:false,pending:true,advance,aliveTeams:alive};
    const winners=orderedTeams(round.map(bracketMatchWinner).filter(Boolean));
    const losers=orderedTeams(round.map(bracketMatchLoser).filter(Boolean));
    if(winners.length===advance)return {ready:true,advance,advancers:winners,aliveTeams:winners};
    if(alive.length>advance&&winners.length<advance&&losers.length){
      const target=advance-winners.length;
      return {
        ready:false,
        needsTiebreaker:true,
        advance,
        aliveTeams:winners,
        baseQualifiers:winners,
        candidateTeams:losers,
        target,
        sourceKey:qualificationSourceKey("single",roundIdx,target,winners,losers)
      };
    }
    alive=winners;
  }
  return {ready:false,pending:true,advance,aliveTeams:alive};
}

function doubleQualificationEvents(data){
  const prop=propagateDoubleElim(data);
  const events=[];
  for(let wrIdx=0;wrIdx<(prop?.winners?.length||0);wrIdx++){
    events.push({kind:"winners",roundIdx:wrIdx,round:prop.winners[wrIdx]});
    if(wrIdx===0){
      if(prop.losers?.[0])events.push({kind:"losers",roundIdx:0,round:prop.losers[0]});
    } else {
      const receiveIdx=wrIdx*2-1;
      const playIdx=wrIdx*2;
      if(prop.losers?.[receiveIdx])events.push({kind:"losers",roundIdx:receiveIdx,round:prop.losers[receiveIdx]});
      if(prop.losers?.[playIdx])events.push({kind:"losers",roundIdx:playIdx,round:prop.losers[playIdx]});
    }
  }
  return events;
}

function doubleQualificationBaseStatus(data,stageConfig){
  const advance=stageConfig?.advance||0;
  const teams=orderedTeams(data?.teams||[]);
  const losses=new Map(teams.map(team=>[teamName(team),0]));
  const rankedAliveTeams=()=>teams.filter(team=>(losses.get(teamName(team))||0)<2).sort((a,b)=>(losses.get(teamName(a))||0)-(losses.get(teamName(b))||0)||(a.seed??9999)-(b.seed??9999)||teamName(a).localeCompare(teamName(b)));
  let alive=teams;
  for(const event of doubleQualificationEvents(data)){
    if(!bracketRoundResolved(event.round))return {ready:false,pending:true,advance,aliveTeams:alive};
    const before=alive;
    const eliminated=[];
    event.round.forEach(match=>{
      const loser=bracketMatchLoser(match);
      if(!loser)return;
      const name=teamName(loser);
      const nextLoss=(losses.get(name)||0)+1;
      losses.set(name,nextLoss);
      if(nextLoss>=2)eliminated.push(loser);
    });
    alive=rankedAliveTeams();
    if(alive.length===advance)return {ready:true,advance,advancers:alive,aliveTeams:alive};
    if(before.length>advance&&alive.length<advance&&eliminated.length){
      const candidates=orderedTeams(eliminated);
      const target=advance-alive.length;
      return {
        ready:false,
        needsTiebreaker:true,
        advance,
        aliveTeams:alive,
        baseQualifiers:alive,
        candidateTeams:candidates,
        target,
        sourceKey:qualificationSourceKey(`double-${event.kind}`,event.roundIdx,target,alive,candidates)
      };
    }
  }
  if(advance===1&&stageDataComplete(data)){
    const propagated=propagateDoubleElim(data);
    const gfWinner=bracketMatchWinner(propagated.grandFinal);
    const resetWinner=bracketMatchWinner(propagated.grandFinalReset);
    const champion=gfWinner?.name===propagated.grandFinal.teamA?.name?gfWinner:resetWinner||gfWinner||null;
    return {ready:!!champion,advance,advancers:champion?[champion]:[],aliveTeams:champion?[champion]:alive};
  }
  return {ready:false,pending:true,advance,aliveTeams:alive};
}

function qualificationBaseStatus(data,stageConfig,isLast){
  if(!data||isLast||!(data.type==="single"||data.type==="double"))return {ready:stageDataComplete(data),advance:stageConfig?.advance||0,advancers:[]};
  if(data.type==="single")return singleQualificationBaseStatus(data,stageConfig);
  return doubleQualificationBaseStatus(data,stageConfig);
}

function stageQualificationStatus(data,stageConfig,isLast){
  const base=qualificationBaseStatus(data,stageConfig,isLast);
  if(!base.needsTiebreaker)return base;
  const current=data?.qualificationTiebreaker?.sourceKey===base.sourceKey?data.qualificationTiebreaker:null;
  const {gpm,mode}=qualificationMatchConfig(data,stageConfig);
  const tb=current?syncSurvivalTiebreaker(current,gpm,mode):null;
  const tbQualifiers=tb?.complete?tb.qualifiedTeams||[]:[];
  return {
    ...base,
    tiebreaker:tb,
    ready:!!tb?.complete,
    advancers:tb?.complete?uniqueTeams([...(base.baseQualifiers||[]),...tbQualifiers]):base.baseQualifiers||[]
  };
}

function syncStageQualificationData(data,stageConfig,isLast){
  if(!data||isLast||!(data.type==="single"||data.type==="double"))return data;
  const base=qualificationBaseStatus(data,stageConfig,isLast);
  if(!base.needsTiebreaker){
    if(!data.qualificationTiebreaker)return data;
    const {qualificationTiebreaker,...rest}=data;
    return rest;
  }
  const {gpm,mode}=qualificationMatchConfig(data,stageConfig);
  const existing=data.qualificationTiebreaker?.sourceKey===base.sourceKey?data.qualificationTiebreaker:null;
  const id=`qtb-${base.sourceKey.replace(/[^a-z0-9]+/gi,"-").slice(0,54)}`;
  const tb=syncSurvivalTiebreaker({
    ...(existing||{}),
    id,
    sourceKey:base.sourceKey,
    target:base.target,
    baseQualifiers:base.baseQualifiers,
    candidateTeams:base.candidateTeams,
    rounds:existing?.rounds||[]
  },gpm,mode);
  return {...data,qualificationTiebreaker:tb};
}

// ─── Standings ────────────────────────────────────────────────────────────────
function computeTeamStandings(teams, matches, standingsRules) {
  const rules=normalizeStandingsRules(standingsRules);
  const rows=teams.map(t=>{
    const mine=matches.filter(m=>m.teamA?.name===t.name||m.teamB?.name===t.name);
    let mw=0,ml=0,draws=0,gw=0,gl=0,gt=0,sw=0,sl=0,pts=0;
    mine.forEach(m=>{
      const isA=m.teamA?.name===t.name;
      const{wA,wB,gameTies:matchGameTies,scoreA,scoreB,winner}=matchResult(m);
      const forScore=isA?scoreA:scoreB;
      const againstScore=isA?scoreB:scoreA;
      const gameWins=isA?wA:wB,gameLosses=isA?wB:wA;
      gw+=gameWins; gl+=gameLosses; gt+=matchGameTies; sw+=forScore; sl+=againstScore;
      const complete=matchIsComplete(m);
      let matchOutcome=null;
      if(winner){
        matchOutcome=winner.name===t.name?"win":"loss";
        const kitakanaCloseDraw=rules.scoringSystem==="kitakana"&&Math.abs(forScore-againstScore)<5;
        if(kitakanaCloseDraw)draws++;
        else if(matchOutcome==="win")mw++;
        else ml++;
      } else if(complete){
        matchOutcome="tie";
        draws++;
      }
      if(matchOutcome){
        pts+=standingsPointsForMatch({matchOutcome,gameWins,gameLosses,gameTies:matchGameTies,scoreFor:forScore,scoreAgainst:againstScore,scoreDiff:forScore-againstScore},rules);
      }
    });
    return {team:t,played:mw+ml+draws,mw,ml,draws,mt:draws,gw,gl,gt,sw,sl,pts};
  });
  return sortStandingsRows(rows,rules);
}

function computePlayerStandings(teams, matches, statCols, stageMatchSets=[]) {
  const players={};
  teams.forEach(t=>{
    (t.players||[]).forEach(p=>{
      if(p.role==="player"||p.role==="substitute"){
        players[p.name]={name:p.name,team:t,nationality:p.nationality,mw:0,gameMvps:0,matchMvps:0,stats:{},stageWins:stageMatchSets.map(()=>0)};
        statCols.forEach(col=>{players[p.name].stats[col]=0;});
      }
    });
  });
  matches.forEach(m=>{
    const res=matchResult(m);
    if(m.mvp&&players[m.mvp])players[m.mvp].matchMvps++;
    m.games.forEach(g=>{
      if(g.gameMvp&&players[g.gameMvp])players[g.gameMvp].gameMvps++;
      if(g.stats){
        Object.entries(g.stats).forEach(([pname,pstats])=>{
          if(!players[pname])return;
          statCols.forEach(col=>{players[pname].stats[col]+=(parseFloat(pstats[col])||0);});
        });
      }
    });
    if(res.winner){
      [m.teamA,m.teamB].forEach(team=>{
        (team?.players||[]).forEach(p=>{
          if(players[p.name]&&team.name===res.winner.name)players[p.name].mw++;
        });
      });
    }
  });
  stageMatchSets.forEach((stageMatches,sIdx)=>{
    playableMatches(stageMatches).forEach(m=>{
      const res=matchResult(m);
      if(!res.winner)return;
      (res.winner.players||[]).forEach(p=>{
        if(players[p.name])players[p.name].stageWins[sIdx]++;
      });
    });
  });
  return Object.values(players);
}

// ─── MVP Awards ───────────────────────────────────────────────────────────────
// awards keeps the legacy weekMvps key for saved data; the UI treats each entry as a round MVP.
// Players are selected from the full player pool across all matches

function getAllPlayers(teams) {
  const seen=new Set();
  const result=[];
  (teams||[]).forEach(t=>{
    (t.players||[]).filter(p=>p.role==="player"||p.role==="substitute").forEach(p=>{
      if(!seen.has(p.name)){seen.add(p.name);result.push({...p,team:t});}
    });
  });
  return result;
}

function MvpSelector({label,value,onChange,players,count,onCountChange,accent}){
  const[open,setOpen]=useState(false);
  const accentColor=accent||"#e9c46a";
  const selected=value||[];

  const toggle=(name)=>{
    if(selected.includes(name)){
      onChange(selected.filter(n=>n!==name));
    } else if(selected.length<count){
      onChange([...selected,name]);
    }
  };

  return(
    <div style={{background:"var(--color-background-primary)",border:`1px solid ${accentColor}44`,borderRadius:10,padding:"12px 14px"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
        <span style={{fontSize:12,fontWeight:800,letterSpacing:"0.07em",textTransform:"uppercase",color:accentColor,fontFamily:"'Barlow Condensed',sans-serif"}}>⭐ {label}</span>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5}}>
          <span style={{fontSize:10,color:"var(--color-text-tertiary)"}}>MVPs:</span>
          <Stepper value={count} min={1} max={Math.min(10,players.length||1)} onChange={onCountChange} small/>
        </div>
      </div>
      {/* Selected MVPs display */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8,minHeight:28}}>
        {selected.length===0&&<span style={{fontSize:11,color:"var(--color-text-tertiary)",fontStyle:"italic"}}>None selected</span>}
        {selected.map((name,i)=>{
          const pl=players.find(p=>p.name===name);
          return(
            <div key={name} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 8px",borderRadius:6,background:`${accentColor}15`,border:`1px solid ${accentColor}55`,fontFamily:"'Barlow Condensed',sans-serif"}}>
              {i===0&&count>1&&<span style={{fontSize:9,color:accentColor,fontWeight:700}}>🥇</span>}
              {i===1&&count>1&&<span style={{fontSize:9,color:"#aaa",fontWeight:700}}>🥈</span>}
              {i===2&&count>1&&<span style={{fontSize:9,color:"#cd7f32",fontWeight:700}}>🥉</span>}
              {i>2&&count>1&&<span style={{fontSize:9,color:"var(--color-text-tertiary)",fontWeight:700}}>#{i+1}</span>}
              {pl&&<span style={{fontSize:10}}>{FLAG(pl.nationality)}</span>}
              <span style={{fontSize:12,fontWeight:700,color:"var(--color-text-primary)"}}>{name}</span>
              {pl&&<span style={{fontSize:10,color:"var(--color-text-tertiary)"}}>· {pl.team?.name}</span>}
              <button onClick={()=>toggle(name)} style={{fontSize:11,color:"var(--color-text-tertiary)",background:"none",border:"none",cursor:"pointer",padding:"0 1px",lineHeight:1,marginLeft:2}}>×</button>
            </div>
          );
        })}
      </div>
      {/* Player picker */}
      <button onClick={()=>setOpen(o=>!o)} style={{fontSize:10,padding:"2px 10px",borderRadius:4,border:`0.5px solid ${accentColor}55`,background:`${accentColor}0d`,color:accentColor,cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>
        {open?"▲ Close":"▼ Pick players"}
        {selected.length>0&&` (${selected.length}/${count})`}
      </button>
      {open&&players.length>0&&(
        <div style={{marginTop:8,maxHeight:200,overflowY:"auto",display:"flex",flexDirection:"column",gap:2}}>
          {players.map(p=>{
            const isSel=selected.includes(p.name);
            const canAdd=!isSel&&selected.length<count;
            return(
              <div key={p.name} onClick={()=>canAdd||isSel?toggle(p.name):null}
                style={{display:"flex",alignItems:"center",gap:7,padding:"4px 8px",borderRadius:6,cursor:canAdd||isSel?"pointer":"not-allowed",
                  background:isSel?`${accentColor}12`:"transparent",
                  border:isSel?`0.5px solid ${accentColor}44`:"0.5px solid transparent",
                  opacity:!canAdd&&!isSel?0.4:1,transition:"background 0.1s"}}>
                <span style={{fontSize:11}}>{FLAG(p.nationality)||"🏳"}</span>
                <span style={{fontSize:12,fontWeight:isSel?700:400,color:"var(--color-text-primary)",fontFamily:"'Barlow Condensed',sans-serif"}}>{p.name}</span>
                <span style={{fontSize:10,color:"var(--color-text-tertiary)",marginLeft:"auto"}}>{p.team?.name}</span>
                {isSel&&<span style={{fontSize:10,color:accentColor}}>✓</span>}
              </div>
            );
          })}
        </div>
      )}
      {open&&players.length===0&&<div style={{fontSize:11,color:"var(--color-text-tertiary)",fontStyle:"italic",marginTop:6}}>No players added to teams yet.</div>}
    </div>
  );
}

function MvpAwardsPanel({awards,onChange,allTeams,roundCount,stageCount,isMulti,activeStageIdx=0,isFinalStage=true}){
  const players=getAllPlayers(allTeams);

  const updateRoundMvp=(rIdx,val)=>{
    const next=[...(awards.weekMvps||[])];
    next[rIdx]={...(next[rIdx]||{round:rIdx+1}),players:val};
    onChange({...awards,weekMvps:next});
  };
  const updateRoundCount=(rIdx,cnt)=>{
    const next=[...(awards.weekMvps||[])];
    next[rIdx]={...(next[rIdx]||{round:rIdx+1,players:[]}),count:cnt};
    onChange({...awards,weekMvps:next});
  };
  const updateStageMvp=(sIdx,val)=>{
    const next=[...(awards.stageMvps||[])];
    next[sIdx]={...(next[sIdx]||{stage:sIdx+1}),players:val};
    onChange({...awards,stageMvps:next});
  };
  const updateStageCount=(sIdx,cnt)=>{
    const next=[...(awards.stageMvps||[])];
    next[sIdx]={...(next[sIdx]||{stage:sIdx+1,players:[]}),count:cnt};
    onChange({...awards,stageMvps:next});
  };

  return(
    <div style={{marginTop:24,padding:"16px",background:"var(--color-background-secondary)",borderRadius:12,border:"1px solid rgba(233,196,106,0.25)"}}>
      <div style={{fontSize:13,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:"#e9c46a",marginBottom:14,fontFamily:"'Barlow Condensed',sans-serif"}}>⭐ MVP Awards</div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {/* Round MVPs — for RR. */}
        {roundCount>0&&Array.from({length:roundCount}).map((_,rIdx)=>(
          <MvpSelector
            key={`round-${rIdx}`}
            label={`Round ${rIdx+1} MVP`}
            value={(awards.weekMvps||[])[rIdx]?.players||[]}
            count={(awards.weekMvps||[])[rIdx]?.count||1}
            onChange={v=>updateRoundMvp(rIdx,v)}
            onCountChange={c=>updateRoundCount(rIdx,c)}
            players={players}
            accent="#06d6a0"
          />
        ))}
        {/* Stage MVP — in multi-stage, only the active stage is shown */}
        {stageCount>0&&[activeStageIdx].map(sIdx=>(
          <MvpSelector
            key={`stage-${sIdx}`}
            label={`Stage ${sIdx+1} MVP`}
            value={(awards.stageMvps||[])[sIdx]?.players||[]}
            count={(awards.stageMvps||[])[sIdx]?.count||1}
            onChange={v=>updateStageMvp(sIdx,v)}
            onCountChange={c=>updateStageCount(sIdx,c)}
            players={players}
            accent="#457b9d"
          />
        ))}
        {/* Tournament / Final MVP */}
        {(!isMulti||isFinalStage)&&<MvpSelector
          label="Tournament MVP"
          value={awards.finalMvps||[]}
          count={awards.finalMvpCount||1}
          onChange={v=>onChange({...awards,finalMvps:v})}
          onCountChange={c=>onChange({...awards,finalMvpCount:c})}
          players={players}
          accent="#e9c46a"
        />}
      </div>
    </div>
  );
}


// ─── Shared UI ────────────────────────────────────────────────────────────────
const btn=(active,danger)=>({
  padding:"5px 12px",borderRadius:6,cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:12,
  letterSpacing:"0.05em",textTransform:"uppercase",border:active?"2px solid #e9c46a":danger?"1px solid rgba(230,57,70,0.4)":"1px solid var(--color-border-tertiary)",
  background:active?"rgba(233,196,106,0.12)":danger?"rgba(230,57,70,0.07)":"var(--color-background-primary)",
  color:active?"var(--color-text-primary)":danger?"#e63946":"var(--color-text-secondary)"
});

function TeamTag({name,color,small,seed}){
  return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,fontSize:small?11:13,letterSpacing:"0.03em",textTransform:"uppercase",color:"var(--color-text-primary)",whiteSpace:"nowrap"}}>
    {seed!=null&&<span style={{fontSize:9,fontWeight:800,color:"var(--color-text-tertiary)",minWidth:12,textAlign:"right"}}>#{seed}</span>}
    <span style={{width:small?8:10,height:small?8:10,borderRadius:2,background:color||"var(--color-border-tertiary)",flexShrink:0}}/>
    {name||<span style={{color:"var(--color-text-tertiary)",fontStyle:"italic",textTransform:"none"}}>TBD</span>}
  </span>;
}

const BRACKET_MOTIFS=[
  {left:"6%",top:"14%"},{left:"29%",top:"5%"},{left:"53%",top:"23%"},{left:"82%",top:"11%"},
  {left:"15%",top:"58%"},{left:"39%",top:"76%"},{left:"66%",top:"49%"},{left:"91%",top:"70%"}
];

function BracketCanvas({children,style}){
  return(
    <div style={{position:"relative",isolation:"isolate",overflow:"auto",overscrollBehaviorY:"auto",borderRadius:12,background:"rgba(100,116,139,0.025)",...style}}>
      <div aria-hidden="true" style={{position:"absolute",inset:0,zIndex:0,pointerEvents:"none",overflow:"hidden"}}>
        {BRACKET_MOTIFS.map((pos,i)=><span key={i} style={{position:"absolute",left:pos.left,top:pos.top,width:88,height:62,transform:"translate(-50%,-50%)",background:"#64748b",opacity:0.085,WebkitMaskImage:"url('/tourney-logo.png')",maskImage:"url('/tourney-logo.png')",WebkitMaskRepeat:"no-repeat",maskRepeat:"no-repeat",WebkitMaskPosition:"center",maskPosition:"center",WebkitMaskSize:"contain",maskSize:"contain"}}/>)}
      </div>
      <div style={{position:"relative",zIndex:1}}>{children}</div>
    </div>
  );
}

function HoverPanText({text}){
  const viewportRef=useRef(null);
  const textRef=useRef(null);
  const[pan,setPan]=useState({distance:0,duration:4.8});

  useEffect(()=>{
    const measure=()=>{
      const viewport=viewportRef.current,content=textRef.current;
      if(!viewport||!content)return;
      const distance=Math.max(0,Math.ceil(content.scrollWidth-viewport.clientWidth));
      setPan({distance,duration:Math.max(4.8,Math.min(8,4.2+distance/28))});
    };
    measure();
    if(typeof ResizeObserver==="undefined")return;
    const observer=new ResizeObserver(measure);
    observer.observe(viewportRef.current);
    return()=>observer.disconnect();
  },[text]);

  return <span ref={viewportRef} className={`match-team-name${pan.distance>0?" is-overflowing":""}`} title={text} style={{"--pan-distance":`${-pan.distance}px`,"--pan-duration":`${pan.duration}s`}}>
    <span ref={textRef} className="match-team-name__text">{text}</span>
  </span>;
}

function Stepper({label,value,min,max,onChange,small,disabled=false}){
  const sz=small?24:30;
  return <div style={{display:"flex",alignItems:"center",gap:6}}>
    {label&&<span style={{fontSize:11,fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",color:"var(--color-text-secondary)",whiteSpace:"nowrap"}}>{label}</span>}
    <button onClick={()=>!disabled&&onChange(Math.max(min,value-1))} disabled={disabled||value<=min} style={{width:sz,height:sz,borderRadius:5,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",cursor:disabled||value<=min?"not-allowed":"pointer",fontSize:14,color:"var(--color-text-primary)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,opacity:disabled||value<=min?0.35:1}}>−</button>
    <span style={{fontSize:small?16:20,fontWeight:800,minWidth:small?22:30,textAlign:"center",color:"var(--color-text-primary)",fontFamily:"'Barlow Condensed',sans-serif"}}>{value}</span>
    <button onClick={()=>!disabled&&onChange(Math.min(max,value+1))} disabled={disabled||value>=max} style={{width:sz,height:sz,borderRadius:5,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",cursor:disabled||value>=max?"not-allowed":"pointer",fontSize:14,color:"var(--color-text-primary)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,opacity:disabled||value>=max?0.35:1}}>+</button>
  </div>;
}

// ─── Player stat panel ────────────────────────────────────────────────────────
function PlayerStatPanel({match,gameIdx,statCols,onUpdate}){
  const game=match.games[gameIdx];
  const teams=[match.teamA,match.teamB].filter(Boolean);
  if(teams.length<2)return null;
  const getStat=(pname,col)=>game.stats?.[pname]?.[col]||"";
  const setStat=(pname,col,val)=>{const stats={...game.stats,[pname]:{...(game.stats?.[pname]||{}),[col]:val}};onUpdate(gameIdx,{stats});};
  const setMvp=(pname)=>onUpdate(gameIdx,{gameMvp:game.gameMvp===pname?null:pname});
  return(
    <div style={{marginTop:6,borderTop:"0.5px solid var(--color-border-tertiary)",paddingTop:6}}>
      {teams.map(team=>{
        const ps=(team.players||[]).filter(p=>p.role==="player"||p.role==="substitute");
        if(!ps.length)return<div key={team.name} style={{fontSize:10,color:"var(--color-text-tertiary)",fontStyle:"italic",marginBottom:4}}>No players in {team.name}</div>;
        return(
          <div key={team.name} style={{marginBottom:8}}>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:team.color,marginBottom:4}}>{team.name}</div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,fontFamily:"'Barlow Condensed',sans-serif"}}>
                <thead><tr style={{borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
                  <th style={{textAlign:"left",padding:"2px 4px",color:"var(--color-text-tertiary)",fontWeight:700,fontSize:9}}>Player</th>
                  {statCols.map(col=><th key={col} style={{textAlign:"center",padding:"2px 4px",color:"var(--color-text-tertiary)",fontWeight:700,fontSize:9,whiteSpace:"nowrap"}}>{col}</th>)}
                  <th style={{textAlign:"center",padding:"2px 4px",color:"#e9c46a",fontWeight:700,fontSize:9}}>MVP</th>
                </tr></thead>
                <tbody>{ps.map(p=>(
                  <tr key={p.name} style={{borderBottom:"0.5px solid var(--color-border-tertiary)",background:game.gameMvp===p.name?"rgba(233,196,106,0.07)":"transparent"}}>
                    <td style={{padding:"3px 4px",whiteSpace:"nowrap"}}><span style={{fontSize:10}}>{FLAG(p.nationality)}</span><span style={{marginLeft:3,color:"var(--color-text-primary)",fontWeight:600}}>{p.name}</span></td>
                    {statCols.map(col=>(
                      <td key={col} style={{padding:"2px 3px",textAlign:"center"}}>
                        <input value={getStat(p.name,col)} onChange={e=>setStat(p.name,col,e.target.value)} placeholder="—" style={{width:30,fontSize:10,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,textAlign:"center",border:"0.5px solid var(--color-border-tertiary)",borderRadius:3,background:"var(--color-background-secondary)",color:"var(--color-text-primary)",padding:"1px 0"}}/>
                      </td>
                    ))}
                    <td style={{textAlign:"center",padding:"2px 3px"}}>
                      <button onClick={()=>setMvp(p.name)} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,lineHeight:1,opacity:game.gameMvp===p.name?1:0.25,transition:"opacity 0.15s"}}>⭐</button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Match Card ───────────────────────────────────────────────────────────────
function GameSlot({game,gi,match,mode,onUpdate}){
  const isA=game.winnerName===match.teamA?.name,isB=game.winnerName===match.teamB?.name,isTie=!!game.isTie;
  const canTie=matchAllowsTie(match);
  const chooseWinner=(team,isSelected)=>onUpdate(gi,{winnerName:isSelected?null:team,isTie:false});
  const toggleTie=()=>onUpdate(gi,{winnerName:null,isTie:!isTie});
  const stepScore=(side,delta)=>{
    const key=side==="A"?"scoreA":"scoreB";
    const cur=parseFloat(game[key]);
    const next=Math.max(0,(Number.isFinite(cur)?cur:0)+delta);
    onUpdate(gi,{[key]:String(next)});
  };
  const ArrowButtons=({side})=>(
    <div style={{display:"flex",flexDirection:"column",gap:1}}>
      <button onClick={()=>stepScore(side,1)} title="+1" style={{width:16,height:10,borderRadius:2,border:"0.5px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-secondary)",cursor:"pointer",fontSize:8,lineHeight:1,padding:0}}>▲</button>
      <button onClick={()=>stepScore(side,-1)} title="-1" style={{width:16,height:10,borderRadius:2,border:"0.5px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-secondary)",cursor:"pointer",fontSize:8,lineHeight:1,padding:0}}>▼</button>
    </div>
  );
  if(mode==="wl")return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
      <span style={{fontSize:8,color:"var(--color-text-tertiary)",fontWeight:700}}>{match.games.length>1?`G${gi+1}`:"M"}</span>
      <div style={{display:"flex",gap:2}}>
        <button onClick={()=>chooseWinner(match.teamA.name,isA)} style={{padding:"2px 6px",borderRadius:3,border:"1px solid var(--color-border-tertiary)",background:isA?match.teamA.color:"var(--color-background-secondary)",color:isA?"white":"var(--color-text-secondary)",cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase"}}>{match.teamA.name.slice(0,4)}</button>
        <button onClick={()=>chooseWinner(match.teamB.name,isB)} style={{padding:"2px 6px",borderRadius:3,border:"1px solid var(--color-border-tertiary)",background:isB?match.teamB.color:"var(--color-background-secondary)",color:isB?"white":"var(--color-text-secondary)",cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase"}}>{match.teamB.name.slice(0,4)}</button>
        {canTie&&<button onClick={toggleTie} aria-label="Mark match tie" title="Mark match tie" style={{padding:"2px 6px",borderRadius:3,border:"1px solid var(--color-border-tertiary)",background:isTie?"#e9c46a":"var(--color-background-secondary)",color:isTie?"#2c2c00":"var(--color-text-secondary)",cursor:"pointer",fontSize:9,fontWeight:800,fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase"}}>Tie</button>}
      </div>
    </div>
  );
  if(mode==="games")return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
      <span style={{fontSize:8,color:"var(--color-text-tertiary)",fontWeight:700}}>G{gi+1}</span>
      <div style={{display:"flex",gap:2}}>
        <button onClick={()=>chooseWinner(match.teamA.name,isA)} style={{width:22,height:20,borderRadius:3,border:"1px solid var(--color-border-tertiary)",background:isA?match.teamA.color:"var(--color-background-secondary)",color:isA?"white":"var(--color-text-tertiary)",cursor:"pointer",fontSize:9,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>A</button>
        <button onClick={()=>chooseWinner(match.teamB.name,isB)} style={{width:22,height:20,borderRadius:3,border:"1px solid var(--color-border-tertiary)",background:isB?match.teamB.color:"var(--color-background-secondary)",color:isB?"white":"var(--color-text-tertiary)",cursor:"pointer",fontSize:9,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>B</button>
        {canTie&&<button onClick={toggleTie} aria-label="Mark game tie" title="Mark game tie" style={{width:22,height:20,borderRadius:3,border:"1px solid var(--color-border-tertiary)",background:isTie?"#e9c46a":"var(--color-background-secondary)",color:isTie?"#2c2c00":"var(--color-text-tertiary)",cursor:"pointer",fontSize:8,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center"}}>T</button>}
      </div>
    </div>
  );
  if(mode==="score"){
    const sA=game.scoreA??"",sB=game.scoreB??"",nA=parseFloat(sA)||0,nB=parseFloat(sB)||0;
    const gW=sA!==""&&sB!==""?(nA>nB?match.teamA:nB>nA?match.teamB:null):null;
    return(
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
        <span style={{fontSize:8,color:"var(--color-text-tertiary)",fontWeight:700}}>G{gi+1}</span>
        <div style={{display:"flex",alignItems:"center",gap:2}}>
          <input value={sA} onChange={e=>onUpdate(gi,{scoreA:e.target.value})} placeholder="0" style={{width:36,height:22,borderRadius:3,border:`1px solid ${gW?.name===match.teamA.name?match.teamA.color:"var(--color-border-tertiary)"}`,background:"var(--color-background-secondary)",color:"var(--color-text-primary)",fontSize:11,fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif",textAlign:"center",padding:0}}/>
          <ArrowButtons side="A"/>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:2}}>
          <input value={sB} onChange={e=>onUpdate(gi,{scoreB:e.target.value})} placeholder="0" style={{width:36,height:22,borderRadius:3,border:`1px solid ${gW?.name===match.teamB.name?match.teamB.color:"var(--color-border-tertiary)"}`,background:"var(--color-background-secondary)",color:"var(--color-text-primary)",fontSize:11,fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif",textAlign:"center",padding:0}}/>
          <ArrowButtons side="B"/>
        </div>
      </div>
    );
  }
  return null;
}

function MatchCard({match,onGameUpdate,statCols,onMatchUpdate,accentLabel}){
  const[open,setOpen]=useState(false);
  const ready=!!(match.teamA&&match.teamB);
  const result=ready?matchResult(match):{wA:0,wB:0,scoreA:0,scoreB:0,winner:null};
  const{wA,wB,scoreA,scoreB}=result;
  const winner=ready?bracketMatchWinner(match):null;
  const mode=match.matchMode;

  const TBDRow=()=><div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 24px",alignItems:"center",columnGap:6,padding:"2px 0"}}>
    <span style={{display:"inline-flex",alignItems:"center",gap:5,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,fontSize:11,textTransform:"uppercase",color:"var(--color-text-tertiary)",fontStyle:"italic"}}>
      <span style={{width:8,height:8,borderRadius:2,background:"var(--color-border-tertiary)",flexShrink:0}}/>TBD
    </span>
    <span style={{fontSize:18,fontWeight:800,color:"var(--color-border-tertiary)",textAlign:"right"}}>—</span>
  </div>;

  const TeamRow=({team,w,score})=>{
    const rf=regionFlag(team.region);
    return(
      <div style={{opacity:winner&&winner.name!==team.name?0.35:1}}>
        <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 46px 24px",alignItems:"center",columnGap:5}}>
          <span style={{display:"flex",alignItems:"center",gap:4,minWidth:0,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,fontSize:11,letterSpacing:"0.03em",textTransform:"uppercase",color:"var(--color-text-primary)"}}>
            {team.seed!=null&&<span style={{fontSize:9,fontWeight:800,color:"var(--color-text-tertiary)",minWidth:16,textAlign:"right",flexShrink:0}}>#{team.seed}</span>}
            <span style={{width:8,height:8,borderRadius:2,background:team.color||"var(--color-border-tertiary)",flexShrink:0}}/>
            <HoverPanText text={team.name}/>
          </span>
          <span title={team.region||""} style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",fontSize:9,color:"var(--color-text-tertiary)",fontFamily:"'Barlow Condensed',sans-serif",padding:team.region?"1px 4px":0,borderRadius:3,background:team.region?"var(--color-background-secondary)":"transparent",border:team.region?"0.5px solid var(--color-border-tertiary)":"none",whiteSpace:"nowrap",textAlign:"center"}}>{team.region&&<>{rf&&<span style={{marginRight:2}}>{rf}</span>}{team.region}</>}</span>
          <span style={{fontSize:20,fontWeight:800,fontVariantNumeric:"tabular-nums",color:w>0?team.color:"var(--color-text-tertiary)",width:24,textAlign:"right"}}>{ready?(mode==="score"?score:w):""}</span>
        </div>
      </div>
    );
  };

  return(
    <>
    <div className="match-card" onClick={()=>ready&&setOpen(true)} style={{background:ready?"#10141f":"#0b0d13",border:winner?`1.5px solid ${winner.color}66`:ready?"1px solid rgba(255,255,255,0.18)":"1px dashed rgba(255,255,255,0.2)",borderRadius:8,padding:"9px 11px",fontFamily:"'Barlow Condensed',sans-serif",width:210,minHeight:96,boxSizing:"border-box",opacity:ready?1:0.8,cursor:ready?"pointer":"default",boxShadow:"0 8px 22px rgba(0,0,0,0.16)",color:"#f8fafc","--color-text-primary":"#f8fafc","--color-text-secondary":"rgba(248,250,252,0.82)","--color-text-tertiary":"rgba(248,250,252,0.62)","--color-background-primary":"#0b0d13","--color-background-secondary":"rgba(255,255,255,0.07)","--color-border-tertiary":"rgba(255,255,255,0.2)"}}>
      {accentLabel&&<div style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:4}}>{accentLabel}</div>}
      <div style={{marginBottom:8}}>{match.teamA?<TeamRow team={match.teamA} w={wA} score={scoreA}/>:<TBDRow/>}</div>
      <div style={{marginTop:8}}>{match.teamB?<TeamRow team={match.teamB} w={wB} score={scoreB}/>:<TBDRow/>}</div>
      <div style={{marginTop:8,paddingTop:6,borderTop:"0.5px solid var(--color-border-tertiary)",fontSize:11,display:"flex",alignItems:"center",gap:5,minHeight:18}}>
        {match.mvp?<span style={{marginLeft:"auto",color:"#e9c46a",fontWeight:800,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>MVP {match.mvp}</span>:<span aria-hidden="true" style={{display:"block",height:14}}/>}
      </div>
    </div>
    {open&&typeof document!=="undefined"&&createPortal(<MatchDetailsModal match={match} statCols={statCols} onClose={()=>setOpen(false)} onGameUpdate={onGameUpdate} onMatchUpdate={onMatchUpdate}/>,document.body)}
    </>
  );
}

function MatchDetailsModal({match,onClose,onGameUpdate,onMatchUpdate,statCols}){
  const[activeGame,setActiveGame]=useState(0);
  const ready=!!(match.teamA&&match.teamB);
  const{wA,wB,scoreA,scoreB,winner}=ready?matchResult(match):{wA:0,wB:0,scoreA:0,scoreB:0,winner:null};
  const allPlayers=ready?[...(match.teamA.players||[]).filter(p=>p.role==="player"||p.role==="substitute").map(p=>({...p,team:match.teamA})),...(match.teamB.players||[]).filter(p=>p.role==="player"||p.role==="substitute").map(p=>({...p,team:match.teamB}))]:[];
  const activeGameIdx=Math.min(activeGame,Math.max(0,match.games.length-1));
  const addGame=()=>{
    const nextGame={id:match.games.length,winnerName:null,isTie:false,scoreA:"",scoreB:"",gameMvp:null,stats:{}};
    onMatchUpdate({games:[...match.games,nextGame]});
    setActiveGame(match.games.length);
  };
  const deleteGame=()=>{
    if(match.games.length<=1)return;
    const nextGames=match.games.filter((_,idx)=>idx!==activeGameIdx).map((game,idx)=>({...game,id:idx}));
    onMatchUpdate({games:nextGames});
    setActiveGame(Math.min(activeGameIdx,nextGames.length-1));
  };
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",padding:18}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"min(760px,100%)",maxHeight:"88vh",overflowY:"auto",background:"#000",border:"1px solid rgba(255,255,255,0.22)",borderRadius:10,boxShadow:"0 24px 80px rgba(0,0,0,0.65)",padding:"16px 18px",fontFamily:"'Barlow Condensed',sans-serif",color:"#fff","--color-text-primary":"#fff","--color-text-secondary":"rgba(255,255,255,0.84)","--color-text-tertiary":"rgba(255,255,255,0.64)","--color-background-primary":"#000","--color-background-secondary":"#111","--color-border-tertiary":"rgba(255,255,255,0.24)","--color-border-secondary":"rgba(255,255,255,0.32)"}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:14}}>
          <div style={{flex:1}}>
            <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.09em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:4}}>Match Details</div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",fontSize:18,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.04em"}}>
              <TeamTag name={match.teamA?.name||"TBD"} color={match.teamA?.color} seed={match.teamA?.seed}/>
              <span style={{fontSize:13,color:"var(--color-text-tertiary)"}}>vs</span>
              <TeamTag name={match.teamB?.name||"TBD"} color={match.teamB?.color} seed={match.teamB?.seed}/>
            </div>
          </div>
          <button onClick={onClose} style={{width:30,height:30,borderRadius:6,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-secondary)",color:"var(--color-text-secondary)",cursor:"pointer",fontSize:18,lineHeight:1}}>×</button>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10,marginBottom:14}}>
          {[match.teamA,match.teamB].filter(Boolean).map((team,idx)=>(
            <div key={team.name} style={{padding:"10px 12px",borderRadius:8,border:`1px solid ${winner?.name===team.name?team.color:"var(--color-border-tertiary)"}`,background:"var(--color-background-secondary)"}}>
              <TeamTag name={team.name} color={team.color} seed={team.seed}/>
              <div style={{fontSize:28,fontWeight:800,color:team.color,marginTop:3}}>{match.matchMode==="score"?(idx===0?scoreA:scoreB):(idx===0?wA:wB)}</div>
            </div>
          ))}
        </div>

        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
          {match.games.map((g,gi)=>(
            <button key={gi} onClick={()=>setActiveGame(gi)} style={{...btn(activeGameIdx===gi),padding:"4px 10px",position:"relative"}}>
              Game {gi+1}{g.gameMvp&&<span style={{position:"absolute",top:-5,right:-5,fontSize:9}}>⭐</span>}
            </button>
          ))}
          <button onClick={addGame} style={{...btn(false),padding:"4px 10px",borderColor:"rgba(42,157,143,0.45)",color:"#2a9d8f"}}>+ Game</button>
          {match.games.length>1&&<button onClick={deleteGame} style={{...btn(false),padding:"4px 10px",borderColor:"rgba(230,57,70,0.5)",color:"#e63946"}}>Delete Game</button>}
        </div>

        <div style={{padding:"12px",borderRadius:8,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-secondary)",marginBottom:12}}>
          <GameSlot game={match.games[activeGameIdx]} gi={activeGameIdx} match={match} mode={match.matchMode} onUpdate={onGameUpdate}/>
        </div>

        {allPlayers.length>0&&(
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            <span style={{fontSize:11,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:"#e9c46a"}}>Match MVP</span>
            <select value={match.mvp||""} onChange={e=>onMatchUpdate({mvp:e.target.value||null})} style={{fontSize:12,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,border:"0.5px solid rgba(233,196,106,0.4)",borderRadius:5,background:"rgba(233,196,106,0.07)",color:"var(--color-text-primary)",padding:"4px 7px",cursor:"pointer"}}>
              <option value="">No MVP yet</option>
              {[match.teamA,match.teamB].map(team=><optgroup key={team.name} label={team.name}>{(team.players||[]).filter(p=>p.role==="player"||p.role==="substitute").map(p=><option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>)}
            </select>
          </div>
        )}

        {allPlayers.length>0&&<PlayerStatPanel match={match} gameIdx={activeGameIdx} statCols={statCols} onUpdate={onGameUpdate}/>}
      </div>
    </div>
  );
}

// ─── Standings tables ─────────────────────────────────────────────────────────
function TeamStandingsTable({teams,matches,title,showScore,standingsRules}){
  const realMatches=playableMatches(matches);
  const rules=normalizeStandingsRules(standingsRules);
  const st=computeTeamStandings(teams,realMatches,rules);
  const allDone=realMatches.length>0&&realMatches.every(matchIsComplete);
  const tieCapable=realMatches.some(match=>matchAllowsTie(match)||match.matchMode==="score");
  const showMatchTies=tieCapable||st.some(row=>row.mt>0);
  const showGameTies=tieCapable||st.some(row=>row.gt>0);
  return(
    <div style={{background:"var(--color-background-primary)",border:"0.5px solid var(--color-border-tertiary)",borderRadius:10,padding:"12px 14px"}}>
      {title&&<div style={{fontSize:10,fontWeight:700,letterSpacing:"0.09em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:10}}>{title}</div>}
      {standingsRules&&<div style={{fontSize:10,color:"var(--color-text-tertiary)",marginBottom:8,fontFamily:"'Barlow',sans-serif"}}>{rules.summary}</div>}
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,fontFamily:"'Barlow Condensed',sans-serif"}}>
          <thead><tr style={{borderBottom:"1.5px solid var(--color-border-tertiary)"}}>
            {["#","Team","MP","MW",...(showMatchTies?["MT"]:[]),"ML","GW",...(showGameTies?["GT"]:[]),"GL",...(showScore?["SW","SL"]:[]),"Pts"].map(h=><th key={h} style={{padding:"4px 5px",color:"var(--color-text-tertiary)",fontWeight:700,textAlign:h==="Team"?"left":"center",letterSpacing:"0.05em",fontSize:10,whiteSpace:"nowrap"}}>{h}</th>)}
          </tr></thead>
          <tbody>{st.map((row,i)=>(
            <tr key={row.team.name} style={{borderBottom:"0.5px solid var(--color-border-tertiary)",background:i===0&&row.mw>0?"rgba(233,196,106,0.08)":"transparent"}}>
              <td style={{padding:"5px 5px",textAlign:"center",color:i===0&&row.mw>0?"#e9c46a":"var(--color-text-tertiary)",fontWeight:700,fontSize:11}}>{i+1}</td>
              <td style={{padding:"5px 5px"}}><div style={{display:"flex",alignItems:"center",gap:4}}><TeamTag name={row.team.name} color={row.team.color} seed={row.team.seed} small/>{row.team.region&&<span style={{fontSize:9,color:"var(--color-text-tertiary)",padding:"1px 4px",borderRadius:3,background:"var(--color-background-secondary)",border:"0.5px solid var(--color-border-tertiary)",whiteSpace:"nowrap"}}>{regionFlag(row.team.region)&&<span style={{marginRight:2}}>{regionFlag(row.team.region)}</span>}{row.team.region}</span>}</div></td>
              <td style={{padding:"5px 5px",textAlign:"center",color:"var(--color-text-secondary)"}}>{row.played}</td>
              <td style={{padding:"5px 5px",textAlign:"center",color:"#2a9d8f",fontWeight:700}}>{row.mw}</td>
              {showMatchTies&&<td style={{padding:"5px 5px",textAlign:"center",color:"#e9c46a"}}>{row.mt}</td>}
              <td style={{padding:"5px 5px",textAlign:"center",color:"#e63946"}}>{row.ml}</td>
              <td style={{padding:"5px 5px",textAlign:"center",color:"#2a9d8f"}}>{row.gw}</td>
              {showGameTies&&<td style={{padding:"5px 5px",textAlign:"center",color:"#e9c46a"}}>{row.gt}</td>}
              <td style={{padding:"5px 5px",textAlign:"center",color:"#e63946"}}>{row.gl}</td>
              {showScore&&<><td style={{padding:"5px 5px",textAlign:"center",color:"#2a9d8f"}}>{row.sw}</td><td style={{padding:"5px 5px",textAlign:"center",color:"#e63946"}}>{row.sl}</td></>}
              <td style={{padding:"5px 5px",textAlign:"center",fontWeight:800,fontSize:14}}>{row.pts}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {allDone&&st[0]?.mw>0&&<div style={{marginTop:8,fontSize:12,display:"flex",alignItems:"center",gap:5,fontFamily:"'Barlow Condensed',sans-serif"}}><span style={{color:"#e9c46a"}}>🏆</span><TeamTag name={st[0].team.name} color={st[0].team.color} small/><span style={{color:"var(--color-text-tertiary)"}}>· {st[0].pts} pts</span></div>}
    </div>
  );
}

function PlayerStandingsTable({teams,matches,statCols,title,sortBy,onSortBy,stageMatchSets=[]}){
  const players=computePlayerStandings(teams,playableMatches(matches),statCols,stageMatchSets.map(playableMatches));
  const stageCols=stageMatchSets.map((_,idx)=>`stage-${idx}`);
  const sorted=[...players].sort((a,b)=>{
    if(sortBy==="name")return a.name.localeCompare(b.name);
    if(sortBy==="nationality")return (a.nationality||"").localeCompare(b.nationality||"");
    if(sortBy==="team")return (a.team?.name||"").localeCompare(b.team?.name||"");
    if(sortBy==="mw")return b.mw-a.mw;
    if(sortBy==="gameMvps")return b.gameMvps-a.gameMvps;
    if(sortBy==="matchMvps")return b.matchMvps-a.matchMvps;
    if(sortBy?.startsWith("stage-")){
      const idx=parseInt(sortBy.split("-")[1],10);
      return (b.stageWins?.[idx]||0)-(a.stageWins?.[idx]||0);
    }
    const va=parseFloat(a.stats[sortBy])||0,vb=parseFloat(b.stats[sortBy])||0;
    return vb-va;
  });
  if(!sorted.length)return<div style={{fontSize:12,color:"var(--color-text-tertiary)",fontStyle:"italic",padding:"8px 0"}}>No player data yet.</div>;
  const cols=["nationality","team","mw",...stageCols,"gameMvps","matchMvps",...statCols];
  const colLabel=c=>c==="nationality"?"Nat":c==="team"?"Team":c==="mw"?"Wins":c==="gameMvps"?"Game MVP":c==="matchMvps"?"Match MVP":c.startsWith("stage-")?`S${parseInt(c.split("-")[1],10)+1} Wins`:c;
  return(
    <div style={{background:"var(--color-background-primary)",border:"0.5px solid var(--color-border-tertiary)",borderRadius:10,padding:"12px 14px"}}>
      {title&&<div style={{fontSize:10,fontWeight:700,letterSpacing:"0.09em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:10}}>{title}</div>}
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,fontFamily:"'Barlow Condensed',sans-serif"}}>
          <thead><tr style={{borderBottom:"1.5px solid var(--color-border-tertiary)"}}>
            <th style={{padding:"4px 5px",color:"var(--color-text-tertiary)",fontWeight:700,textAlign:"center",fontSize:10}}>#</th>
            <th onClick={()=>onSortBy("name")} style={{padding:"4px 5px",color:sortBy==="name"?"#e9c46a":"var(--color-text-tertiary)",fontWeight:700,textAlign:"left",fontSize:10,cursor:"pointer"}}>Player{sortBy==="name"?" ↓":""}</th>
            {cols.map(c=>(
              <th key={c} onClick={()=>onSortBy(c)} style={{padding:"4px 5px",color:sortBy===c?"#e9c46a":"var(--color-text-tertiary)",fontWeight:700,textAlign:"center",fontSize:10,cursor:"pointer",whiteSpace:"nowrap",textDecoration:sortBy===c?"underline":"none"}}>
                {colLabel(c)}{sortBy===c?" ↓":""}
              </th>
            ))}
          </tr></thead>
          <tbody>{sorted.map((p,i)=>(
            <tr key={p.name} style={{borderBottom:"0.5px solid var(--color-border-tertiary)",background:i===0?"rgba(233,196,106,0.06)":"transparent"}}>
              <td style={{padding:"5px 5px",textAlign:"center",color:i===0?"#e9c46a":"var(--color-text-tertiary)",fontWeight:700,fontSize:11}}>{i+1}</td>
              <td style={{padding:"5px 5px",whiteSpace:"nowrap"}}><span style={{fontWeight:600,color:"var(--color-text-primary)"}}>{p.name}</span></td>
              <td style={{padding:"5px 5px",textAlign:"center",whiteSpace:"nowrap"}}><span style={{marginRight:3}}>{FLAG(p.nationality)}</span>{p.nationality?p.nationality.toUpperCase():"—"}</td>
              <td style={{padding:"5px 5px"}}><TeamTag name={p.team.name} color={p.team.color} small/></td>
              <td style={{padding:"5px 5px",textAlign:"center",color:"#2a9d8f",fontWeight:700}}>{p.mw}</td>
              {stageCols.map((c,idx)=><td key={c} style={{padding:"5px 5px",textAlign:"center",color:sortBy===c?"#e9c46a":"var(--color-text-secondary)",fontWeight:sortBy===c?800:600}}>{p.stageWins?.[idx]||0}</td>)}
              <td style={{padding:"5px 5px",textAlign:"center",color:"#e9c46a"}}>{p.gameMvps||"—"}</td>
              <td style={{padding:"5px 5px",textAlign:"center",color:"#e9c46a"}}>{p.matchMvps||"—"}</td>
              {statCols.map(col=><td key={col} style={{padding:"5px 5px",textAlign:"center",color:"var(--color-text-primary)",fontWeight:sortBy===col?700:400}}>{p.stats[col]||"—"}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Bracket display ──────────────────────────────────────────────────────────
function ElimBracket({rounds,onGameUpdate,onMatchUpdate,statCols,labelPrefix}){
  if(!rounds?.length)return null;
  const CARD_H=132,CARD_W=230,CONN_W=38,base=rounds[0].length;
  const slotInfo=(rIdx,mIdx)=>{
    const m=rounds[rIdx].length;
    const slotH=(base/m)*CARD_H;
    const top=Math.max(0,(slotH-CARD_H)/2)+mIdx*slotH;
    return {top,mid:top+CARD_H/2,slotH};
  };
  const label=(m,rIdx)=>{
    if(labelPrefix)return`${labelPrefix} R${rIdx+1}`;
    return m===1?"Final":m===2?"Semifinals":m===4?"Quarterfinals":`Round of ${m*2}`;
  };
  return(
    <div style={{display:"flex",alignItems:"flex-start",minWidth:"max-content"}}>
      {rounds.map((round,rIdx)=>{
        const m=round.length;
        const height=base*CARD_H;
        return(
          <div key={rIdx} style={{display:"flex",alignItems:"flex-start",flexShrink:0}}>
          <div style={{width:CARD_W}}>
            <div style={{fontSize:9,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:8}}>{label(m,rIdx)}</div>
            <div style={{position:"relative",height}}>
              {round.map((match,mIdx)=>{
                if(isByeMatch(match))return null;
                const {top}=slotInfo(rIdx,mIdx);
                return(
                  <div key={match.id} style={{position:"absolute",top,left:0,height:CARD_H,display:"flex",alignItems:"center"}}>
                    <MatchCard match={match} statCols={statCols} onGameUpdate={(gi,upd)=>onGameUpdate(match.id,gi,upd)} onMatchUpdate={upd=>onMatchUpdate(match.id,upd)}/>
                  </div>
                );
              })}
            </div>
          </div>
          {rIdx<rounds.length-1&&(
            <div style={{width:CONN_W,position:"relative",height:height+18,marginTop:17,flexShrink:0,pointerEvents:"none"}}>
              <svg width={CONN_W} height={height} style={{position:"absolute",top:0,left:0,overflow:"visible"}}>
                {round.map((match,mIdx)=>{
                  if(isByeMatch(match))return null;
                  const nextIdx=Math.floor(mIdx/2);
                  const nextMatch=rounds[rIdx+1]?.[nextIdx];
                  if(!nextMatch||isByeMatch(nextMatch))return null;
                  const from=slotInfo(rIdx,mIdx).mid;
                  const to=slotInfo(rIdx+1,nextIdx).mid;
                  const winner=bracketMatchWinner(match);
                  const stroke=winner?.color||"var(--color-border-tertiary)";
                  return <path key={match.id} d={`M0 ${from} H${CONN_W/2} V${to} H${CONN_W}`} fill="none" stroke={stroke} strokeWidth="2" opacity={winner?0.85:0.35}/>;
                })}
              </svg>
            </div>
          )}
          </div>
        );
      })}
    </div>
  );
}

function SingleElimView({bracketData,onGameUpdate,onMatchUpdate,statCols}){
  const{winners}=bracketData;
  if(!winners?.length)return null;
  const CARD_H=132,base=winners[0].length;
  const fm=winners[winners.length-1][0];
  const champ=fm?bracketMatchWinner(fm):null;
  const tb=bracketData.qualificationTiebreaker;
  return(
    <BracketCanvas style={{overflowX:"auto",padding:"18px 14px 20px"}}>
      <div style={{display:"flex",flexDirection:"column",gap:24,minWidth:"max-content"}}>
        <div style={{display:"flex",gap:24,alignItems:"flex-start"}}>
          <ElimBracket rounds={winners} onGameUpdate={onGameUpdate} onMatchUpdate={onMatchUpdate} statCols={statCols}/>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}}>
            <div style={{fontSize:9,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:8}}>Champion</div>
            <div style={{paddingTop:Math.max(0,(base/2-0.45)*CARD_H)+"px"}}>
              <div style={{width:200,height:52,border:"2px solid "+(champ?"#e9c46a":"var(--color-border-tertiary)"),borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",background:champ?"rgba(233,196,106,0.08)":"var(--color-background-secondary)",fontFamily:"'Barlow Condensed',sans-serif"}}>
                {champ?<TeamTag name={"🏆 "+champ.name} color={champ.color}/>:<span style={{fontSize:12,color:"var(--color-text-tertiary)",fontStyle:"italic"}}>TBD</span>}
              </div>
            </div>
          </div>
        </div>
        {tb?.rounds?.length>0&&(
          <div style={{paddingTop:18,borderTop:"1px solid var(--color-border-tertiary)"}}>
            <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:"#b8921a",marginBottom:12}}>Qualification Tiebreaker · {tb.target} slot{tb.target===1?"":"s"}</div>
            <ElimBracket rounds={tb.rounds} onGameUpdate={onGameUpdate} onMatchUpdate={onMatchUpdate} statCols={statCols} labelPrefix="TB"/>
          </div>
        )}
      </div>
    </BracketCanvas>
  );
}

function DoubleElimView({bracketData,onGameUpdate,onMatchUpdate,statCols}){
  const propagated=propagateDoubleElim(bracketData);
  const gfRes=matchResult(propagated.grandFinal);
  const gfrRes=matchResult(propagated.grandFinalReset);
  const wbSideWonGF=gfRes.winner&&gfRes.winner.name===propagated.grandFinal.teamA?.name;
  const resetNeeded=gfRes.winner&&gfRes.winner.name===propagated.grandFinal.teamB?.name;
  const champion=wbSideWonGF?gfRes.winner:gfrRes.winner||null;
  const tb=bracketData.qualificationTiebreaker;

  // We display propagated data but use original for edits
  return(
    <BracketCanvas style={{overflowX:"auto",padding:"18px 14px 20px"}}>
      <div style={{display:"flex",gap:28,alignItems:"flex-start",minWidth:"max-content"}}>
        <div style={{display:"flex",flexDirection:"column",gap:24}}>
          <div>
            <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:"#2a9d8f",marginBottom:12}}>Winners Bracket</div>
            <ElimBracket rounds={propagated.winners} onGameUpdate={onGameUpdate} onMatchUpdate={onMatchUpdate} statCols={statCols}/>
          </div>
          <div style={{height:1,background:"var(--color-border-tertiary)",width:"100%"}}/>
          <div>
            <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:"#e63946",marginBottom:12}}>Losers Bracket</div>
            {propagated.losers.length>0?<ElimBracket rounds={propagated.losers} onGameUpdate={onGameUpdate} onMatchUpdate={onMatchUpdate} statCols={statCols} labelPrefix="LB"/>:<div style={{fontSize:12,color:"var(--color-text-tertiary)",fontStyle:"italic"}}>No losers yet</div>}
          </div>
          {tb?.rounds?.length>0&&(
            <div style={{paddingTop:18,borderTop:"1px solid var(--color-border-tertiary)"}}>
              <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:"#b8921a",marginBottom:12}}>Qualification Tiebreaker · {tb.target} slot{tb.target===1?"":"s"}</div>
              <ElimBracket rounds={tb.rounds} onGameUpdate={onGameUpdate} onMatchUpdate={onMatchUpdate} statCols={statCols} labelPrefix="TB"/>
            </div>
          )}
        </div>
        <div style={{width:1,background:"var(--color-border-tertiary)",alignSelf:"stretch",flexShrink:0}}/>
        <div style={{flexShrink:0}}>
          <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:"#e9c46a",marginBottom:12}}>Grand Final</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <MatchCard match={propagated.grandFinal} statCols={statCols} accentLabel="Grand Final" onGameUpdate={(gi,upd)=>onGameUpdate(propagated.grandFinal.id,gi,upd)} onMatchUpdate={upd=>onMatchUpdate(propagated.grandFinal.id,upd)}/>
            <div style={{fontSize:10,color:resetNeeded?"#e9c46a":"var(--color-text-tertiary)",fontStyle:"italic",textAlign:"center",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:resetNeeded?700:400}}>{resetNeeded?"⚡ Bracket Reset required!":"If Losers side wins → reset"}</div>
            <div style={{opacity:resetNeeded?1:0.4,transition:"opacity 0.2s"}}>
              <MatchCard match={propagated.grandFinalReset} statCols={statCols} accentLabel="Bracket Reset" onGameUpdate={(gi,upd)=>onGameUpdate(propagated.grandFinalReset.id,gi,upd)} onMatchUpdate={upd=>onMatchUpdate(propagated.grandFinalReset.id,upd)}/>
            </div>
            {champion&&<div style={{marginTop:8,padding:"10px 14px",borderRadius:8,border:"2px solid #e9c46a",background:"rgba(233,196,106,0.07)",display:"flex",alignItems:"center",gap:8,fontFamily:"'Barlow Condensed',sans-serif"}}><span style={{fontSize:16}}>🏆</span><TeamTag name={champion.name} color={champion.color}/></div>}
          </div>
        </div>
      </div>
    </BracketCanvas>
  );
}

// ─── Round Robin view with rounds ─────────────────────────────────────────────
function RoundRobinView({rrRounds,teams,onGameUpdate,onMatchUpdate,onAddTiebreakRound,matchMode,statCols,standingsRules}){
  const[activeRound,setActiveRound]=useState(0);
  const[playerSort,setPlayerSort]=useState("mw");
  const[showPlayers,setShowPlayers]=useState(false);
  const total=rrRounds.length,all=rrRounds.flat();
  const done=all.filter(matchIsComplete).length;
  const pct=all.length>0?Math.round(done/all.length*100):0;

  const gpm=rrRounds[0]?.[0]?.games?.length||1;
  const pendingTiebreak=buildRoundRobinTiebreakRound(teams,rrRounds,matchMode,gpm,standingsRules);
  const currentRound=Math.min(activeRound,Math.max(0,total-1));
  const curRound=rrRounds[currentRound]||[];
  const matchesUpToRound=rrRounds.slice(0,currentRound+1).flat();

  useEffect(()=>{
    if(total>0&&activeRound>=total)setActiveRound(total-1);
  },[activeRound,total]);

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        <div style={{flex:1,height:4,background:"var(--color-background-secondary)",borderRadius:2,overflow:"hidden",minWidth:80}}><div style={{width:pct+"%",height:"100%",background:"#2a9d8f",transition:"width 0.3s"}}/></div>
        <span style={{fontSize:11,color:"var(--color-text-tertiary)",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,whiteSpace:"nowrap"}}>{done}/{all.length} matches</span>
      </div>
      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:16}}>
        {rrRounds.map((round,rIdx)=>{
          const allDone=round.every(matchIsComplete)&&round.length>0;
          const isTiebreak=round.some(m=>m._tiebreak);
          return(
            <button key={rIdx} onClick={()=>setActiveRound(rIdx)} style={{...btn(currentRound===rIdx),padding:"5px 11px",borderRadius:6,cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:12,letterSpacing:"0.05em",textTransform:"uppercase",position:"relative"}}>
              {isTiebreak?"TB":`R${rIdx+1}`}
              <span style={{fontSize:9,display:"block",fontWeight:500,color:"var(--color-text-tertiary)",lineHeight:1}}>{round.length} match{round.length===1?"":"es"}</span>
              {allDone&&<span style={{position:"absolute",top:-4,right:-4,width:8,height:8,borderRadius:"50%",background:"#2a9d8f",border:"1.5px solid var(--color-background-primary)"}}/>}
            </button>
          );
        })}
        {pendingTiebreak&&onAddTiebreakRound&&(
          <button onClick={()=>{onAddTiebreakRound(pendingTiebreak);setActiveRound(total);}} style={{...btn(false),padding:"5px 11px",borderRadius:6,cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:12,letterSpacing:"0.05em",textTransform:"uppercase",borderColor:"rgba(233,196,106,0.55)",color:"#b8921a"}}>
            TB
            <span style={{fontSize:9,display:"block",fontWeight:500,color:"var(--color-text-tertiary)",lineHeight:1}}>Add</span>
          </button>
        )}
      </div>

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif"}}>
          <span style={{fontSize:17,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase",color:"var(--color-text-primary)"}}>{curRound.some(m=>m._tiebreak)?"Tiebreaker Round":`Round ${currentRound+1}`}</span>
          <span style={{fontSize:12,color:"var(--color-text-tertiary)",marginLeft:10}}>{curRound.length} match{curRound.length===1?"":"es"}</span>
        </div>
        <button onClick={()=>setShowPlayers(p=>!p)} style={{...btn(showPlayers),padding:"4px 10px"}}>
          {showPlayers?"🏆 Teams":"👤 Players"}
        </button>
      </div>

      <BracketCanvas style={{padding:"16px 14px 2px"}}>
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--color-text-tertiary)",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:8,fontFamily:"'Barlow Condensed',sans-serif"}}>{curRound.some(m=>m._tiebreak)?"Tiebreaker Round":`Round ${currentRound+1}`}</div>
          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>{curRound.map(m=><MatchCard key={m.id} match={m} statCols={statCols} onGameUpdate={(gi,upd)=>onGameUpdate(m.id,gi,upd)} onMatchUpdate={upd=>onMatchUpdate(m.id,upd)}/>)}</div>
        </div>
      </BracketCanvas>

      <div style={{marginTop:24}}>
        {!showPlayers
          ?<TeamStandingsTable teams={teams} matches={matchesUpToRound} title={`Team Standings — through Round ${currentRound+1}`} showScore={matchMode==="score"} standingsRules={standingsRules}/>
          :<PlayerStandingsTable teams={teams} matches={matchesUpToRound} statCols={statCols} title={`Player Standings — through Round ${currentRound+1}`} sortBy={playerSort} onSortBy={setPlayerSort}/>}
      </div>
    </div>
  );
}

function GroupStageView({data,onStageUpdate,onGameUpdate,onMatchUpdate,matchMode,statCols,standingsRules}){
  const[activeGroup,setActiveGroup]=useState(0);
  const groups=data.groups||[];
  const poolChoice=data.poolChoice;
  const pools=data.pools||[];
  const groupCount=data.groupCount||Math.max(2,groups.length||2);
  const gpm=data.gpm||1;
  const mode=data.matchMode||matchMode;

  const choosePools=()=>{
    onStageUpdate(d=>({...d,poolChoice:true,pools:makePools(d.teams||[],d.groupCount||2),poolsConfirmed:false,groups:[]}));
  };
  const skipPools=()=>{
    onStageUpdate(d=>({...d,poolChoice:false,pools:[],poolsConfirmed:true,groups:makeSeededGroups(d.teams||[],d.groupCount||2,d.gpm||1,d.matchMode||matchMode)}));
  };
  const moveTeam=(poolIdx,teamIdx,delta)=>{
    onStageUpdate(d=>({...d,pools:movePooledTeam(d.pools||[],poolIdx,teamIdx,delta,d.groupCount||2)}));
  };
  const randomizeFromPools=()=>{
    onStageUpdate(d=>({...d,poolsConfirmed:true,groups:makeGroupsFromPools(d.pools||[],d.groupCount||2,d.gpm||1,d.matchMode||matchMode)}));
  };

  if(!data.poolsConfirmed&&groups.length===0){
    return(
      <div style={{padding:"16px",borderRadius:10,border:"1px solid rgba(42,157,143,0.35)",background:"rgba(42,157,143,0.06)",fontFamily:"'Barlow Condensed',sans-serif"}}>
        <div style={{fontSize:13,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:"#2a9d8f",marginBottom:6}}>Group Stage Setup</div>
        {poolChoice==null&&(
          <>
            <div style={{fontSize:12,color:"var(--color-text-tertiary)",marginBottom:12,fontFamily:"'Barlow',sans-serif"}}>Use pools before drawing groups? Pool size equals the number of groups. Pool 1 starts with the highest seeds; later pools contain lower seeds.</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={choosePools} style={{padding:"7px 16px",borderRadius:7,border:"none",background:"#2a9d8f",color:"white",cursor:"pointer",fontWeight:800,textTransform:"uppercase",letterSpacing:"0.05em",fontFamily:"'Barlow Condensed',sans-serif"}}>Use Pools</button>
              <button onClick={skipPools} style={{padding:"7px 16px",borderRadius:7,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-secondary)",cursor:"pointer",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",fontFamily:"'Barlow Condensed',sans-serif"}}>No Pools</button>
            </div>
          </>
        )}
        {poolChoice===true&&(
          <>
            <div style={{fontSize:12,color:"var(--color-text-tertiary)",marginBottom:12,fontFamily:"'Barlow',sans-serif"}}>Adjust seed positions if needed, then randomize. Each group will receive one representative from every pool.</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,marginBottom:14}}>
              {pools.map((pool,pIdx)=>(
                <div key={pool.name} style={{background:"var(--color-background-primary)",border:"1px solid var(--color-border-tertiary)",borderRadius:8,padding:"10px"}}>
                  <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:pIdx===0?"#2a9d8f":"var(--color-text-tertiary)",marginBottom:8}}>{pool.name}</div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {pool.teams.map((team,tIdx)=>(
                      <div key={`${team.name}-${tIdx}`} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 6px",borderRadius:6,background:"var(--color-background-secondary)",border:"0.5px solid var(--color-border-tertiary)"}}>
                        <TeamTag name={team.name} color={team.color} seed={team.seed} small/>
                        <div style={{marginLeft:"auto",display:"flex",gap:3}}>
                          <button onClick={()=>moveTeam(pIdx,tIdx,-1)} style={{width:20,height:20,borderRadius:4,border:"0.5px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-secondary)",cursor:"pointer"}}>↑</button>
                          <button onClick={()=>moveTeam(pIdx,tIdx,1)} style={{width:20,height:20,borderRadius:4,border:"0.5px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-secondary)",cursor:"pointer"}}>↓</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={randomizeFromPools} style={{padding:"8px 18px",borderRadius:8,border:"none",background:"#e9c46a",color:"#2c2c00",cursor:"pointer",fontWeight:800,textTransform:"uppercase",letterSpacing:"0.06em",fontFamily:"'Barlow Condensed',sans-serif"}}>Randomize Groups</button>
          </>
        )}
      </div>
    );
  }

  const group=groups[activeGroup]||groups[0];
  const allMatches=groups.flatMap(g=>(g.rounds||[]).flat());
  const done=allMatches.filter(matchIsComplete).length;
  const pct=allMatches.length>0?Math.round(done/allMatches.length*100):0;

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
        <div style={{flex:1,height:4,background:"var(--color-background-secondary)",borderRadius:2,overflow:"hidden",minWidth:80}}><div style={{width:pct+"%",height:"100%",background:"#2a9d8f",transition:"width 0.3s"}}/></div>
        <span style={{fontSize:11,color:"var(--color-text-tertiary)",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,whiteSpace:"nowrap"}}>{done}/{allMatches.length} group matches</span>
      </div>
      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:14}}>
        {groups.map((g,idx)=>{
          const matches=(g.rounds||[]).flat();
          const complete=matches.length>0&&matches.every(matchIsComplete);
          return(
            <button key={g.name} onClick={()=>setActiveGroup(idx)} style={{...btn(activeGroup===idx),padding:"6px 12px",fontSize:12,position:"relative"}}>
              {g.name}
              <span style={{display:"block",fontSize:9,fontWeight:500,color:"var(--color-text-tertiary)"}}>{g.teams.length}T</span>
              {complete&&<span style={{position:"absolute",top:-4,right:-4,width:8,height:8,borderRadius:"50%",background:"#2a9d8f",border:"1.5px solid var(--color-background-primary)"}}/>}
            </button>
          );
        })}
      </div>

      {group&&<RoundRobinView rrRounds={group.rounds} teams={group.teams} onGameUpdate={onGameUpdate} onMatchUpdate={onMatchUpdate} onAddTiebreakRound={round=>onStageUpdate(d=>({...d,groups:d.groups.map((g,idx)=>idx===activeGroup?{...g,rounds:[...g.rounds,round]}:g)}))} matchMode={matchMode} statCols={statCols} standingsRules={standingsRules}/>}

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:12,marginTop:20}}>
        {groups.map(g=>(
          <TeamStandingsTable key={g.name} teams={g.teams} matches={(g.rounds||[]).flat()} title={`${g.name} Standings`} showScore={matchMode==="score"} standingsRules={standingsRules}/>
        ))}
      </div>
    </div>
  );
}

// ─── Roster editor ────────────────────────────────────────────────────────────
function RosterEditor({team,onChange,allRegions}){
  const[playerInput,setPlayerInput]=useState("");
  const[bulkText,setBulkText]=useState("");
  const[bulkParsing,setBulkParsing]=useState(false);
  const[bulkOpen,setBulkOpen]=useState(false);
  const addPlayer=(role="player")=>{const name=playerInput.trim();if(!name)return;onChange({...team,players:[...(team.players||[]),{name,nationality:"",role}]});setPlayerInput("");};
  const updatePlayer=(i,upd)=>onChange({...team,players:(team.players||[]).map((p,idx)=>idx===i?{...p,...upd}:p)});
  const removePlayer=(i)=>onChange({...team,players:(team.players||[]).filter((_,idx)=>idx!==i)});
  const bulkParseRoster=async()=>{
    if(!bulkText.trim())return;setBulkParsing(true);
    try{
      const parsed=parseRosterText(bulkText);
      if(!parsed.length)throw new Error("No roster entries found. Use one player per line.");
      onChange({...team,players:[...(team.players||[]),...parsed]});setBulkText("");setBulkOpen(false);
    }catch(e){alert(e.message||"Parsing failed.");}setBulkParsing(false);
  };
  const players=team.players||[];
  return(
    <div style={{padding:"12px 14px",background:"var(--color-background-secondary)",borderRadius:8,marginTop:4,border:"0.5px solid var(--color-border-tertiary)"}}>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:6}}>Region</div>
        <input value={team.region||""} onChange={e=>onChange({...team,region:e.target.value})} placeholder="e.g. Europe, Brazil…" style={{width:"100%",boxSizing:"border-box",fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:600,padding:"5px 8px",borderRadius:6,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-primary)"}}/>
        {allRegions.filter(r=>r!==team.region&&r).length>0&&(
          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:6}}>
            {allRegions.filter(r=>r!==team.region&&r).map(r=>(
              <button key={r} onClick={()=>onChange({...team,region:r})} style={{fontSize:11,padding:"2px 8px",borderRadius:4,border:"0.5px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-secondary)",cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600}}>
                {regionFlag(r)&&<span style={{marginRight:3}}>{regionFlag(r)}</span>}{r}
              </button>
            ))}
          </div>
        )}
      </div>
      {["player","substitute","coach"].map(role=>{
        const rp=players.filter(p=>p.role===role);if(!rp.length)return null;
        return(
          <div key={role} style={{marginBottom:10}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:5}}>{role==="player"?"Players":role==="substitute"?"Subs":"Coaches"} ({rp.length})</div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {players.map((p,i)=>p.role!==role?null:(
                <div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 6px",background:"var(--color-background-primary)",borderRadius:6,border:"0.5px solid var(--color-border-tertiary)"}}>
                  <span style={{fontSize:12}}>{FLAG(p.nationality)||"🏳"}</span>
                  <input value={p.name} onChange={e=>updatePlayer(i,{name:e.target.value})} style={{flex:1,fontSize:12,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,border:"none",background:"transparent",color:"var(--color-text-primary)",padding:0,minWidth:0}}/>
                  <input value={p.nationality} onChange={e=>updatePlayer(i,{nationality:e.target.value})} placeholder="CC" maxLength={2} style={{width:28,fontSize:11,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,border:"0.5px solid var(--color-border-tertiary)",borderRadius:3,background:"var(--color-background-secondary)",color:"var(--color-text-primary)",textAlign:"center",textTransform:"uppercase",padding:"1px 2px"}}/>
                  <select value={p.role} onChange={e=>updatePlayer(i,{role:e.target.value})} style={{fontSize:10,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,border:"0.5px solid var(--color-border-tertiary)",borderRadius:3,background:"var(--color-background-secondary)",color:"var(--color-text-secondary)",padding:"1px 2px",cursor:"pointer"}}>
                    <option value="player">Player</option><option value="substitute">Sub</option><option value="coach">Coach</option>
                  </select>
                  <button onClick={()=>removePlayer(i)} style={{fontSize:13,color:"var(--color-text-tertiary)",background:"none",border:"none",cursor:"pointer",padding:"0 2px",lineHeight:1}}>×</button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
        <input value={playerInput} onChange={e=>setPlayerInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPlayer()} placeholder="Player name…" style={{flex:1,minWidth:100,fontSize:12,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,padding:"4px 8px",borderRadius:6,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-primary)"}}/>
        {["player","substitute","coach"].map(role=>(
          <button key={role} onClick={()=>addPlayer(role)} style={{fontSize:11,padding:"4px 8px",borderRadius:5,border:"0.5px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-secondary)",cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,textTransform:"capitalize"}}>+{role==="player"?"Player":role==="substitute"?"Sub":"Coach"}</button>
        ))}
        <button onClick={()=>setBulkOpen(o=>!o)} style={{fontSize:11,padding:"4px 10px",borderRadius:5,border:"1px solid rgba(233,196,106,0.5)",background:"rgba(233,196,106,0.08)",color:"#b8921a",cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em"}}>Bulk Roster</button>
      </div>
      {bulkOpen&&(
        <div style={{marginTop:10,padding:"10px",background:"var(--color-background-primary)",borderRadius:8,border:"1px solid rgba(233,196,106,0.3)"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"#b8921a",marginBottom:4}}>Roster Format</div>
          <div style={{fontSize:11,color:"var(--color-text-tertiary)",marginBottom:6,fontFamily:"'Barlow',sans-serif"}}>One person per line: <strong>Name (country) - role</strong>. Roles: player, substitute, coach.</div>
          <textarea value={bulkText} onChange={e=>setBulkText(e.target.value)} placeholder={"Saka (England) - player\nTrossard (Belgium) - substitute\nArteta (Spain) - coach"} rows={4} style={{width:"100%",boxSizing:"border-box",fontFamily:"'Barlow',sans-serif",fontSize:12,padding:"6px 8px",borderRadius:6,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-secondary)",color:"var(--color-text-primary)",resize:"vertical"}}/>
          <div style={{display:"flex",gap:8,marginTop:8}}>
            <button onClick={bulkParseRoster} disabled={bulkParsing||!bulkText.trim()} style={{padding:"5px 14px",borderRadius:6,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:12,textTransform:"uppercase",letterSpacing:"0.05em",background:bulkParsing?"var(--color-background-secondary)":"#e9c46a",color:bulkParsing?"var(--color-text-tertiary)":"#2c2c00",border:"none",cursor:bulkParsing?"not-allowed":"pointer"}}>{bulkParsing?"Parsing…":"Add Roster"}</button>
            <button onClick={()=>{setBulkOpen(false);setBulkText("");}} style={{padding:"5px 12px",borderRadius:6,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,fontSize:12,background:"none",border:"0.5px solid var(--color-border-tertiary)",color:"var(--color-text-tertiary)",cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Seeded team list ─────────────────────────────────────────────────────────
function SeededTeamList({teams,onReorder,onRemove,onTeamChange,allRegions}){
  const dragIdx=useRef(null);
  const[dragOver,setDragOver]=useState(null);
  const[expanded,setExpanded]=useState(null);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      {teams.map((t,i)=>(
        <div key={t.name+i}>
          <div draggable onDragStart={()=>{dragIdx.current=i;}} onDragOver={e=>{e.preventDefault();setDragOver(i);}} onDrop={()=>{if(dragIdx.current==null||dragIdx.current===i){setDragOver(null);return;}const next=[...teams];const[moved]=next.splice(dragIdx.current,1);next.splice(i,0,moved);onReorder(next);dragIdx.current=null;setDragOver(null);}} onDragEnd={()=>{dragIdx.current=null;setDragOver(null);}}
            style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:7,background:dragOver===i?"rgba(233,196,106,0.08)":"var(--color-background-primary)",border:dragOver===i?"1px solid rgba(233,196,106,0.5)":"1px solid var(--color-border-tertiary)",cursor:"grab",userSelect:"none",transition:"background 0.1s"}}>
            <span style={{fontSize:13,color:"var(--color-text-tertiary)",fontWeight:800,minWidth:22,textAlign:"right",fontFamily:"'Barlow Condensed',sans-serif"}}>#{i+1}</span>
            <span onClick={e=>{e.stopPropagation();const ci=palette.indexOf(t.color);const next=palette[(ci+1)%palette.length];onTeamChange(i,{...t,color:next});}} title="Click to change color" style={{width:14,height:14,borderRadius:3,background:t.color,flexShrink:0,cursor:"pointer",border:"1.5px solid rgba(255,255,255,0.2)",boxSizing:"border-box"}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:"0.03em",color:"var(--color-text-primary)"}}>{t.name}</div>
              {(t.region||(t.players||[]).length>0)&&<div style={{fontSize:10,color:"var(--color-text-tertiary)",display:"flex",gap:6,alignItems:"center",marginTop:1}}>{t.region&&<span style={{padding:"0px 4px",borderRadius:3,background:"var(--color-background-secondary)",border:"0.5px solid var(--color-border-tertiary)"}}>{regionFlag(t.region)&&<span style={{marginRight:2}}>{regionFlag(t.region)}</span>}{t.region}</span>}{(t.players||[]).length>0&&<span>{(t.players||[]).filter(p=>p.role==="player").length}P·{(t.players||[]).filter(p=>p.role==="substitute").length}S·{(t.players||[]).filter(p=>p.role==="coach").length}C</span>}</div>}
            </div>
            <button onClick={()=>setExpanded(expanded===i?null:i)} style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"0.5px solid var(--color-border-tertiary)",background:expanded===i?"rgba(233,196,106,0.1)":"var(--color-background-secondary)",color:expanded===i?"#b8921a":"var(--color-text-secondary)",cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,textTransform:"uppercase",flexShrink:0}}>{expanded===i?"▲ Close":"▼ Edit"}</button>
            <span onClick={()=>onRemove(i)} style={{cursor:"pointer",color:"var(--color-text-tertiary)",fontSize:15,lineHeight:1,flexShrink:0}}>×</span>
            <span style={{fontSize:11,color:"var(--color-text-tertiary)",flexShrink:0}}>⠿</span>
          </div>
          {expanded===i&&<RosterEditor team={t} onChange={updated=>onTeamChange(i,updated)} allRegions={allRegions}/>}
        </div>
      ))}
    </div>
  );
}

function ParticipantNameInput({team,onCommit,disabled=false}){
  const[value,setValue]=useState(team.name||"");
  useEffect(()=>setValue(team.name||""),[team.name]);
  const commit=()=>{
    const next=value.trim();
    if(next&&next!==team.name)onCommit(next);
    else setValue(team.name||"");
  };
  return(
    <input value={value} disabled={disabled} onChange={e=>setValue(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();if(e.key==="Escape"){setValue(team.name||"");e.currentTarget.blur();}}} style={{width:"100%",boxSizing:"border-box",fontFamily:"'Barlow Condensed',sans-serif",fontSize:14,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.03em",padding:"7px 9px",borderRadius:7,border:"1px solid var(--color-border-tertiary)",background:disabled?"var(--color-background-secondary)":"var(--color-background-primary)",color:"var(--color-text-primary)",opacity:disabled?0.6:1}}/>
  );
}

// ─── Bulk team adder ──────────────────────────────────────────────────────────
function BulkTeamAdder({onAdd,maxAdd}){
  const[open,setOpen]=useState(false);
  const[text,setText]=useState("");
  const[parsing,setParsing]=useState(false);
  const parse=async()=>{
    if(!text.trim())return;setParsing(true);
    try{
      const parsed=parseTeamsText(text);
      if(!parsed.length)throw new Error("No teams found. Add one team name per block.");
      onAdd(parsed.slice(0,maxAdd));setText("");setOpen(false);
    }catch(e){alert(e.message||"Parsing failed.");}setParsing(false);
  };
  if(!open)return <button onClick={()=>setOpen(true)} style={{fontSize:12,padding:"6px 14px",borderRadius:6,border:"1px solid rgba(233,196,106,0.5)",background:"rgba(233,196,106,0.07)",color:"#b8921a",cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>Bulk Add</button>;
  return(
    <div style={{padding:"14px",background:"var(--color-background-secondary)",borderRadius:10,border:"1px solid rgba(233,196,106,0.3)",marginBottom:12}}>
      <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"#b8921a",marginBottom:4}}>Bulk Team Format</div>
      <div style={{fontSize:11,color:"var(--color-text-tertiary)",marginBottom:6,fontFamily:"'Barlow',sans-serif"}}>Use blocks, or paste a 4-column table: <strong>Team | Team country | Player | Player country</strong>. Table columns can be tabs or multiple spaces.</div>
      <textarea value={text} onChange={e=>setText(e.target.value)} placeholder={"Block format:\nArsenal (England)\n- Saka (England) - player\n- Trossard (Belgium) - substitute\n\nTable format:\nAtlas Titans    Algeria    AtlasPrime    Algeria\nAtlas Titans    Algeria    Stonewall    Algeria\nKalahari Force    Botswana    Kalaharix    Botswana"} rows={10} style={{width:"100%",boxSizing:"border-box",fontFamily:"'Barlow',sans-serif",fontSize:12,padding:"8px",borderRadius:6,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-primary)",resize:"vertical"}}/>
      <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap",alignItems:"center"}}>
        <button onClick={parse} disabled={parsing||!text.trim()} style={{padding:"6px 16px",borderRadius:6,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:13,textTransform:"uppercase",letterSpacing:"0.05em",background:parsing?"var(--color-background-secondary)":"#e9c46a",color:parsing?"var(--color-text-tertiary)":"#2c2c00",border:"none",cursor:parsing?"not-allowed":"pointer"}}>{parsing?"Parsing…":"Add Teams"}</button>
        <button onClick={()=>{setOpen(false);setText("");}} style={{padding:"6px 12px",borderRadius:6,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,fontSize:12,background:"none",border:"0.5px solid var(--color-border-tertiary)",color:"var(--color-text-tertiary)",cursor:"pointer"}}>Cancel</button>
        <span style={{fontSize:11,color:"var(--color-text-tertiary)",marginLeft:"auto"}}>Up to {maxAdd} more</span>
      </div>
    </div>
  );
}

// ─── Stat columns editor ──────────────────────────────────────────────────────
function StatColsEditor({statCols,onChange}){
  const[input,setInput]=useState("");
  return(
    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
      <span style={{fontSize:11,fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",color:"var(--color-text-secondary)"}}>Stats:</span>
      {statCols.map((col,i)=>(
        <span key={i} style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:11,padding:"2px 6px",borderRadius:4,border:"0.5px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,color:"var(--color-text-primary)"}}>
          {col}<button onClick={()=>onChange(statCols.filter((_,idx)=>idx!==i))} style={{background:"none",border:"none",cursor:"pointer",color:"var(--color-text-tertiary)",fontSize:12,padding:"0 1px",lineHeight:1}}>×</button>
        </span>
      ))}
      <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&input.trim()){onChange([...statCols,input.trim()]);setInput("");}}} placeholder="+ stat…" style={{fontSize:11,width:70,padding:"2px 6px",borderRadius:4,border:"0.5px solid var(--color-border-tertiary)",background:"var(--color-background-secondary)",color:"var(--color-text-primary)",fontFamily:"'Barlow Condensed',sans-serif"}}/>
    </div>
  );
}

function StandingsRulesEditor({rules,onChange,disabled=false}){
  const cfg=normalizeStandingsRules(rules);
  const selectStyle={width:"100%",boxSizing:"border-box",padding:"6px 8px",borderRadius:6,border:"1px solid var(--color-border-tertiary)",background:disabled?"var(--color-background-secondary)":"var(--color-background-primary)",color:"var(--color-text-primary)",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.03em",opacity:disabled?0.58:1,cursor:disabled?"not-allowed":"pointer"};
  const inputStyle={width:"100%",boxSizing:"border-box",padding:"5px 7px",borderRadius:6,border:"1px solid var(--color-border-tertiary)",background:disabled?"var(--color-background-secondary)":"var(--color-background-primary)",color:"var(--color-text-primary)",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,opacity:disabled?0.58:1};
  const labelStyle={fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:4};
  const applyRules=next=>onChange(normalizeStandingsRules(next));
  const updateMainMetric=mainMetric=>applyRules({...cfg,mainMetric});
  const updateTiebreaker=(idx,value)=>{
    const tiebreakers=[...(cfg.tiebreakers||DEFAULT_STANDINGS_RULES.tiebreakers)];
    tiebreakers[idx]=value;
    applyRules({...cfg,tiebreakers});
  };
  const updateCustomPoint=(key,value)=>{
    const parsed=value===""?0:Number(value);
    applyRules({...cfg,mainMetric:"customPoints",customPoints:{...cfg.customPoints,[key]:Number.isFinite(parsed)?parsed:0}});
  };
  const customPointRows=[
    ["matchWin","Match win"],["matchTie","Match tie"],["matchLoss","Match loss"],
    ["gameWin","Game win"],["gameTie","Game tie"],["gameLoss","Game loss"]
  ];
  return(
    <div style={{marginBottom:16,padding:"12px 16px",background:"var(--color-background-secondary)",borderRadius:10,border:"0.5px solid var(--color-border-tertiary)"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:10}}>
        <span style={{fontSize:11,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--color-text-secondary)"}}>Metric Prioritization</span>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {[cfg.mainMetric,...cfg.tiebreakers.filter(metric=>metric&&metric!=="none")].map((id,idx)=><span key={`${id}-${idx}`} style={{fontSize:10,padding:"2px 7px",borderRadius:4,border:"0.5px solid rgba(233,196,106,0.35)",background:"rgba(233,196,106,0.08)",color:"#b8921a",fontWeight:700}}>{idx===0?"Main: ":""}{metricLabel(id)}</span>)}
        </div>
        <button onClick={()=>onChange(DEFAULT_STANDINGS_RULES)} disabled={disabled} style={{...btn(false),padding:"4px 9px",fontSize:11,marginLeft:"auto",opacity:disabled?0.45:1,cursor:disabled?"not-allowed":"pointer"}}>Reset</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginBottom:10}}>
        <label>
          <div style={labelStyle}>Main metric</div>
          <select value={cfg.mainMetric} onChange={e=>updateMainMetric(e.target.value)} disabled={disabled} style={selectStyle}>
            {METRIC_MAIN_OPTIONS.map(([id,label])=><option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        {Array.from({length:4},(_,idx)=>(
          <label key={idx}>
            <div style={labelStyle}>Tiebreaker {idx+1}</div>
            <select value={cfg.tiebreakers[idx]||"none"} onChange={e=>updateTiebreaker(idx,e.target.value)} disabled={disabled} style={selectStyle}>
              {METRIC_TIEBREAKER_OPTIONS.map(([id,label])=><option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        ))}
      </div>
      {cfg.mainMetric==="customPoints"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(116px,1fr))",gap:8,marginBottom:10,padding:"10px",borderRadius:8,border:"1px solid rgba(42,157,143,0.28)",background:"rgba(42,157,143,0.05)"}}>
          {customPointRows.map(([key,label])=>(
            <label key={key}>
              <div style={labelStyle}>{label}</div>
              <input type="number" step="0.5" value={cfg.customPoints[key]} onChange={e=>updateCustomPoint(key,e.target.value)} disabled={disabled} style={inputStyle}/>
            </label>
          ))}
        </div>
      )}
      {cfg.mainMetric==="football"&&(
        <div style={{fontSize:11,color:"var(--color-text-tertiary)",fontFamily:"'Barlow',sans-serif",marginBottom:8}}>Win = 3, tie = 1, loss = 0.</div>
      )}
      {cfg.mainMetric==="kitakana"&&(
        <div style={{fontSize:11,color:"var(--color-text-tertiary)",fontFamily:"'Barlow',sans-serif",marginBottom:8}}>Win by &gt;5 = 3, win by 5 = 2, win by &lt;5 = 1.5, tie = 1, close loss = 0.5.</div>
      )}
      <div style={{fontSize:11,color:"var(--color-text-tertiary)",fontFamily:"'Barlow',sans-serif",lineHeight:1.35}}>
        {cfg.summary}
      </div>
    </div>
  );
}

// ─── Multi-Stage ──────────────────────────────────────────────────────────────
const FORMAT_LABELS={"single":"Single Elim","double":"Double Elim","roundrobin":"Round Robin"};

// StageConfig — clean per-stage card
// Stage 0: pick how many teams play + how many advance
// Stage N (idx>=1): choose AAT (auto-advance teams) + how many from previous stage
function StageConfig({stage,idx,totalTeams,isLast,onChange,locked=false,lockAat=false,metricRulesLocked=false}){
  const teamCount=stage.teamCount||2;
  let bracketSz=1; while(bracketSz<teamCount)bracketSz*=2;
  const bracketByes=bracketSz-teamCount;
  const aatCount=idx>0?(stage.aat||0):0;
  const fromPrev=teamCount-aatCount;
  const controlDisabled=locked;
  const aatDisabled=locked||lockAat;
  const disabledStyle={opacity:0.45,cursor:"not-allowed"};
  const splitMax=Math.max(1,Math.floor(teamCount/2));
  const splitCount=Math.max(1,Math.min(splitMax,stage.splitStartCount||Math.max(1,Math.floor(teamCount/4))));

  return(
    <div style={{background:"var(--color-background-secondary)",borderRadius:10,border:"1px solid var(--color-border-tertiary)",overflow:"hidden",opacity:locked?0.88:1}}>

      {/* ── Header row: stage label + format picker ── */}
      <div style={{padding:"10px 14px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",borderBottom:"0.5px solid var(--color-border-tertiary)",background:"rgba(0,0,0,0.05)"}}>
        <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:13,letterSpacing:"0.07em",textTransform:"uppercase",color:"var(--color-text-primary)",minWidth:56}}>Stage {idx+1}</span>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {["single","double","roundrobin"].map(f=>(
            <button key={f} onClick={()=>!controlDisabled&&onChange({...stage,format:f})} disabled={controlDisabled} style={{...btn(stage.format===f),padding:"2px 8px",fontSize:10,...(controlDisabled?disabledStyle:{})}}>{FORMAT_LABELS[f]}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:4,marginLeft:"auto",flexWrap:"wrap"}}>
          {[["wl","Win/Lose"],["games","Game Wins"],["score","Score"]].map(([id,lbl])=>(
            <button key={id} onClick={()=>!controlDisabled&&onChange({...stage,matchMode:id,gamesPerMatch:id==="wl"?1:(stage.gamesPerMatch||3)})} disabled={controlDisabled} style={{...btn(stage.matchMode===id),padding:"2px 7px",fontSize:10,...(controlDisabled?disabledStyle:{})}}>{lbl}</button>
          ))}
          {stage.matchMode!=="wl"&&<><Stepper value={stage.gamesPerMatch||3} min={1} max={11} onChange={v=>onChange({...stage,gamesPerMatch:v})} small disabled={controlDisabled}/><span style={{fontSize:10,color:"var(--color-text-tertiary)",alignSelf:"center"}}>games</span></>}
        </div>
      </div>

      {stage.format==="roundrobin"&&(
        <div style={{padding:"10px 14px 0",borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
          <StandingsRulesEditor rules={stage.standingsRules} onChange={standingsRules=>onChange({...stage,standingsRules})} disabled={metricRulesLocked}/>
        </div>
      )}

      {stage.format==="double"&&(
        <div style={{padding:"8px 14px",borderBottom:"0.5px solid var(--color-border-tertiary)",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",background:stage.splitStart?"rgba(230,57,70,0.06)":"transparent"}}>
          <button onClick={()=>!controlDisabled&&onChange({...stage,splitStart:!stage.splitStart,splitStartCount:splitCount})} disabled={controlDisabled} style={{...btn(!!stage.splitStart),padding:"3px 9px",fontSize:10,borderColor:stage.splitStart?"rgba(230,57,70,0.55)":"var(--color-border-tertiary)",color:stage.splitStart?"#e63946":"var(--color-text-secondary)",...(controlDisabled?disabledStyle:{})}}>Split Participants</button>
          {stage.splitStart&&(
            <>
              <Stepper label="LB start" value={splitCount} min={1} max={splitMax} onChange={v=>onChange({...stage,splitStart:true,splitStartCount:v})} small disabled={controlDisabled}/>
              <span style={{fontSize:10,color:"var(--color-text-tertiary)"}}>lower seeds / lower previous placements start in losers bracket ({Math.round(splitCount/teamCount*100)}%)</span>
            </>
          )}
        </div>
      )}

      {/* ── Sub-options row: group stage, bracket info ── */}
      {(stage.format==="roundrobin"||bracketByes>0)&&(
        <div style={{padding:"6px 14px",borderBottom:"0.5px solid var(--color-border-tertiary)",display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
          {stage.format==="roundrobin"&&!isLast&&(
            <>
              <button onClick={()=>!controlDisabled&&onChange({...stage,groupStage:!stage.groupStage,groupCount:stage.groupCount||2})} disabled={controlDisabled} style={{...btn(!!stage.groupStage),padding:"3px 9px",fontSize:10,...(controlDisabled?disabledStyle:{})}}>Group Stage</button>
              {stage.groupStage&&<Stepper label="Groups" value={stage.groupCount||2} min={2} max={Math.max(2,Math.min(16,teamCount))} onChange={v=>onChange({...stage,groupStage:true,groupCount:v})} small disabled={controlDisabled}/>}
            </>
          )}
          {(stage.format==="single"||stage.format==="double")&&bracketByes>0&&<span style={{fontSize:10,color:"var(--color-text-tertiary)"}}>Bracket: {bracketSz} ({bracketByes} internal bye{bracketByes>1?"s":""})</span>}
        </div>
      )}
      {stage.format==="roundrobin"&&stage.groupStage&&!isLast&&(stage.advance||0)%(stage.groupCount||2)!==0&&(
        <div style={{padding:"8px 14px",borderBottom:"0.5px solid var(--color-border-tertiary)",background:"rgba(233,196,106,0.08)",display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:11,fontWeight:800,letterSpacing:"0.06em",textTransform:"uppercase",color:"#b8921a"}}>Tiebreak needed</span>
          <span style={{fontSize:11,color:"var(--color-text-tertiary)"}}>{stage.advance||0} advancing is not divisible by {stage.groupCount||2} groups.</span>
          {[["performance","By Performance"],["manual","Manual Pick"],["stage","Add Tiebreak Stage"]].map(([id,label])=>(
            <button key={id} onClick={()=>!controlDisabled&&onChange({...stage,tiebreakMode:id})} disabled={controlDisabled} style={{...btn((stage.tiebreakMode||"performance")===id),padding:"3px 8px",fontSize:10,...(controlDisabled?disabledStyle:{})}}>{label}</button>
          ))}
          {(stage.tiebreakMode||"performance")==="stage"&&[["roundrobin","RR"],["single","Single"],["double","Double"]].map(([id,label])=>(
            <button key={id} onClick={()=>!controlDisabled&&onChange({...stage,tiebreakStageFormat:id})} disabled={controlDisabled} style={{...btn((stage.tiebreakStageFormat||"roundrobin")===id),padding:"3px 7px",fontSize:10,borderColor:(stage.tiebreakStageFormat||"roundrobin")===id?"#2a9d8f":"var(--color-border-tertiary)",...(controlDisabled?disabledStyle:{})}}>{label}</button>
          ))}
        </div>
      )}

      {/* ── Flow row: teams in → advance out ── */}
      <div style={{padding:"12px 14px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>

        {idx===0?(
          /* Stage 0: starting teams stepper → advance stepper */
          <>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <Stepper value={teamCount} min={2} max={64} onChange={v=>onChange({...stage,teamCount:v,advance:Math.min(stage.advance||Math.floor(v/2),v-1)})} small disabled={controlDisabled}/>
              <span style={{fontSize:11,color:"var(--color-text-tertiary)"}}>Stage 1 starting teams</span>
            </div>
            {!isLast&&(
              <>
                <span style={{fontSize:16,color:"var(--color-border-tertiary)",fontWeight:300}}>→</span>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <Stepper value={stage.advance||Math.floor(teamCount/2)} min={1} max={teamCount-1} onChange={v=>onChange({...stage,advance:v})} small disabled={controlDisabled}/>
                  <span style={{fontSize:11,color:"var(--color-text-tertiary)"}}>advance to Stage 2</span>
                </div>
              </>
            )}
          </>
        ):(
          /* Stage N: show AAT pill + from-prev count = total, then advance stepper */
          <>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <Stepper value={aatCount} min={0} max={64} onChange={v=>onChange({...stage,aat:v,teamCount:fromPrev+v})} small disabled={aatDisabled}/>
              <span style={{fontSize:11,color:"#2a9d8f",fontWeight:700}}>auto-advance teams (AAT)</span>
            </div>
            <span style={{fontSize:13,color:"var(--color-text-tertiary)"}}>+</span>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:12,fontWeight:800,color:"var(--color-text-primary)",fontFamily:"'Barlow Condensed',sans-serif"}}>{fromPrev}</span>
              <span style={{fontSize:10,color:"var(--color-text-tertiary)"}}>from Stage {idx}</span>
            </div>
            <span style={{fontSize:13,color:"var(--color-text-tertiary)"}}>=</span>
            <span style={{fontSize:13,fontWeight:800,color:"var(--color-text-primary)",fontFamily:"'Barlow Condensed',sans-serif"}}>{teamCount}</span>
            <span style={{fontSize:11,color:"var(--color-text-tertiary)"}}>teams in Stage {idx+1}</span>
            {!isLast&&(
              <>
                <span style={{fontSize:16,color:"var(--color-border-tertiary)",fontWeight:300,marginLeft:4}}>→</span>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <Stepper value={stage.advance||Math.floor(teamCount/2)} min={1} max={Math.max(1,teamCount-1)} onChange={v=>onChange({...stage,advance:v})} small disabled={controlDisabled}/>
                  <span style={{fontSize:11,color:"var(--color-text-tertiary)"}}>advance to Stage {idx+2}</span>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Multi-Stage view ─────────────────────────────────────────────────────────
function MultiStageView({stages,stageData,teams,statCols,onGameUpdate,onMatchUpdate,onStageUpdate,onAdvance,activeStageIdx,setActiveStageIdx}){
  const[playerSort,setPlayerSort]=useState("mw");
  const[showPlayers,setShowPlayers]=useState(false);

  const stage=stages[activeStageIdx];
  const data=stageData[activeStageIdx];
  const allMatches=Object.values(stageData).flatMap(sd=>{
    if(!sd)return[];
    if(sd.type==="roundrobin")return(sd.rounds||[]).flat();
    if(sd.type==="groupstage")return(sd.groups||[]).flatMap(g=>(g.rounds||[]).flat());
    if(sd.type==="single")return[...(sd.winners||[]).flat(),...(sd.qualificationTiebreaker?.rounds||[]).flat()];
    if(sd.type==="double")return dataMatches(sd);
    return[];
  });

  const getStageMatches=(sd)=>{
    if(!sd)return[];
    if(sd.type==="roundrobin")return(sd.rounds||[]).flat();
    if(sd.type==="groupstage")return(sd.groups||[]).flatMap(g=>(g.rounds||[]).flat());
    if(sd.type==="single")return[...(sd.winners||[]).flat(),...(sd.qualificationTiebreaker?.rounds||[]).flat()];
    if(sd.type==="double")return dataMatches(sd);
    return[];
  };

  const getStageTeams=(idx)=>stageData[idx]?.teams||[];

  const stageComplete=(idx)=>{
    return stageQualificationStatus(stageData[idx],stages[idx],idx===stages.length-1).ready;
  };

  const getAdvancingTeams=(idx)=>{
    const sd=stageData[idx];const st=stages[idx];if(!sd||!st)return[];
    const stTeams=sd.teams||[];
    const advance=st.advance||2;
    if(sd.type==="roundrobin"){
      const standings=computeTeamStandings(stTeams,playableMatches((sd.rounds||[]).flat()),st.standingsRules);
      return standings.slice(0,advance).map(r=>r.team);
    }
    if(sd.type==="groupstage"){
      const tb=groupTiebreakInfo(sd,st);
      if(tb){
        const mode=st.tiebreakMode||"performance";
        if(mode==="manual"){
          const selected=new Set(sd.manualTiebreakAdvancers||[]);
          return [...tb.guaranteed,...tb.candidates.filter(c=>selected.has(c.row.team.name)).map(c=>c.row.team)].slice(0,advance);
        }
        if(mode==="stage")return tb.guaranteed;
        return [...tb.guaranteed,...tb.byPerformance.slice(0,tb.remainder).map(c=>c.row.team)].slice(0,advance);
      }
      const groupStandings=(sd.groups||[]).map(g=>computeTeamStandings(g.teams,(g.rounds||[]).flat(),st.standingsRules));
      const advancing=[];
      const maxRows=Math.max(0,...groupStandings.map(st=>st.length));
      for(let row=0;row<maxRows&&advancing.length<advance;row++){
        for(let g=0;g<groupStandings.length&&advancing.length<advance;g++){
          const team=groupStandings[g][row]?.team;
          if(team&&!advancing.find(t=>t.name===team.name))advancing.push(team);
        }
      }
      return advancing;
    }
    if(sd.type==="single"){
      const status=stageQualificationStatus(sd,st,idx===stages.length-1);
      if(status.ready&&status.advancers?.length)return status.advancers.slice(0,advance);
      const standings=computeTeamStandings(stTeams,playableMatches((sd.winners||[]).flat()));
      return standings.slice(0,advance).map(r=>r.team);
    }
    if(sd.type==="double"){
      const status=stageQualificationStatus(sd,st,idx===stages.length-1);
      if(status.ready&&status.advancers?.length)return status.advancers.slice(0,advance);
      const prop=propagateDoubleElim(sd);
      const allM=[...(prop.winners||[]).flat(),...(prop.losers||[]).flat(),prop.grandFinal,prop.grandFinalReset].filter(Boolean);
      const gfRes=matchResult(prop.grandFinal);
      const gfrRes=matchResult(prop.grandFinalReset);
      const champion=gfRes.winner?.name===prop.grandFinal.teamA?.name?gfRes.winner:gfrRes.winner||null;
      const runnerUp=champion?(champion.name===prop.grandFinal.teamA?.name?prop.grandFinal.teamB:prop.grandFinal.teamA):null;
      const placed=[];
      if(champion)placed.push(champion);
      if(runnerUp&&runnerUp.name!==champion?.name)placed.push(runnerUp);
      const standings=computeTeamStandings(stTeams,playableMatches(allM));
      standings.forEach(r=>{if(!placed.find(p=>p.name===r.team.name))placed.push(r.team);});
      return placed.slice(0,advance);
    }
    return[];
  };

  const canAdvance=activeStageIdx<stages.length-1&&stageComplete(activeStageIdx)&&!stageData[activeStageIdx+1];

  return(
    <div>
      {/* Stage tabs */}
      <div style={{display:"flex",gap:4,marginBottom:16,flexWrap:"wrap"}}>
        {stages.map((st,idx)=>{
          const unlocked=idx===0||!!stageData[idx];
          const done=stageComplete(idx);
          return(
            <button key={idx} onClick={()=>unlocked&&setActiveStageIdx(idx)} disabled={!unlocked} style={{...btn(activeStageIdx===idx),padding:"6px 14px",fontSize:13,position:"relative",opacity:unlocked?1:0.4,cursor:unlocked?"pointer":"not-allowed"}}>
              Stage {idx+1}
              <span style={{display:"block",fontSize:9,fontWeight:500,color:"var(--color-text-tertiary)"}}>{FORMAT_LABELS[st.format]} · {(stageData[idx]?.teams||[]).length}T</span>
              {done&&<span style={{position:"absolute",top:-4,right:-4,width:8,height:8,borderRadius:"50%",background:"#2a9d8f",border:"1.5px solid var(--color-background-primary)"}}/>}
            </button>
          );
        })}
      </div>

      {/* Player toggle - only for non-RR stages; RR has its own toggle per round */}
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:11,color:"var(--color-text-tertiary)",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"}}>
          {FORMAT_LABELS[stages[activeStageIdx]?.format]} · {getStageTeams(activeStageIdx).length} teams
          {(stageData[0]?.aatTeamsByStage?.[activeStageIdx]||[]).length>0&&<span style={{color:"#2a9d8f",marginLeft:6}}>({(stageData[0]?.aatTeamsByStage?.[activeStageIdx]||[]).length} AAT joined)</span>}
        </span>
        {data&&data.type!=="roundrobin"&&<button onClick={()=>setShowPlayers(p=>!p)} style={{...btn(showPlayers),padding:"4px 10px",fontSize:11,marginLeft:"auto"}}>{showPlayers?"🏆 Teams":"👤 Players"}</button>}
      </div>

      {/* Stage content */}
      {data&&(
        data.type==="single"?<SingleElimView bracketData={data} statCols={statCols} onGameUpdate={(mid,gi,upd)=>onGameUpdate(activeStageIdx,mid,gi,upd)} onMatchUpdate={(mid,upd)=>onMatchUpdate(activeStageIdx,mid,upd)}/>
        :data.type==="double"?<DoubleElimView bracketData={data} statCols={statCols} onGameUpdate={(mid,gi,upd)=>onGameUpdate(activeStageIdx,mid,gi,upd)} onMatchUpdate={(mid,upd)=>onMatchUpdate(activeStageIdx,mid,upd)}/>
        :data.type==="roundrobin"?<RoundRobinView rrRounds={data.rounds} teams={getStageTeams(activeStageIdx)} onGameUpdate={(mid,gi,upd)=>onGameUpdate(activeStageIdx,mid,gi,upd)} onMatchUpdate={(mid,upd)=>onMatchUpdate(activeStageIdx,mid,upd)} onAddTiebreakRound={round=>onStageUpdate(activeStageIdx,d=>({...d,rounds:[...d.rounds,round]}))} matchMode={stages[activeStageIdx]?.matchMode||"wl"} statCols={statCols} standingsRules={stages[activeStageIdx]?.standingsRules}/>
        :data.type==="groupstage"?<GroupStageView data={data} onStageUpdate={updater=>onStageUpdate(activeStageIdx,updater)} onGameUpdate={(mid,gi,upd)=>onGameUpdate(activeStageIdx,mid,gi,upd)} onMatchUpdate={(mid,upd)=>onMatchUpdate(activeStageIdx,mid,upd)} matchMode={stages[activeStageIdx]?.matchMode||"wl"} statCols={statCols} standingsRules={stages[activeStageIdx]?.standingsRules}/>
        :null
      )}

      {/* Advancing banner */}
      {canAdvance&&(()=>{
        const advancing=getAdvancingTeams(activeStageIdx);
        const aatTeams=stageData[0]?.aatTeamsByStage?.[activeStageIdx+1]||(activeStageIdx===0?stageData[0]?.byeTeams||[]:[]);
        const nextStageTeams=[...aatTeams,...advancing];
        const tb=groupTiebreakInfo(data,stages[activeStageIdx]);
        const tbMode=stages[activeStageIdx]?.tiebreakMode||"performance";
        const manualNeed=tb&&tbMode==="manual"?tb.remainder:0;
        const manualSelected=(data.manualTiebreakAdvancers||[]).length;
        const tiebreakStageMode=!!(tb&&tbMode==="stage");
        const canStartNext=!manualNeed||manualSelected>=manualNeed;
        return(
          <div style={{marginTop:20,padding:"14px 16px",borderRadius:10,border:"2px solid rgba(42,157,143,0.5)",background:"rgba(42,157,143,0.06)"}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"#2a9d8f",marginBottom:10}}>
              🏆 Stage {activeStageIdx+1} Complete · {advancing.length} advance{aatTeams.length>0?` + ${aatTeams.length} AAT join Stage ${activeStageIdx+2}`:""}
            </div>
            {aatTeams.length>0&&(
              <div style={{marginBottom:8}}>
                <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:4}}>Auto-advance teams (AAT)</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {aatTeams.map((t,i)=><div key={t.name} style={{display:"flex",alignItems:"center",gap:4,padding:"3px 7px",background:"rgba(42,157,143,0.08)",borderRadius:5,border:"1px solid rgba(42,157,143,0.3)"}}><span style={{fontSize:9,color:"#2a9d8f",fontWeight:700}}>S{t.seed}</span><TeamTag name={t.name} color={t.color} small/></div>)}
                </div>
              </div>
            )}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:4}}>Advancing from Stage {activeStageIdx+1}</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {advancing.map((t,i)=><div key={t.name} style={{display:"flex",alignItems:"center",gap:4,padding:"3px 7px",background:"var(--color-background-primary)",borderRadius:5,border:"0.5px solid var(--color-border-tertiary)"}}><span style={{fontSize:9,color:"#e9c46a",fontWeight:700}}>#{aatTeams.length+i+1}</span><TeamTag name={t.name} color={t.color} small/></div>)}
              </div>
            </div>
            {tb&&tbMode==="manual"&&(
              <div style={{marginBottom:12,padding:"10px",borderRadius:8,background:"var(--color-background-primary)",border:"1px solid rgba(233,196,106,0.35)"}}>
                <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:"#b8921a",marginBottom:6}}>Choose {tb.remainder} tiebreak team{tb.remainder>1?"s":""}</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {tb.candidates.map(c=>{
                    const selected=(data.manualTiebreakAdvancers||[]).includes(c.row.team.name);
                    const full=!selected&&manualSelected>=tb.remainder;
                    return <button key={c.row.team.name} onClick={()=>!full&&onStageUpdate(activeStageIdx,d=>{
                      const cur=d.manualTiebreakAdvancers||[];
                      const next=cur.includes(c.row.team.name)?cur.filter(n=>n!==c.row.team.name):[...cur,c.row.team.name];
                      return {...d,manualTiebreakAdvancers:next.slice(0,tb.remainder)};
                    })} style={{...btn(selected),opacity:full?0.45:1,padding:"4px 9px",fontSize:11}}>Group {String.fromCharCode(65+c.group)} · {c.row.team.name}</button>;
                  })}
                </div>
              </div>
            )}
            {tb&&tbMode==="performance"&&(
              <div style={{fontSize:11,color:"var(--color-text-tertiary)",marginBottom:10}}>Tiebreak selected by performance: match wins, game wins, then score difference.</div>
            )}
            {tiebreakStageMode&&(
              <div style={{fontSize:11,color:"var(--color-text-tertiary)",marginBottom:10}}>A temporary tiebreak stage will be inserted for the tied placed teams.</div>
            )}
            <div style={{fontSize:11,color:"var(--color-text-tertiary)",marginBottom:10,fontFamily:"'Barlow Condensed',sans-serif"}}>
              Stage {activeStageIdx+2} will have <strong style={{color:"var(--color-text-primary)"}}>{nextStageTeams.length} teams</strong>
            </div>
            <button disabled={!canStartNext} onClick={()=>canStartNext&&onAdvance(activeStageIdx,advancing)} style={{padding:"8px 20px",borderRadius:8,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:13,textTransform:"uppercase",letterSpacing:"0.06em",background:canStartNext?"#2a9d8f":"var(--color-background-secondary)",color:canStartNext?"white":"var(--color-text-tertiary)",border:"none",cursor:canStartNext?"pointer":"not-allowed"}}>
              {tiebreakStageMode?`Create Tiebreak Stage →`:`Start Stage ${activeStageIdx+2} →`}
            </button>
          </div>
        );
      })()}

      {/* Standings below the bracket (for single/double stages) */}
      {data&&data.type!=="roundrobin"&&data.type!=="groupstage"&&(
        <div style={{marginTop:24}}>
          {!showPlayers
            ?<TeamStandingsTable teams={getStageTeams(activeStageIdx)} matches={getStageMatches(data)} title={`Stage ${activeStageIdx+1} Team Standings`} showScore={stages[activeStageIdx]?.matchMode==="score"}/>
            :<PlayerStandingsTable teams={teams} matches={allMatches} stageMatchSets={stages.map((_,idx)=>getStageMatches(stageData[idx]))} statCols={statCols} title="Player Standings" sortBy={playerSort} onSortBy={setPlayerSort}/>}
        </div>
      )}
    </div>
  );
}

// ─── Main app pools ───────────────────────────────────────────────────────────
const AUTOFILL_POOLS=[
  ["Football",["Arsenal","Chelsea","Liverpool","Man City","Tottenham","Man Utd","Everton","Leicester","Newcastle","Wolves","Aston Villa","West Ham","Leeds","Southampton","Brighton","Brentford","Crystal Palace","Fulham","Bournemouth","Nottm Forest","Luton","Sheff Utd","Ipswich","Oxford","Coventry","Preston"]],
  ["Basketball",["Lakers","Bulls","Warriors","Celtics","Nets","Suns","Bucks","Heat","Knicks","Spurs","Cavs","Raptors","Clippers","Nuggets","Mavericks","Thunder","Blazers","Kings","Jazz","Grizzlies","Hawks","Hornets","Pacers","Magic","Pistons","Wizards"]],
  ["Esports",["Alpha","Bravo","Charlie","Delta","Echo","Foxtrot","Gamma","Horizon","Inferno","Jade","Kestrel","Lynx","Midnight","Nova","Omega","Phoenix","Quantum","Raven","Storm","Titan","Ulysses","Viper","Wraith","Xenon","Yeti","Zephyr"]],
];

const STORAGE_KEY="tourney:tournament-state:v1";
const PROJECTS_KEY="tourney:projects:v1";
const FOLDERS_KEY="tourney:folders:v1";
const USERS_KEY="tourney:users:v1";
const AUTH_KEY="tourney:auth:v1";
const DEFAULT_AWARDS={weekMvps:[],stageMvps:[],finalMvps:[],finalMvpCount:1};
const DEFAULT_STAGES=[{format:"single",teamCount:8,matchMode:"wl",gamesPerMatch:1,advance:4}];
const SUPABASE_URL=import.meta.env.VITE_SUPABASE_URL||"";
const SUPABASE_ANON_KEY=import.meta.env.VITE_SUPABASE_ANON_KEY||"";
const supabaseConfigured=!!(SUPABASE_URL&&SUPABASE_ANON_KEY);
const supabase=supabaseConfigured?createClient(SUPABASE_URL,SUPABASE_ANON_KEY):null;

function userFromSupabase(user){
  if(!user)return null;
  return {id:user.id,email:user.email||"",name:user.user_metadata?.name||user.email?.split("@")[0]||"Player",supabase:true};
}

function projectToRow(project,userId){
  return {
    id:project.id,
    user_id:userId,
    name:project.name,
    format_type:project.formatType||project.state?.formatType||null,
    team_count:project.teamCount||project.state?.teams?.length||0,
    folder_id:project.folderId||null,
    state:project.state,
    updated_at:project.updatedAt||new Date().toISOString()
  };
}

function rowToProject(row){
  return {
    id:row.id,
    name:row.name,
    formatType:row.format_type,
    teamCount:row.team_count,
    folderId:row.folder_id,
    state:row.state,
    updatedAt:row.updated_at
  };
}

function folderToRow(folder,userId){
  return {id:folder.id,user_id:userId,name:folder.name,project_ids:folder.projectIds||[],updated_at:folder.updatedAt||new Date().toISOString()};
}

function rowToFolder(row){
  return {id:row.id,name:row.name,projectIds:row.project_ids||[],updatedAt:row.updated_at};
}

async function loadCloudData(userId){
  if(!supabase)return{projects:[],folders:[]};
  const [projectResult,folderResult]=await Promise.all([
    supabase.from("tourney_projects").select("*").eq("user_id",userId).order("updated_at",{ascending:false}),
    supabase.from("tourney_folders").select("*").eq("user_id",userId).order("updated_at",{ascending:false})
  ]);
  if(projectResult.error)throw projectResult.error;
  if(folderResult.error)throw folderResult.error;
  return {
    projects:(projectResult.data||[]).map(rowToProject),
    folders:(folderResult.data||[]).map(rowToFolder)
  };
}

async function saveCloudProjects(projects,userId){
  if(!supabase||!userId||projects.length===0)return;
  const {error}=await supabase.from("tourney_projects").upsert(projects.map(project=>projectToRow(project,userId)),{onConflict:"id"});
  if(error)throw error;
}

async function saveCloudFolders(folders,userId){
  if(!supabase||!userId||folders.length===0)return;
  const {error}=await supabase.from("tourney_folders").upsert(folders.map(folder=>folderToRow(folder,userId)),{onConflict:"id"});
  if(error)throw error;
}

function safeFileName(value,fallback="tournament"){
  const cleaned=(value||"").trim().replace(/[^a-z0-9._-]+/gi,"-").replace(/^-+|-+$/g,"");
  return cleaned||fallback;
}

function downloadBlob(blob,fileName){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=fileName;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function tournamentEnvelope(project){
  return {schema:"tourney-tournament",version:1,exportedAt:new Date().toISOString(),project};
}

function validateTournamentEnvelope(value){
  if(value?.schema!=="tourney-tournament"||value?.version!==1||!value.project?.state)throw new Error("This is not a supported .tourney.json file.");
  return value.project;
}

function storageKeyForUser(base,user){
  return user?.id?`${base}:${user.id}`:base;
}

function loadUsers(){
  if(typeof window==="undefined")return[];
  try{
    const parsed=JSON.parse(window.localStorage.getItem(USERS_KEY)||"null");
    return parsed?.version===1&&Array.isArray(parsed.users)?parsed.users:[];
  }catch{return[];}
}

function saveUsers(users){
  window.localStorage.setItem(USERS_KEY,JSON.stringify({version:1,users}));
}

function loadActiveUser(){
  if(typeof window==="undefined")return null;
  try{
    const auth=JSON.parse(window.localStorage.getItem(AUTH_KEY)||"null");
    if(!auth?.userId)return null;
    return loadUsers().find(user=>user.id===auth.userId)||null;
  }catch{return null;}
}

function simplePasswordHash(value){
  try{return btoa(unescape(encodeURIComponent(`tourney:${value}`)));}
  catch{return value;}
}

function base64UrlFromBytes(bytes){
  let binary="";
  bytes.forEach(byte=>{binary+=String.fromCharCode(byte);});
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

function bytesFromBase64Url(value){
  const normalized=value.replace(/-/g,"+").replace(/_/g,"/");
  const binary=atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,"="));
  return Uint8Array.from(binary,ch=>ch.charCodeAt(0));
}

function makeSharePayload(project){
  return base64UrlFromBytes(zlibSync(strToU8(JSON.stringify(tournamentEnvelope(project)))));
}

function projectFromSharePayload(value){
  return validateTournamentEnvelope(JSON.parse(strFromU8(unzlibSync(bytesFromBase64Url(value)))));
}

function loadSavedFolders(user=null){
  if(typeof window==="undefined")return[];
  try{
    const parsed=JSON.parse(window.localStorage.getItem(storageKeyForUser(FOLDERS_KEY,user))||"null");
    return parsed?.version===1&&Array.isArray(parsed.folders)?parsed.folders:[];
  }catch{return[];}
}

function dataMatches(data){
  if(!data)return[];
  if(data.type==="roundrobin")return(data.rounds||[]).flat();
  if(data.type==="groupstage")return(data.groups||[]).flatMap(g=>(g.rounds||[]).flat());
  if(data.type==="single")return[...(data.winners||[]).flat(),...(data.qualificationTiebreaker?.rounds||[]).flat()];
  if(data.type==="double"){
    const propagated=propagateDoubleElim(data);
    return[...(propagated.winners||[]).flat(),...(propagated.losers||[]).flat(),...(data.qualificationTiebreaker?.rounds||[]).flat(),propagated.grandFinal,propagated.grandFinalReset].filter(Boolean);
  }
  return[];
}

function matchHasEntry(match){
  if(!match)return false;
  if(match.mvp)return true;
  if(match.games?.some(g=>g.winnerName||g.scoreA!==""||g.scoreB!==""||g.gameMvp||Object.keys(g.stats||{}).length>0))return true;
  return !!matchResult(match).winner;
}

function matchesHaveEntries(matches){
  return (matches||[]).some(matchHasEntry);
}

function finalProjectData(state){
  if(!state)return null;
  if(state.formatType==="multi"){
    const keys=Object.keys(state.stageData||{}).map(Number).filter(Number.isFinite).sort((a,b)=>b-a);
    return keys.length?state.stageData[keys[0]]:null;
  }
  if(state.formatType==="roundrobin")return{type:"roundrobin",rounds:state.rrRounds||[],teams:state.teams||[]};
  return state.bracketData;
}

function tournamentIsComplete(state){
  const data=finalProjectData(state);if(!data)return false;
  if(data.type==="roundrobin"||data.type==="groupstage"){
    const matches=playableMatches(dataMatches(data));
    return matches.length>0&&matches.every(matchIsComplete);
  }
  if(data.type==="single")return!!matchResult(data.winners?.[data.winners.length-1]?.[0]).winner;
  if(data.type==="double"){
    const propagated=propagateDoubleElim(data),gf=matchResult(propagated.grandFinal);
    if(gf.winner?.name===propagated.grandFinal.teamA?.name)return true;
    return!!matchResult(propagated.grandFinalReset).winner;
  }
  return false;
}

function projectPlacements(project){
  const state=project?.state,data=finalProjectData(state);if(!data)return[];
  const matches=playableMatches(dataMatches(data));
  const matchTeams=matches.flatMap(match=>[match.teamA,match.teamB]).filter(Boolean).filter((team,i,all)=>all.findIndex(other=>other.name===team.name)===i);
  const teams=data.teams||matchTeams.length&&matchTeams||state.teams||[];
  const standingsRules=state?.formatType==="roundrobin"?state.rrStandingsRules:null;
  if(data.type==="groupstage"){
    return(data.groups||[]).flatMap(g=>computeTeamStandings(g.teams,(g.rounds||[]).flat(),standingsRules).map(r=>r.team)).filter((t,i,a)=>a.findIndex(x=>x.name===t.name)===i);
  }
  const ranked=computeTeamStandings(teams,matches,standingsRules).map(r=>r.team);
  if(data.type==="single"){
    const champion=matchResult(data.winners?.[data.winners.length-1]?.[0]).winner;
    return champion?[champion,...ranked.filter(t=>t.name!==champion.name)]:ranked;
  }
  if(data.type==="double"){
    const propagated=propagateDoubleElim(data),gf=matchResult(propagated.grandFinal),gfr=matchResult(propagated.grandFinalReset);
    const champion=gf.winner?.name===propagated.grandFinal.teamA?.name?gf.winner:gfr.winner||null;
    const runner=champion?(champion.name===propagated.grandFinal.teamA?.name?propagated.grandFinal.teamB:propagated.grandFinal.teamA):null;
    return[champion,runner,...ranked].filter(Boolean).filter((t,i,a)=>a.findIndex(x=>x.name===t.name)===i);
  }
  return ranked;
}

function resolveQualificationLink(link,projects){
  const source=projects.find(p=>p.id===link.sourceProjectId);
  const complete=!!source&&tournamentIsComplete(source.state);
  const team=complete?projectPlacements(source)[Math.max(0,(link.placement||1)-1)]:null;
  return{source,complete,team};
}

function materializeTeams(manualTeams,links,projects,total){
  const slots=Array.from({length:Math.max(total||0,manualTeams.length+(links||[]).length)},()=>null);
  (links||[]).forEach(link=>{
    const idx=Math.max(0,(link.seed||1)-1),resolved=resolveQualificationLink(link,projects);
    slots[idx]=resolved.team?{...resolved.team,_qualificationLinkId:link.id,_qualificationSourceId:link.sourceProjectId}:{name:`${resolved.source?.name||"Qualifier"} · Place ${link.placement||1}`,color:"#94a3b8",region:"Pending",players:[],_qualificationLinkId:link.id,_qualificationSourceId:link.sourceProjectId,_qualificationPending:true};
  });
  let cursor=0;
  manualTeams.forEach(team=>{while(slots[cursor])cursor++;slots[cursor++]={...team};});
  return slots.slice(0,total||slots.length).filter(Boolean).map((team,i)=>({...team,seed:i+1}));
}

function rebindQualifiedTeams(value,resolvedById){
  if(Array.isArray(value))return value.map(v=>rebindQualifiedTeams(v,resolvedById));
  if(!value||typeof value!=="object")return value;
  if(value._qualificationLinkId&&resolvedById[value._qualificationLinkId])return{...value,...resolvedById[value._qualificationLinkId],seed:value.seed};
  return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,rebindQualifiedTeams(v,resolvedById)]));
}

function renameTeamRefs(value,oldName,newName){
  if(Array.isArray(value))return value.map(v=>renameTeamRefs(v,oldName,newName));
  if(!value||typeof value!=="object")return value;
  const next={};
  Object.entries(value).forEach(([key,v])=>{
    if(key==="winnerName"&&v===oldName)next[key]=newName;
    else if(key==="manualTiebreakAdvancers"&&Array.isArray(v))next[key]=v.map(name=>name===oldName?newName:name);
    else next[key]=renameTeamRefs(v,oldName,newName);
  });
  const looksLikeTeam=next.name===oldName&&(Array.isArray(next.players)||"color" in next||"seed" in next||"region" in next||"_qualificationLinkId" in next);
  return looksLikeTeam?{...next,name:newName}:next;
}

function loadSavedProjects(user=null){
  if(typeof window==="undefined")return null;
  try{
    const raw=window.localStorage.getItem(storageKeyForUser(PROJECTS_KEY,user));
    if(raw){
      const parsed=JSON.parse(raw);
      if(parsed?.version===1&&Array.isArray(parsed.projects))return parsed.projects;
    }
    if(user?.id)return [];
    const legacy=window.localStorage.getItem(STORAGE_KEY);
    if(!legacy)return [];
    const parsed=JSON.parse(legacy);
    if(parsed?.version!==1||parsed.state?.step!=="bracket")return [];
    return [{
      id:`legacy-${Date.now()}`,
      name:projectNameFromState(parsed.state),
      formatType:parsed.state.formatType,
      teamCount:parsed.state.teams?.length||0,
      updatedAt:parsed.savedAt||new Date().toISOString(),
      state:parsed.state
    }];
  }catch{
    return [];
  }
}

function hasTournamentProgress(state){
  return !!(
    state.formatType||
    state.teams?.length||
    state.deletedTeams?.length||
    state.bracketData||
    state.rrRounds?.length||
    Object.keys(state.stageData||{}).length
  );
}

function countryToIso(value){
  const v=(value||"").trim();
  if(!v)return "";
  if(/^[a-z]{2}$/i.test(v))return v.toLowerCase();
  return COUNTRY_MAP[v.toLowerCase()]||"";
}

function parsePersonLine(line){
  const cleaned=line.replace(/^[-*•]\s*/,"").trim();
  if(!cleaned)return null;
  const roleMatch=cleaned.match(/\b(player|substitute|sub|coach)\b/i);
  const role=roleMatch?/^sub/i.test(roleMatch[1])?"substitute":roleMatch[1].toLowerCase():"player";
  const paren=cleaned.match(/\(([^)]+)\)/);
  const nationality=countryToIso(paren?.[1]||"");
  const name=cleaned
    .replace(/\([^)]*\)/g,"")
    .replace(/\b(player|substitute|sub|coach)\b/ig,"")
    .replace(/[—–-]+/g," ")
    .replace(/\s+/g," ")
    .trim();
  return name?{name,nationality,role}:null;
}

function parseRosterText(text){
  return text.split(/\r?\n/).map(parsePersonLine).filter(Boolean);
}

function parseTeamHeader(line){
  const trimmed=line.trim();
  if(!trimmed||/^[-*•]/.test(trimmed))return null;
  const match=trimmed.match(/^(.+?)(?:\s*\(([^)]+)\))?$/);
  return match?{name:match[1].trim(),region:(match[2]||"").trim(),players:[]}:null;
}

function splitTableRow(line){
  const trimmed=line.trim();
  if(!trimmed)return [];
  if(trimmed.includes("\t"))return trimmed.split("\t").map(c=>c.trim()).filter(Boolean);
  return trimmed.split(/\s{2,}/).map(c=>c.trim()).filter(Boolean);
}

function parseTeamTableRows(text){
  const rows=text.split(/\r?\n/).map(splitTableRow).filter(cols=>cols.length>=4);
  if(rows.length===0)return [];
  const teams=[];
  const byName=new Map();
  rows.forEach(cols=>{
    const [teamName,teamRegion,playerName,playerCountry]=cols;
    if(!teamName||!playerName)return;
    const key=teamName.toLowerCase();
    if(!byName.has(key)){
      const team={name:teamName,region:teamRegion||"",players:[]};
      byName.set(key,team);
      teams.push(team);
    }
    byName.get(key).players.push({name:playerName,nationality:countryToIso(playerCountry),role:"player"});
  });
  return teams;
}

function parseTeamsText(text){
  const tableTeams=parseTeamTableRows(text);
  if(tableTeams.length>0)return tableTeams;
  const teams=[];
  let current=null;
  const lines=text.split(/\r?\n/);
  for(const line of lines){
    const trimmed=line.trim();
    if(!trimmed)continue;
    if(/^[-*•]/.test(trimmed)){
      const player=parsePersonLine(trimmed);
      if(player){
        if(!current){
          current={name:`Team ${teams.length+1}`,region:"",players:[]};
          teams.push(current);
        }
        current.players.push(player);
      }
      continue;
    }
    current=parseTeamHeader(trimmed);
    if(current)teams.push(current);
  }
  if(teams.length===0){
    return text.split(/\r?\n|,/).map(v=>v.trim()).filter(Boolean).map(name=>({name,region:"",players:[]}));
  }
  return teams;
}

function projectNameFromState(state){
  const format=state.formatType==="single"?"Single Elim":state.formatType==="double"?"Double Elim":state.formatType==="roundrobin"?"Round Robin":state.formatType==="multi"?"Multi-Stage":"Tournament";
  const firstTeams=(state.teams||[]).slice(0,2).map(t=>t.name).filter(Boolean).join(" vs ");
  return firstTeams?`${format}: ${firstTeams}`:format;
}

function requiredMultiTeams(stages){
  const starting=stages[0]?.teamCount||0;
  const aat=stages.slice(1).reduce((sum,stage)=>sum+(stage.aat||0),0);
  return starting+aat;
}

function recalcMultiStages(stages){
  return stages.map((stage,idx)=>{
    const clampSplit=next=>{
      if(next.format!=="double"||!next.splitStart)return {...next,splitStart:false,splitStartCount:0};
      const max=Math.max(1,Math.floor((next.teamCount||2)/2));
      return {...next,splitStartCount:Math.max(1,Math.min(max,next.splitStartCount||Math.max(1,Math.floor((next.teamCount||2)/4))))};
    };
    if(idx===0)return clampSplit({...stage,teamCount:Math.max(2,stage.teamCount||2),groupStage:stages.length===1?false:stage.groupStage});
    const isLast=idx===stages.length-1;
    const fromPrev=stages[idx-1]?.advance||2;
    const aat=stage.aat||0;
    const teamCount=Math.max(2,fromPrev+aat);
    return clampSplit({...stage,aat,teamCount,groupStage:isLast?false:stage.groupStage,advance:Math.min(stage.advance||Math.floor(teamCount/2),Math.max(1,teamCount-1))});
  });
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App(){
  const initialUserRef=useRef(supabaseConfigured?null:loadActiveUser());
  const initialProjectsRef=useRef(loadSavedProjects(initialUserRef.current)||[]);
  const initialFoldersRef=useRef(loadSavedFolders(initialUserRef.current));
  const tournamentImportRef=useRef(null);
  const folderImportRef=useRef(null);
  const qualificationSignatureRef=useRef("");
  const[step,setStep]=useState("setup");
  const[formatType,setFormatType]=useState(null); // "single"|"double"|"roundrobin"|"multi"
  const[teamCount,setTeamCount]=useState(8);
  const[matchMode,setMatchMode]=useState("wl");
  const[gamesPerMatch,setGamesPerMatch]=useState(1);
  const[rrStandingsRules,setRrStandingsRules]=useState(DEFAULT_STANDINGS_RULES);
  const[statCols,setStatCols]=useState(["Score"]);
  const[teams,setTeams]=useState([]);
  const[deletedTeams,setDeletedTeams]=useState([]);
  const[teamInput,setTeamInput]=useState("");
  const[bracketData,setBracketData]=useState(null);
  const[rrRounds,setRrRounds]=useState([]);
  const[playerSort,setPlayerSort]=useState("mw");
  const[showPlayers,setShowPlayers]=useState(false);
  const[awards,setAwards]=useState(DEFAULT_AWARDS);
  const[showAwards,setShowAwards]=useState(false);
  const[savedProjects,setSavedProjects]=useState(initialProjectsRef.current);
  const[savedFolders,setSavedFolders]=useState(initialFoldersRef.current);
  const[currentUser,setCurrentUser]=useState(initialUserRef.current);
  const[authMode,setAuthMode]=useState("login");
  const[authOpen,setAuthOpen]=useState(!initialUserRef.current);
  const[authName,setAuthName]=useState("");
  const[authEmail,setAuthEmail]=useState("");
  const[authPassword,setAuthPassword]=useState("");
  const[authError,setAuthError]=useState("");
  const[cloudReady,setCloudReady]=useState(!supabaseConfigured);
  const[cloudMessage,setCloudMessage]=useState(supabaseConfigured?"Connecting to Supabase…":"Local browser mode");
  const[sharedProject,setSharedProject]=useState(null);
  const[shareMessage,setShareMessage]=useState("");
  const[projectName,setProjectName]=useState("");
  const[bracketTab,setBracketTab]=useState("tournament");
  const[currentFolderId,setCurrentFolderId]=useState(null);
  const[folderNameInput,setFolderNameInput]=useState("");
  const[currentProjectId,setCurrentProjectId]=useState(null);
  const[lastSavedAt,setLastSavedAt]=useState(null);
  const[saveError,setSaveError]=useState(false);

  // Multi-stage
  const[stages,setStages]=useState(DEFAULT_STAGES);
  const[stageData,setStageData]=useState({});
  const[activeStageIdx,setActiveStageIdx]=useState(0);
  const[qualificationLinks,setQualificationLinks]=useState([]);
  const[qualifierSourceId,setQualifierSourceId]=useState("");
  const[qualifierPlacement,setQualifierPlacement]=useState(1);
  const[qualifierSeed,setQualifierSeed]=useState(1);

  const isRR=formatType==="roundrobin";
  const isDE=formatType==="double";
  const isMulti=formatType==="multi";
  const rrTotalRounds=teamCount%2===0?teamCount-1:teamCount;
  const teamsWithSeed=materializeTeams(teams,qualificationLinks,savedProjects,teamCount);
  const unresolvedQualificationLinks=qualificationLinks.filter(link=>!resolveQualificationLink(link,savedProjects).team);
  const currentFolder=savedFolders.find(f=>f.id===currentFolderId)||null;
  const folderProjects=currentFolder?(currentFolder.projectIds||[]).map(id=>savedProjects.find(p=>p.id===id)).filter(Boolean):[];
  const visibleProjects=currentFolder?folderProjects:savedProjects.filter(project=>!project.folderId);
  const availableQualifierProjects=folderProjects.filter(p=>p.id!==currentProjectId);
  const effectiveGames=matchMode==="wl"?1:gamesPerMatch;
  const allRegions=[...new Set(teams.map(t=>t.region).filter(Boolean))];

  const loadSupabaseAccount=async(user,carryProjects=savedProjects,carryFolders=savedFolders)=>{
    const appUser=userFromSupabase(user);
    if(!appUser)return;
    setCurrentUser(appUser);
    setCloudReady(false);
    try{
      const cloud=await loadCloudData(appUser.id);
      let nextProjects=cloud.projects;
      let nextFolders=cloud.folders;
      if(nextProjects.length===0&&carryProjects.length>0){
        nextProjects=carryProjects.map(project=>({...project,folderId:project.folderId||null}));
        await saveCloudProjects(nextProjects,appUser.id);
      }
      if(nextFolders.length===0&&carryFolders.length>0){
        nextFolders=carryFolders;
        await saveCloudFolders(nextFolders,appUser.id);
      }
      setSavedProjects(nextProjects);
      setSavedFolders(nextFolders);
      setCurrentFolderId(null);
      setAuthOpen(false);
      setCloudMessage("Supabase synced");
      setSaveError(false);
    }catch(error){
      setCloudMessage(error.message||"Could not load Supabase data.");
      setSaveError(true);
    }finally{
      setCloudReady(true);
    }
  };

  useEffect(()=>{
    if(!supabase)return;
    let cancelled=false;
    const connect=async()=>{
      setCloudReady(false);
      const {data,error}=await supabase.auth.getSession();
      if(cancelled)return;
      if(error){setCloudMessage(error.message);setCloudReady(true);setSaveError(true);return;}
      const user=data.session?.user;
      if(user){await loadSupabaseAccount(user);}
      else{
        setCurrentUser(null);
        setSavedProjects(loadSavedProjects(null)||[]);
        setSavedFolders(loadSavedFolders(null));
        setAuthOpen(true);
        setCloudMessage("Log in to sync with Supabase");
        setCloudReady(true);
      }
    };
    connect();
    const {data:{subscription}}=supabase.auth.onAuthStateChange(event=>{
      if(event==="SIGNED_OUT"){
        setCurrentUser(null);
        setSavedProjects(loadSavedProjects(null)||[]);
        setSavedFolders(loadSavedFolders(null));
        setCurrentFolderId(null);
        setAuthMode("login");
        setAuthOpen(true);
        setCloudMessage("Logged out");
        setCloudReady(true);
      }
    });
    return()=>{cancelled=true;subscription?.unsubscribe();};
  },[]);

  useEffect(()=>{
    if(typeof window==="undefined")return;
    const payload=new URLSearchParams(window.location.search).get("share");
    if(!payload)return;
    try{
      const project=projectFromSharePayload(payload);
      setSharedProject({...project,id:`shared-${Date.now()}`,shared:true});
      setShareMessage(`Opened shared tournament: ${project.name}`);
    }catch{
      setShareMessage("This share link could not be opened.");
    }
  },[]);

  useEffect(()=>{
    if(typeof window==="undefined")return;
    try{
      window.localStorage.setItem(storageKeyForUser(PROJECTS_KEY,currentUser),JSON.stringify({version:1,projects:savedProjects}));
      setSaveError(false);
    }catch{
      setSaveError(true);
    }
  },[savedProjects,currentUser]);

  useEffect(()=>{
    if(typeof window==="undefined")return;
    try{window.localStorage.setItem(storageKeyForUser(FOLDERS_KEY,currentUser),JSON.stringify({version:1,folders:savedFolders}));setSaveError(false);}catch{setSaveError(true);}
  },[savedFolders,currentUser]);

  useEffect(()=>{
    if(!supabase||!currentUser?.supabase||!cloudReady)return;
    let cancelled=false;
    const sync=async()=>{
      try{await saveCloudProjects(savedProjects,currentUser.id);if(!cancelled){setCloudMessage("Supabase synced");setSaveError(false);}}
      catch(error){if(!cancelled){setCloudMessage(error.message||"Supabase project sync failed.");setSaveError(true);}}
    };
    sync();
    return()=>{cancelled=true;};
  },[savedProjects,currentUser,cloudReady]);

  useEffect(()=>{
    if(!supabase||!currentUser?.supabase||!cloudReady)return;
    let cancelled=false;
    const sync=async()=>{
      try{await saveCloudFolders(savedFolders,currentUser.id);if(!cancelled){setCloudMessage("Supabase synced");setSaveError(false);}}
      catch(error){if(!cancelled){setCloudMessage(error.message||"Supabase folder sync failed.");setSaveError(true);}}
    };
    sync();
    return()=>{cancelled=true;};
  },[savedFolders,currentUser,cloudReady]);


  useEffect(()=>{
    if(step!=="bracket"||!currentProjectId)return;
    const state={step,formatType,teamCount,matchMode,gamesPerMatch,rrStandingsRules,statCols,teams,deletedTeams,teamInput,bracketData,rrRounds,playerSort,showPlayers,awards,showAwards,stages,stageData,activeStageIdx,qualificationLinks,projectName};
    const hasBracket=isMulti?Object.keys(stageData||{}).length>0:isRR?rrRounds.length>0:!!bracketData;
    if(!hasBracket)return;
    const updatedAt=new Date().toISOString();
    const savedName=projectName.trim()||projectNameFromState({...state,teams:teamsWithSeed});
    const project={id:currentProjectId,name:savedName,formatType,teamCount:teamsWithSeed.length,updatedAt,state:{...state,projectName:savedName},folderId:currentFolderId||null};
    setSavedProjects(prev=>{
      const others=prev.filter(p=>p.id!==currentProjectId);
      return [project,...others].slice(0,20);
    });
    setLastSavedAt(new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}));
  },[step,currentProjectId,currentFolderId,formatType,teamCount,matchMode,gamesPerMatch,rrStandingsRules,statCols,teams,deletedTeams,teamInput,bracketData,rrRounds,playerSort,showPlayers,awards,showAwards,stages,stageData,activeStageIdx,qualificationLinks,projectName,isMulti,isRR]);

  useEffect(()=>{
    if(step!=="bracket"||!qualificationLinks.length)return;
    const resolvedById={};
    qualificationLinks.forEach(link=>{const resolved=resolveQualificationLink(link,savedProjects);if(resolved.team)resolvedById[link.id]={...resolved.team,_qualificationLinkId:link.id,_qualificationSourceId:link.sourceProjectId};});
    const signature=JSON.stringify(Object.entries(resolvedById).map(([id,t])=>[id,t.name,t.region]));
    if(!signature||signature===qualificationSignatureRef.current)return;
    qualificationSignatureRef.current=signature;
    setBracketData(prev=>prev?rebindQualifiedTeams(prev,resolvedById):prev);
    setRrRounds(prev=>prev.length?rebindQualifiedTeams(prev,resolvedById):prev);
    setStageData(prev=>Object.keys(prev).length?rebindQualifiedTeams(prev,resolvedById):prev);
  },[step,qualificationLinks,savedProjects]);

  const loadProject=(project)=>{
    const s=project.state;
    if(!s)return;
    setCurrentProjectId(project.shared?null:project.id);
    setStep("bracket");
    setFormatType(s.formatType||null);
    setTeamCount(s.teamCount||8);
    setMatchMode(s.matchMode||"wl");
    setGamesPerMatch(s.gamesPerMatch||1);
    setRrStandingsRules(normalizeStandingsRules(s.rrStandingsRules));
    setStatCols(s.statCols||["Score"]);
    setTeams(s.teams||[]);
    setDeletedTeams(s.deletedTeams||[]);
    setTeamInput(s.teamInput||"");
    setBracketData(s.bracketData||null);
    setRrRounds(s.rrRounds||[]);
    setPlayerSort(s.playerSort||"mw");
    setShowPlayers(s.showPlayers||false);
    setAwards(s.awards||DEFAULT_AWARDS);
    setShowAwards(s.showAwards||false);
    setStages(s.stages||DEFAULT_STAGES);
    setStageData(s.stageData||{});
    setActiveStageIdx(s.activeStageIdx||0);
    setQualificationLinks(s.qualificationLinks||[]);
    setProjectName(s.projectName||project.name||projectNameFromState(s));
    setBracketTab("tournament");
    setCurrentFolderId(project.shared?null:project.folderId||null);
    setLastSavedAt(new Date(project.updatedAt||Date.now()).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}));
  };

  const clearAuthForm=()=>{setAuthName("");setAuthEmail("");setAuthPassword("");setAuthError("");};

  const handleAuth=async()=>{
    const email=authEmail.trim().toLowerCase();
    const password=authPassword;
    if(!email||!password){setAuthError("Email and password are required.");return;}
    if(supabase){
      setAuthError("");
      const projectsToCarry=savedProjects;
      const foldersToCarry=savedFolders;
      if(authMode==="signup"){
        const {data,error}=await supabase.auth.signUp({
          email,
          password,
          options:{data:{name:authName.trim()||email.split("@")[0]},emailRedirectTo:window.location.origin}
        });
        if(error){setAuthError(error.message);return;}
        if(data.session?.user){
          await loadSupabaseAccount(data.session.user,projectsToCarry,foldersToCarry);
          clearAuthForm();goHome();
        }else{
          setAuthMode("login");
          setAuthPassword("");
          setAuthError("Account created. Check your email to confirm it, then log in.");
        }
        return;
      }
      const {data,error}=await supabase.auth.signInWithPassword({email,password});
      if(error){setAuthError(error.message);return;}
      await loadSupabaseAccount(data.user,projectsToCarry,foldersToCarry);
      clearAuthForm();goHome();
      return;
    }
    const users=loadUsers();
    if(authMode==="signup"){
      if(users.some(user=>user.email===email)){setAuthError("That email already has an account.");return;}
      const user={id:`user-${Date.now()}`,name:authName.trim()||email.split("@")[0],email,passwordHash:simplePasswordHash(password),createdAt:new Date().toISOString()};
      const next=[user,...users];
      const projectsToCarry=savedProjects;
      const foldersToCarry=savedFolders;
      saveUsers(next);
      window.localStorage.setItem(AUTH_KEY,JSON.stringify({version:1,userId:user.id}));
      setCurrentUser(user);setSavedProjects(projectsToCarry);setSavedFolders(foldersToCarry);setCurrentFolderId(null);setAuthOpen(false);clearAuthForm();goHome();
      return;
    }
    const user=users.find(u=>u.email===email&&u.passwordHash===simplePasswordHash(password));
    if(!user){setAuthError("Wrong email or password.");return;}
    window.localStorage.setItem(AUTH_KEY,JSON.stringify({version:1,userId:user.id}));
    setCurrentUser(user);setSavedProjects(loadSavedProjects(user)||[]);setSavedFolders(loadSavedFolders(user));setCurrentFolderId(null);setAuthOpen(false);clearAuthForm();goHome();
  };

  const logout=async()=>{
    if(supabase)await supabase.auth.signOut();
    if(typeof window!=="undefined")window.localStorage.removeItem(AUTH_KEY);
    setCurrentUser(null);setSavedProjects(loadSavedProjects(null)||[]);setSavedFolders(loadSavedFolders(null));setCurrentFolderId(null);setAuthMode("login");setAuthOpen(true);goHome();
  };

  const saveSharedProject=()=>{
    if(!sharedProject)return;
    const id=savedProjects.some(p=>p.id===sharedProject.id)?`project-${Date.now()}`:sharedProject.id.replace(/^shared-/,"project-");
    const project={...sharedProject,id,shared:false,folderId:currentFolderId||null,updatedAt:new Date().toISOString()};
    setSavedProjects(prev=>[project,...prev.filter(p=>p.id!==id)]);
    if(currentFolderId)setSavedFolders(prev=>prev.map(f=>f.id===currentFolderId?{...f,projectIds:[id,...(f.projectIds||[]).filter(x=>x!==id)],updatedAt:new Date().toISOString()}:f));
    setSharedProject(null);
    setShareMessage("Shared tournament saved to your projects.");
    loadProject(project);
  };

  const shareProject=async(project)=>{
    if(!project)return;
    try{
      const url=new URL(window.location.href);
      url.search="";
      url.hash="";
      url.searchParams.set("share",makeSharePayload(project));
      const link=url.toString();
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(link);
      else window.prompt("Copy this share link:",link);
      setShareMessage("Share link copied. Anyone with the link can open this tournament snapshot.");
    }catch(error){
      setShareMessage(error.message||"Could not create share link.");
    }
  };

  const createFolder=()=>{
    const name=folderNameInput.trim();if(!name)return;
    const folder={id:`folder-${Date.now()}`,name,projectIds:[],updatedAt:new Date().toISOString()};
    setSavedFolders(prev=>[folder,...prev]);setCurrentFolderId(folder.id);setFolderNameInput("");
  };

  const exportProject=(project)=>{
    const json=JSON.stringify(tournamentEnvelope(project),null,2);
    downloadBlob(new Blob([json],{type:"application/json"}),`${safeFileName(project.name)}.tourney.json`);
  };

  const importTournamentFile=async file=>{
    if(!file)return;
    try{
      const imported=validateTournamentEnvelope(JSON.parse(await file.text()));
      const id=savedProjects.some(p=>p.id===imported.id)?`project-${Date.now()}`:imported.id||`project-${Date.now()}`;
      const project={...imported,id,folderId:currentFolderId||null,updatedAt:new Date().toISOString()};
      setSavedProjects(prev=>[project,...prev.filter(p=>p.id!==id)]);
      if(currentFolderId)setSavedFolders(prev=>prev.map(f=>f.id===currentFolderId?{...f,projectIds:[id,...(f.projectIds||[]).filter(x=>x!==id)],updatedAt:new Date().toISOString()}:f));
      loadProject(project);
    }catch(error){alert(error.message||"Could not import tournament file.");}
    if(tournamentImportRef.current)tournamentImportRef.current.value="";
  };

  const exportFolder=folder=>{
    const projects=(folder.projectIds||[]).map(id=>savedProjects.find(p=>p.id===id)).filter(Boolean);
    const files={};
    const manifest={schema:"tourney-folder",version:1,id:folder.id,name:folder.name,exportedAt:new Date().toISOString(),tournaments:projects.map((project,index)=>({id:project.id,name:project.name,file:`tournaments/${String(index+1).padStart(2,"0")}-${safeFileName(project.name)}.tourney.json`}))};
    files["manifest.json"]=strToU8(JSON.stringify(manifest,null,2));
    manifest.tournaments.forEach(item=>{const project=projects.find(p=>p.id===item.id);files[item.file]=strToU8(JSON.stringify(tournamentEnvelope(project),null,2));});
    downloadBlob(new Blob([zipSync(files,{level:6})],{type:"application/zip"}),`${safeFileName(folder.name,"tournament-folder")}.tourney-folder.zip`);
  };

  const importFolderFile=async file=>{
    if(!file)return;
    try{
      const archive=unzipSync(new Uint8Array(await file.arrayBuffer()));
      const manifest=JSON.parse(strFromU8(archive["manifest.json"]||new Uint8Array()));
      if(manifest?.schema!=="tourney-folder"||manifest?.version!==1||!Array.isArray(manifest.tournaments))throw new Error("This is not a supported .tourney-folder.zip archive.");
      const folderId=`folder-${Date.now()}`,idMap={};
      manifest.tournaments.forEach((item,index)=>{idMap[item.id]=`project-${Date.now()}-${index}`;});
      const projects=manifest.tournaments.map(item=>{
        const project=validateTournamentEnvelope(JSON.parse(strFromU8(archive[item.file]||new Uint8Array())));
        const state={...project.state,qualificationLinks:(project.state.qualificationLinks||[]).map(link=>({...link,sourceProjectId:idMap[link.sourceProjectId]||link.sourceProjectId}))};
        return{...project,id:idMap[item.id],folderId,updatedAt:new Date().toISOString(),state};
      });
      const folder={id:folderId,name:manifest.name||file.name.replace(/\.tourney-folder\.zip$/i,""),projectIds:projects.map(p=>p.id),updatedAt:new Date().toISOString()};
      setSavedProjects(prev=>[...projects,...prev]);setSavedFolders(prev=>[folder,...prev]);setCurrentFolderId(folderId);setStep("setup");
    }catch(error){alert(error.message||"Could not import tournament folder.");}
    if(folderImportRef.current)folderImportRef.current.value="";
  };

  const goHome=()=>{setCurrentProjectId(null);setLastSavedAt(null);setStep("setup");setFormatType(null);setTeams([]);setDeletedTeams([]);setTeamInput("");setBracketData(null);setRrRounds([]);setTeamCount(8);setGamesPerMatch(1);setMatchMode("wl");setRrStandingsRules(DEFAULT_STANDINGS_RULES);setStatCols(["Score"]);setStages(DEFAULT_STAGES);setStageData({});setActiveStageIdx(0);setShowPlayers(false);setAwards(DEFAULT_AWARDS);setShowAwards(false);setQualificationLinks([]);setProjectName("");setBracketTab("tournament");};

  const deleteProject=async(project)=>{
    if(!window.confirm(`Delete "${project.name}"? This cannot be undone.`))return;
    setSavedProjects(prev=>prev.filter(p=>p.id!==project.id));
    setSavedFolders(prev=>prev.map(f=>({...f,projectIds:(f.projectIds||[]).filter(id=>id!==project.id)})));
    if(supabase&&currentUser?.supabase){
      const {error}=await supabase.from("tourney_projects").delete().eq("id",project.id);
      if(error){setCloudMessage(error.message);setSaveError(true);}
    }
    if(currentProjectId===project.id)goHome();
  };

  const renameSavedProject=(project)=>{
    const name=window.prompt("Tournament name",project.name||"");
    if(name==null)return;
    const clean=name.trim();
    if(!clean)return;
    setSavedProjects(prev=>prev.map(p=>p.id===project.id?{...p,name:clean,state:{...p.state,projectName:clean},updatedAt:new Date().toISOString()}:p));
    if(currentProjectId===project.id)setProjectName(clean);
  };

  const updateMultiStages=(updater)=>{
    setStages(prev=>{
      const next=recalcMultiStages(typeof updater==="function"?updater(prev):updater);
      setTeamCount(count=>Math.max(count,requiredMultiTeams(next)));
      return next;
    });
  };

  const addTeam=(teamObj)=>{
    const name=teamObj?teamObj.name:teamInput.trim();if(!name)return;
    const existing=deletedTeams.find(t=>t.name.toLowerCase()===name.toLowerCase());
    const t=teamObj||existing||{name,color:palette[teams.length%palette.length],region:"",players:[]};
    if(!t.color)t.color=palette[teams.length%palette.length];
    if(!t.players)t.players=[];
    setTeams(p=>[...p,t]);setDeletedTeams(p=>p.filter(x=>x.name!==t.name));
    if(!teamObj)setTeamInput("");
  };
  const bulkAddTeams=(parsed)=>setTeams(p=>[...p,...parsed.map((t,i)=>({name:t.name||`Team ${p.length+i+1}`,color:palette[(p.length+i)%palette.length],region:t.region||"",players:(t.players||[]).map(pl=>({name:pl.name,nationality:pl.nationality||"",role:pl.role||"player"}))}))]);
  const removeTeam=(i)=>{const r=teams[i];setTeams(p=>p.filter((_,idx)=>idx!==i));setDeletedTeams(p=>p.some(t=>t.name===r.name)?p:[...p,r]);};
  const updateTeam=(i,updated)=>setTeams(p=>p.map((t,idx)=>idx===i?updated:t));
  const addQualificationLink=()=>{
    if(!qualifierSourceId)return;
    const seed=Math.max(1,Math.min(teamCount,Number(qualifierSeed)||1));
    const placement=Math.max(1,Number(qualifierPlacement)||1);
    setQualificationLinks(prev=>[...prev.filter(link=>link.seed!==seed),{id:`qual-${Date.now()}`,seed,sourceProjectId:qualifierSourceId,placement}].sort((a,b)=>a.seed-b.seed));
  };
  const manualTeamCapacity=Math.max(0,teamCount-qualificationLinks.length);
  const canStartBracket=teamsWithSeed.length===teamCount&&teamsWithSeed.length>=2&&unresolvedQualificationLinks.length===0;
  const currentTournamentName=projectName.trim()||(currentProjectId?projectNameFromState({formatType,teams:teamsWithSeed}):"");
  const nonMultiMatches=isRR?rrRounds.flat():bracketData?dataMatches(bracketData):[];
  const nonMultiSettingsLocked=!isMulti&&matchesHaveEntries(nonMultiMatches);
  const nonMultiMetricRulesLocked=!isMulti&&isRR&&stageDataComplete({type:"roundrobin",rounds:rrRounds,teams:teamsWithSeed});

  const renameParticipant=(seed,newName)=>{
    const name=newName.trim();
    const current=teamsWithSeed.find(t=>t.seed===seed);
    if(!current||!name||name===current.name)return;
    if(teamsWithSeed.some(t=>t.seed!==seed&&t.name.trim().toLowerCase()===name.toLowerCase())){
      alert("Another participant already has that name.");
      return;
    }
    const oldName=current.name;
    setTeams(prev=>prev.map(team=>team.name===oldName?{...team,name}:team));
    setDeletedTeams(prev=>prev.map(team=>team.name===oldName?{...team,name}:team));
    setBracketData(prev=>prev?renameTeamRefs(prev,oldName,name):prev);
    setRrRounds(prev=>prev.length?renameTeamRefs(prev,oldName,name):prev);
    setStageData(prev=>Object.keys(prev||{}).length?renameTeamRefs(prev,oldName,name):prev);
  };

  const rebuildNonMultiBracket=(nextFormat,nextMode,nextGames)=>{
    const g=nextMode==="wl"?1:nextGames;
    const t=teamsWithSeed;
    if(nextFormat==="roundrobin"){
      setRrRounds(scheduleRoundRobin(t,g,nextMode));
      setBracketData(null);
    } else if(nextFormat==="double"){
      setBracketData(generateDoubleElim(t,g,nextMode));
      setRrRounds([]);
    } else {
      setBracketData(generateElim(t,g,nextMode));
      setRrRounds([]);
    }
  };

  const updateNonMultiSettings=(updates)=>{
    if(updates.rrStandingsRules&&Object.keys(updates).every(key=>key==="rrStandingsRules")){
      if(!nonMultiMetricRulesLocked)setRrStandingsRules(normalizeStandingsRules(updates.rrStandingsRules));
      return;
    }
    if(nonMultiSettingsLocked)return;
    const nextFormat=updates.formatType||formatType;
    const nextMode=updates.matchMode||matchMode;
    const nextGames=nextMode==="wl"?1:(updates.gamesPerMatch||gamesPerMatch||3);
    if(updates.formatType)setFormatType(updates.formatType);
    if(updates.matchMode)setMatchMode(updates.matchMode);
    if(updates.gamesPerMatch)setGamesPerMatch(updates.gamesPerMatch);
    rebuildNonMultiBracket(nextFormat,nextMode,nextGames);
  };

  const updateStageConfigFromSettings=(idx,updated)=>{
    if(stageData[idx]){
      if(!stageDataComplete(stageData[idx])&&updated.standingsRules){
        updateMultiStages(prev=>prev.map((stage,i)=>i===idx?{...stage,standingsRules:normalizeStandingsRules(updated.standingsRules)}:stage));
      }
      return;
    }
    updateMultiStages(prev=>prev.map((stage,i)=>i===idx?{...updated,aat:stage.aat}:stage));
  };

  const startBracket=()=>{
    if(!canStartBracket)return;
    const projectId=currentProjectId||`project-${Date.now()}`;
    setCurrentProjectId(projectId);
    if(!projectName.trim())setProjectName(projectNameFromState({formatType,teams:teamsWithSeed}));
    setBracketTab("tournament");
    if(currentFolderId)setSavedFolders(prev=>prev.map(f=>f.id===currentFolderId?{...f,projectIds:[projectId,...(f.projectIds||[]).filter(id=>id!==projectId)],updatedAt:new Date().toISOString()}:f));
    setShowAwards(true);
    const t=teamsWithSeed;
    if(isMulti){
      const s0=stages[0];
      const totalAat=stages.slice(1).reduce((sum,stage)=>sum+(stage.aat||0),0);
      const aatTeamsByStage={};
      let cursor=0;
      for(let i=1;i<stages.length;i++){
        const count=stages[i].aat||0;
        aatTeamsByStage[i]=count>0?t.slice(cursor,cursor+count):[];
        cursor+=count;
      }
      const sg0Teams=t.slice(totalAat,totalAat+(s0.teamCount||t.length)); // non-AAT teams start in Stage 1
      // Re-seed stage 0 teams 1..N within their group
      const sg0Seeded=sg0Teams.map((tm,i)=>({...tm,seed:i+1}));
      const sd=buildStageData(s0,sg0Seeded,{aatTeamsByStage});
      setStageData({0:sd});setActiveStageIdx(0);
    } else if(isRR){setRrRounds(scheduleRoundRobin(t,effectiveGames,matchMode));}
    else if(isDE){setBracketData(generateDoubleElim(t,effectiveGames,matchMode));}
    else{setBracketData(generateElim(t,effectiveGames,matchMode));}
    setStep("bracket");
  };

  // Update match in any bracket structure
  const updateMatchInBracket=(matchId,updater)=>{
    if(isRR){setRrRounds(prev=>prev.map(round=>round.map(m=>m.id===matchId?updater(m):m)));return;}
    setBracketData(prev=>{
      if(!prev)return prev;
      const updateArr=arr=>arr.map(m=>m.id===matchId?updater(m):m);
      const updateRounds=rounds=>rounds.map(r=>updateArr(r));
      let next={...(prev.type==="double"?normalizeDoubleElimData(prev):prev)};
      if(next.winners)next.winners=updateRounds(next.winners);
      if(next.losers)next.losers=updateRounds(next.losers);
      if(next.grandFinal?.id===matchId)next.grandFinal=updater(next.grandFinal);
      if(next.grandFinalReset?.id===matchId)next.grandFinalReset=updater(next.grandFinalReset);
      // Propagate single elim winners (also clears stale results when a pick is undone)
      if(next.type==="single"&&next.winners){
        for(let rIdx=0;rIdx<next.winners.length-1;rIdx++){
          for(let mIdx=0;mIdx<next.winners[rIdx].length;mIdx++){
            const m=next.winners[rIdx][mIdx];
            const w=m._autoWinner||matchResult(m).winner||null;
            const nextIdx=Math.floor(mIdx/2);
            const slot=mIdx%2===0?"teamA":"teamB";
            if(next.winners[rIdx+1]?.[nextIdx]){
              const cur=next.winners[rIdx+1][nextIdx][slot];
              if(cur?.name!==(w?.name||null)){
                // Team changed — clear any results in this downstream match too
                next.winners[rIdx+1]=next.winners[rIdx+1].map((nm,ni)=>{
                  if(ni!==nextIdx)return nm;
                  const cleared={...nm,[slot]:w};
                  // If the team in this slot changed and there are games recorded, clear them
                  if(cur?.name!==w?.name) cleared.games=cleared.games.map(g=>({...g,winnerName:null,isTie:false,scoreA:"",scoreB:"",gameMvp:null,stats:{}}));
                  return cleared;
                });
              }
            }
          }
        }
      }
      return next;
    });
  };

  const updateMatchInStage=(stageIdx,matchId,updater)=>{
    setStageData(prev=>{
      const base=prev[stageIdx];
      let sd={...(base?.type==="double"?normalizeDoubleElimData(base):base)};
      if(sd.type==="roundrobin")sd.rounds=sd.rounds.map(r=>r.map(m=>m.id===matchId?updater(m):m));
      else if(sd.type==="groupstage")sd.groups=sd.groups.map(g=>({...g,rounds:g.rounds.map(r=>r.map(m=>m.id===matchId?updater(m):m))}));
      else{
        if(sd.winners)sd.winners=sd.winners.map(r=>r.map(m=>m.id===matchId?updater(m):m));
        if(sd.losers)sd.losers=sd.losers.map(r=>r.map(m=>m.id===matchId?updater(m):m));
        if(sd.qualificationTiebreaker?.rounds){
          sd.qualificationTiebreaker={...sd.qualificationTiebreaker,rounds:sd.qualificationTiebreaker.rounds.map(r=>r.map(m=>m.id===matchId?updater(m):m))};
        }
        if(sd.grandFinal?.id===matchId)sd.grandFinal=updater(sd.grandFinal);
        if(sd.grandFinalReset?.id===matchId)sd.grandFinalReset=updater(sd.grandFinalReset);
        // Propagate single elim (clears stale too)
        if(sd.type==="single"&&sd.winners){
          for(let rIdx=0;rIdx<sd.winners.length-1;rIdx++){
            for(let mIdx=0;mIdx<sd.winners[rIdx].length;mIdx++){
              const m=sd.winners[rIdx][mIdx];
              const w=m._autoWinner||matchResult(m).winner||null;
              const nextIdx=Math.floor(mIdx/2);
              const slot=mIdx%2===0?"teamA":"teamB";
              if(sd.winners[rIdx+1]?.[nextIdx]){
                const cur=sd.winners[rIdx+1][nextIdx][slot];
                if(cur?.name!==(w?.name||null)){
                  sd.winners[rIdx+1]=sd.winners[rIdx+1].map((nm,ni)=>{
                    if(ni!==nextIdx)return nm;
                    const cleared={...nm,[slot]:w};
                    if(cur?.name!==w?.name) cleared.games=cleared.games.map(g=>({...g,winnerName:null,isTie:false,scoreA:"",scoreB:"",gameMvp:null,stats:{}}));
                    return cleared;
                  });
                }
              }
            }
          }
        }
      }
      sd=syncStageQualificationData(sd,stages[stageIdx],stageIdx===stages.length-1);
      return {...prev,[stageIdx]:sd};
    });
  };

  const handleGameUpdate=(matchId,gi,upd)=>updateMatchInBracket(matchId,m=>({...m,games:m.games.map((g,i)=>i===gi?{...g,...upd}:g)}));
  const handleMatchUpdate=(matchId,upd)=>updateMatchInBracket(matchId,m=>({...m,...upd}));
  const handleStageGameUpdate=(stageIdx,matchId,gi,upd)=>updateMatchInStage(stageIdx,matchId,m=>({...m,games:m.games.map((g,i)=>i===gi?{...g,...upd}:g)}));
  const handleStageMatchUpdate=(stageIdx,matchId,upd)=>updateMatchInStage(stageIdx,matchId,m=>({...m,...upd}));
  const handleStageDataUpdate=(stageIdx,updater)=>setStageData(prev=>{
    const raw=typeof updater==="function"?updater(prev[stageIdx]):updater;
    return {...prev,[stageIdx]:syncStageQualificationData(raw,stages[stageIdx],stageIdx===stages.length-1)};
  });

  const handleAdvance=(fromStageIdx,advancing)=>{
    const nextIdx=fromStageIdx+1;
    const st=stages[nextIdx];
    if(!st)return;
    const fromStage=stages[fromStageIdx];
    const fromData=stageData[fromStageIdx];
    const tb=groupTiebreakInfo(fromData,fromStage);
    if(tb&&(fromStage.tiebreakMode||"performance")==="stage"){
      const candidates=tb.candidates.map(c=>c.row.team);
      const tiebreakFormat=fromStage.tiebreakStageFormat||"roundrobin";
      const tiebreakStage={format:tiebreakFormat,teamCount:candidates.length,aat:0,matchMode:fromStage.matchMode,gamesPerMatch:fromStage.gamesPerMatch,advance:tb.remainder,isTiebreak:true};
      const tiebreakData=buildStageData(tiebreakStage,candidates,{carryTeamsForNext:advancing});
      setStages(prev=>[...prev.slice(0,nextIdx),tiebreakStage,...prev.slice(nextIdx)]);
      setStageData(prev=>{
        const shifted={};
        Object.entries(prev).forEach(([key,val])=>{
          const n=Number(key);
          shifted[n>=nextIdx?n+1:n]=val;
        });
        shifted[nextIdx]=tiebreakData;
        if(shifted[0]?.aatTeamsByStage){
          const moved={};
          Object.entries(shifted[0].aatTeamsByStage).forEach(([key,val])=>{
            const n=Number(key);
            moved[n>=nextIdx?n+1:n]=val;
          });
          shifted[0]={...shifted[0],aatTeamsByStage:moved};
        }
        return shifted;
      });
      setActiveStageIdx(nextIdx);
      return;
    }
    const aatTeams=stageData[0]?.aatTeamsByStage?.[nextIdx]||(nextIdx===1?stageData[0]?.byeTeams||[]:[]);
    const carryTeams=stageData[fromStageIdx]?.carryTeamsForNext||[];
    const combined=[...aatTeams,...carryTeams,...advancing].map((tm,i)=>({...tm,seed:i+1}));
    const sd=buildStageData(st,combined);
    setStageData(prev=>({...prev,[nextIdx]:sd}));
    setActiveStageIdx(nextIdx);
  };

  const reconfigureGames=(newG)=>{
    const ng=matchMode==="wl"?1:newG;setGamesPerMatch(newG);
    const adj=m=>adjGames(m,ng);
    if(isRR)setRrRounds(p=>p.map(r=>r.map(adj)));
    else setBracketData(prev=>{if(!prev)return prev;const next={...(prev.type==="double"?normalizeDoubleElimData(prev):prev)};
      if(next.winners)next.winners=next.winners.map(r=>r.map(adj));
      if(next.losers)next.losers=next.losers.map(r=>r.map(adj));
      if(next.grandFinal)next.grandFinal=adj(next.grandFinal);
      if(next.grandFinalReset)next.grandFinalReset=adj(next.grandFinalReset);
      return next;
    });
  };

  const reset=()=>{if(typeof window!=="undefined")window.localStorage.removeItem(STORAGE_KEY);setCurrentProjectId(null);setLastSavedAt(null);setSaveError(false);setStep("setup");setFormatType(null);setTeams([]);setDeletedTeams([]);setTeamInput("");setBracketData(null);setRrRounds([]);setTeamCount(8);setGamesPerMatch(1);setMatchMode("wl");setRrStandingsRules(DEFAULT_STANDINGS_RULES);setStatCols(["Score"]);setStages(DEFAULT_STAGES);setStageData({});setActiveStageIdx(0);setShowPlayers(false);setAwards(DEFAULT_AWARDS);setShowAwards(false);setQualificationLinks([]);setProjectName("");setBracketTab("tournament");};

  const allBracketTeams=isRR?teamsWithSeed:(bracketData?teamsWithSeed:[]);
  const allBracketMatches=playableMatches(isRR?rrRounds.flat():bracketData?dataMatches(bracketData):[]);
  const saveStatusText=saveError?"Save failed":supabaseConfigured?cloudMessage:lastSavedAt?`Saved ${lastSavedAt}`:"Local autosave";
  const authHint=supabaseConfigured
    ?"Projects sync online with Supabase after you log in."
    :"Local browser mode. Add Supabase env vars in Vercel for real online accounts.";

  const renderSettingsTab=()=>(
    <div>
      {!isMulti&&(
        <div style={{padding:"14px 16px",borderRadius:10,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-secondary)"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,flexWrap:"wrap"}}>
            <div style={{fontSize:12,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--color-text-primary)"}}>Tournament Settings</div>
            {nonMultiSettingsLocked&&<span style={{fontSize:11,color:!nonMultiMetricRulesLocked&&formatType==="roundrobin"?"#b8921a":"#e63946",marginLeft:"auto"}}>{!nonMultiMetricRulesLocked&&formatType==="roundrobin"?"Started - metrics editable":"Started - read only"}</span>}
          </div>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:10}}>Format</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
            {[["single","Single Elim"],["double","Double Elim"],["roundrobin","Round Robin"]].map(([id,label])=>(
              <button key={id} onClick={()=>updateNonMultiSettings({formatType:id})} disabled={nonMultiSettingsLocked} style={{...btn(formatType===id),padding:"6px 12px",opacity:nonMultiSettingsLocked?0.45:1,cursor:nonMultiSettingsLocked?"not-allowed":"pointer"}}>{label}</button>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}>
            <Stepper label="Teams" value={teamCount} min={teamCount} max={teamCount} onChange={()=>{}} disabled/>
            <span style={{fontSize:11,color:"var(--color-text-tertiary)"}}>Participant count is locked after bracket generation.</span>
            {formatType==="roundrobin"&&<span style={{fontSize:11,color:"var(--color-text-tertiary)"}}>{rrTotalRounds} rounds total</span>}
          </div>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:10}}>Match Format</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
            {[["wl","Win / Lose"],["games","Game Wins"],["score","Score"]].map(([id,label])=>(
              <button key={id} onClick={()=>updateNonMultiSettings({matchMode:id,gamesPerMatch:id==="wl"?1:(gamesPerMatch||3)})} disabled={nonMultiSettingsLocked} style={{...btn(matchMode===id),padding:"6px 12px",opacity:nonMultiSettingsLocked?0.45:1,cursor:nonMultiSettingsLocked?"not-allowed":"pointer"}}>{label}</button>
            ))}
            {matchMode!=="wl"&&<Stepper label="Games" value={gamesPerMatch||3} min={1} max={11} onChange={v=>updateNonMultiSettings({gamesPerMatch:v})} small disabled={nonMultiSettingsLocked}/>}
          </div>
          {formatType==="roundrobin"&&<StandingsRulesEditor rules={rrStandingsRules} onChange={rules=>updateNonMultiSettings({rrStandingsRules:rules})} disabled={nonMultiMetricRulesLocked}/>}
        </div>
      )}
      {isMulti&&(
        <div>
          <div style={{padding:"12px 14px",borderRadius:10,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-secondary)",marginBottom:14,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <Stepper label="Total teams" value={teamCount} min={teamCount} max={teamCount} onChange={()=>{}} disabled/>
            <span style={{fontSize:11,color:"var(--color-text-tertiary)"}}>Total participants and AAT counts are locked on the tournament page.</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {stages.map((stage,idx)=>{
              const computedTC=idx===0?(stage.teamCount||teamCount):(stages[idx-1]?.advance||2)+(stage.aat||0);
              const displayStage={...stage,teamCount:computedTC};
              const started=!!stageData[idx];
              const done=stageQualificationStatus(stageData[idx],stage,idx===stages.length-1).ready;
              return(
                <div key={idx}>
                  <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:done?"#e63946":started?"#b8921a":"#2a9d8f",margin:"0 0 5px 2px"}}>{done?"Done - read only":started?"Started - metrics editable":"Not started - editable"}</div>
                  <StageConfig
                    stage={displayStage}
                    idx={idx}
                    totalTeams={teamCount}
                    isLast={idx===stages.length-1}
                    locked={started}
                    lockAat={idx>0}
                    metricRulesLocked={done}
                    onChange={updated=>updateStageConfigFromSettings(idx,updated)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  const renderParticipantsTab=()=>(
    <div style={{padding:"14px 16px",borderRadius:10,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-secondary)"}}>
      <div style={{fontSize:12,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--color-text-primary)",marginBottom:12}}>Participants</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
        {teamsWithSeed.map(team=>{
          const locked=!!team._qualificationLinkId;
          return(
            <div key={`${team.seed}-${team.name}`} style={{display:"grid",gridTemplateColumns:"42px minmax(0,1fr)",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:8,border:"0.5px solid var(--color-border-tertiary)",background:"var(--color-background-primary)"}}>
              <span style={{fontSize:12,fontWeight:800,color:"var(--color-text-tertiary)",textAlign:"right"}}>#{team.seed}</span>
              <div>
                <ParticipantNameInput team={team} disabled={locked} onCommit={name=>renameParticipant(team.seed,name)}/>
                {locked&&<div style={{fontSize:10,color:"var(--color-text-tertiary)",marginTop:3}}>Linked qualifier name</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return(
    <div style={{fontFamily:"'Barlow Condensed',sans-serif",padding:"0 0 40px"}}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,400;0,600;0,700;0,800;1,400&family=Barlow:wght@400;500&display=swap" rel="stylesheet"/>
      <style>{`
        .match-team-name {
          display: block;
          min-width: 0;
          overflow: hidden;
          white-space: nowrap;
        }
        .match-team-name__text {
          display: block;
          width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          transform: translateX(0);
        }
        .match-card:hover .match-team-name.is-overflowing {
          -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 10px, #000 calc(100% - 10px), transparent 100%);
          mask-image: linear-gradient(90deg, transparent 0, #000 10px, #000 calc(100% - 10px), transparent 100%);
        }
        .match-card:hover .match-team-name.is-overflowing .match-team-name__text {
          width: max-content;
          overflow: visible;
          text-overflow: clip;
          animation: match-team-name-pan var(--pan-duration) ease-in-out 0.25s infinite;
        }
        @keyframes match-team-name-pan {
          0%, 12% { transform: translateX(0); }
          46%, 58% { transform: translateX(var(--pan-distance)); }
          92%, 100% { transform: translateX(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .match-card:hover .match-team-name.is-overflowing .match-team-name__text { animation: none; }
        }
      `}</style>

      {/* Header */}
      <div style={{marginBottom:24,borderBottom:"2px solid var(--color-border-tertiary)",paddingBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <img src="/tourney-logo.png" alt="" aria-hidden="true" style={{width:64,height:46,objectFit:"contain",flexShrink:0}}/>
          <div>
            <h1 onClick={goHome} title="Go to main page" style={{margin:0,fontSize:28,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase",color:"var(--color-text-primary)",lineHeight:1,cursor:"pointer"}}>Tournament <span style={{color:"#e9c46a"}}>Bracket</span></h1>
            <p style={{margin:"4px 0 0",fontSize:13,color:"var(--color-text-tertiary)",fontFamily:"'Barlow',sans-serif"}}>
              {step==="setup"&&"Choose your format and match settings"}
              {step==="teams"&&`Seed your teams · ${teamsWithSeed.length}/${isMulti?stages[0].teamCount:teamCount} added`}
              {step==="bracket"&&!isMulti&&`${formatType==="single"?"Single Elim":formatType==="double"?"Double Elim":"Round Robin"} · ${teamsWithSeed.length} teams · ${matchMode==="wl"?"Win/Lose":matchMode==="games"?`Best of ${gamesPerMatch}`:`Score`}`}
              {step==="bracket"&&isMulti&&`Multi-Stage · ${stages.length} stages · ${teamsWithSeed.length} teams`}
            </p>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          {currentProjectId&&savedProjects.find(p=>p.id===currentProjectId)&&<button onClick={()=>exportProject(savedProjects.find(p=>p.id===currentProjectId))} style={{...btn(false),padding:"5px 10px"}}>Download .tourney.json</button>}
          {currentProjectId&&savedProjects.find(p=>p.id===currentProjectId)&&<button onClick={()=>shareProject(savedProjects.find(p=>p.id===currentProjectId))} style={{...btn(false),padding:"5px 10px",borderColor:"rgba(233,196,106,0.55)",color:"#b8860b"}}>Share link</button>}
          {currentUser
            ?<button onClick={logout} title={currentUser.email} style={{...btn(false),padding:"5px 10px"}}>{currentUser.name} · Log out</button>
            :<button onClick={()=>setAuthOpen(v=>!v)} style={{...btn(false),padding:"5px 10px",borderColor:"rgba(42,157,143,0.45)",color:"#2a9d8f"}}>Log in / Sign up</button>}
          <span style={{fontSize:11,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",fontFamily:"'Barlow Condensed',sans-serif",color:saveError?"#e63946":currentUser?.supabase?"#2a9d8f":lastSavedAt?"#2a9d8f":"var(--color-text-tertiary)",background:"var(--color-background-secondary)",border:"1px solid var(--color-border-tertiary)",borderRadius:6,padding:"5px 10px"}}>
            {saveStatusText}
          </span>
        </div>
      </div>

      {(authOpen||shareMessage||sharedProject)&&(
        <div style={{padding:"12px 14px",border:"1px solid var(--color-border-tertiary)",borderRadius:10,background:"var(--color-background-secondary)",marginBottom:18,fontFamily:"'Barlow',sans-serif"}}>
          {authOpen&&!currentUser&&(
            <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) auto",gap:8,alignItems:"center"}}>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>{setAuthMode("login");setAuthError("");}} style={{...btn(authMode==="login"),padding:"7px 11px"}}>Log in</button>
                <button onClick={()=>{setAuthMode("signup");setAuthError("");}} style={{...btn(authMode==="signup"),padding:"7px 11px"}}>Sign up</button>
              </div>
              {authMode==="signup"&&<input value={authName} onChange={e=>setAuthName(e.target.value)} placeholder="Name" style={{padding:"7px 9px",borderRadius:7,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-primary)"}}/>}
              <input value={authEmail} onChange={e=>setAuthEmail(e.target.value)} placeholder="Email" type="email" style={{padding:"7px 9px",borderRadius:7,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-primary)"}}/>
              <input value={authPassword} onChange={e=>setAuthPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAuth()} placeholder="Password" type="password" style={{padding:"7px 9px",borderRadius:7,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-primary)"}}/>
              <button onClick={handleAuth} style={{...btn(false),padding:"7px 12px",background:"#2a9d8f",color:"white",borderColor:"#2a9d8f"}}>{authMode==="signup"?"Create account":"Log in"}</button>
              <div style={{gridColumn:"1 / -1",fontSize:11,color:authError?"#e63946":"var(--color-text-tertiary)"}}>{authError||authHint}</div>
            </div>
          )}
          {(shareMessage||sharedProject)&&(
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginTop:authOpen&&!currentUser?10:0,flexWrap:"wrap"}}>
              <span style={{fontSize:12,color:shareMessage.includes("could not")?"#e63946":"var(--color-text-secondary)"}}>{shareMessage}</span>
              {sharedProject&&<div style={{display:"flex",gap:8}}><button onClick={()=>loadProject(sharedProject)} style={{...btn(false),padding:"7px 11px"}}>Preview</button><button onClick={saveSharedProject} style={{...btn(false),padding:"7px 11px",background:"#e9c46a",borderColor:"#e9c46a",color:"#2b2118"}}>Save to my projects</button></div>}
            </div>
          )}
        </div>
      )}

      {/* ── STEP 1: Setup ────────────────────────────────────────────── */}
      {step==="setup"&&(
        <div>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:10}}>Tournament Files & Folders</div>
          <div style={{padding:"12px 14px",border:"1px solid var(--color-border-tertiary)",borderRadius:10,background:"var(--color-background-secondary)",marginBottom:22}}>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <select value={currentFolderId||""} onChange={e=>setCurrentFolderId(e.target.value||null)} style={{minWidth:180,padding:"7px 9px",borderRadius:7,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-primary)",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700}}>
                <option value="">Standalone tournaments</option>
                {savedFolders.map(folder=><option key={folder.id} value={folder.id}>{folder.name} ({(folder.projectIds||[]).length})</option>)}
              </select>
              <input value={folderNameInput} onChange={e=>setFolderNameInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&createFolder()} placeholder="New folder name…" style={{minWidth:150,padding:"7px 9px",borderRadius:7,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-primary)",fontFamily:"'Barlow Condensed',sans-serif"}}/>
              <button onClick={createFolder} disabled={!folderNameInput.trim()} style={{...btn(false),padding:"7px 11px",opacity:folderNameInput.trim()?1:0.45}}>+ Folder</button>
              {currentFolder&&<button onClick={()=>exportFolder(currentFolder)} style={{...btn(false),padding:"7px 11px",borderColor:"rgba(42,157,143,0.45)",color:"#2a9d8f"}}>Download folder ZIP</button>}
              <button onClick={()=>tournamentImportRef.current?.click()} style={{...btn(false),padding:"7px 11px"}}>Upload tournament</button>
              <button onClick={()=>folderImportRef.current?.click()} style={{...btn(false),padding:"7px 11px"}}>Upload folder ZIP</button>
              <input ref={tournamentImportRef} type="file" accept=".json,.tourney.json,application/json" onChange={e=>importTournamentFile(e.target.files?.[0])} style={{display:"none"}}/>
              <input ref={folderImportRef} type="file" accept=".zip,.tourney-folder.zip,application/zip" onChange={e=>importFolderFile(e.target.files?.[0])} style={{display:"none"}}/>
            </div>
            <div style={{fontSize:11,color:"var(--color-text-tertiary)",marginTop:7,fontFamily:"'Barlow',sans-serif"}}>{currentFolder?`New and imported tournaments will be stored in “${currentFolder.name}”.`:`Standalone mode. Select or create a folder to link qualifiers.`}</div>
          </div>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:12}}>Format</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:20}}>
            {[["single","Single Elimination","Seeded, one loss out"],["double","Double Elimination","Two chances, seeded"],["roundrobin","Round Robin","Everyone plays everyone"],["multi","Multi-Stage","Chain multiple formats"]].map(([id,label,sub])=>(
              <div key={id} onClick={()=>setFormatType(id)} style={{border:formatType===id?"2px solid #e9c46a":"1.5px solid var(--color-border-tertiary)",borderRadius:10,padding:"14px 20px",cursor:"pointer",minWidth:150,background:formatType===id?"rgba(233,196,106,0.07)":"var(--color-background-primary)",transition:"border-color 0.15s"}}>
                <div style={{fontSize:14,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em",color:"var(--color-text-primary)"}}>{label}</div>
                <div style={{fontSize:11,color:"var(--color-text-tertiary)",marginTop:3}}>{sub}</div>
              </div>
            ))}
          </div>

          {visibleProjects.length>0&&(
            <div style={{marginBottom:22}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:10}}>Previous Projects</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
                {visibleProjects.map(project=>(
                  <div key={project.id} onClick={()=>loadProject(project)} style={{position:"relative",textAlign:"left",padding:"12px 38px 34px 14px",minHeight:116,borderRadius:8,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",boxSizing:"border-box"}}>
                    <button onClick={e=>{e.stopPropagation();deleteProject(project);}} title="Delete project" style={{position:"absolute",top:8,right:8,width:22,height:22,borderRadius:5,border:"0.5px solid var(--color-border-tertiary)",background:"var(--color-background-secondary)",color:"var(--color-text-tertiary)",cursor:"pointer",fontSize:14,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
                    <button onClick={e=>{e.stopPropagation();exportProject(project);}} title="Download tournament file" style={{position:"absolute",top:36,right:8,width:22,height:22,borderRadius:5,border:"0.5px solid var(--color-border-tertiary)",background:"var(--color-background-secondary)",color:"var(--color-text-tertiary)",cursor:"pointer",fontSize:12,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>↓</button>
                    <button onClick={e=>{e.stopPropagation();shareProject(project);}} title="Copy share link" style={{position:"absolute",top:64,right:8,width:22,height:22,borderRadius:5,border:"0.5px solid rgba(233,196,106,0.55)",background:"var(--color-background-secondary)",color:"#b8860b",cursor:"pointer",fontSize:12,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>↗</button>
                    <button onClick={e=>{e.stopPropagation();renameSavedProject(project);}} title="Rename tournament" style={{position:"absolute",top:92,right:8,width:22,height:22,borderRadius:5,border:"0.5px solid rgba(69,123,157,0.55)",background:"var(--color-background-secondary)",color:"#457b9d",cursor:"pointer",fontSize:12,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>✎</button>
                    <div style={{fontSize:14,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase",color:"var(--color-text-primary)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{project.name}</div>
                    <div style={{fontSize:11,color:"var(--color-text-tertiary)",marginTop:3,textTransform:"uppercase",letterSpacing:"0.04em"}}>
                      {project.formatType==="single"?"Single Elim":project.formatType==="double"?"Double Elim":project.formatType==="roundrobin"?"Round Robin":"Multi-Stage"} · {project.teamCount} teams
                    </div>
                    <div style={{fontSize:11,color:"#2a9d8f",marginTop:6,fontWeight:700}}>Open bracket →</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {formatType&&!isMulti&&(<>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:12}}>Participants</div>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,padding:"14px 18px",background:"var(--color-background-secondary)",borderRadius:10,border:"0.5px solid var(--color-border-tertiary)",flexWrap:"wrap"}}>
              <Stepper label="Teams" value={teamCount} min={3} max={64} onChange={setTeamCount}/>
              {(formatType==="single"||formatType==="double")&&(()=>{let sz=1;while(sz<teamCount)sz*=2;const b=sz-teamCount;return b>0?<span style={{fontSize:12,color:"var(--color-text-tertiary)"}}>Bracket: {sz} · {b} bye{b!==1?"s":""} (top seeds)</span>:null;})()}
              {formatType==="roundrobin"&&<><div style={{width:1,height:28,background:"var(--color-border-tertiary)"}}/><span style={{fontSize:12,color:"var(--color-text-tertiary)"}}>{rrTotalRounds} rounds total</span></>}
            </div>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:12}}>Match Format</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
              {[["wl","Win / Lose","One result"],["games","Game Wins","Best-of-N"],["score","Score","Numeric per game"]].map(([id,label,sub])=>(
                <div key={id} onClick={()=>setMatchMode(id)} style={{border:matchMode===id?"2px solid #e9c46a":"1.5px solid var(--color-border-tertiary)",borderRadius:10,padding:"12px 16px",cursor:"pointer",minWidth:130,background:matchMode===id?"rgba(233,196,106,0.07)":"var(--color-background-primary)",transition:"border-color 0.15s"}}>
                  <div style={{fontSize:13,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em",color:"var(--color-text-primary)"}}>{label}</div>
                  <div style={{fontSize:11,color:"var(--color-text-tertiary)",marginTop:2}}>{sub}</div>
                </div>
              ))}
            </div>
            {formatType==="roundrobin"&&<StandingsRulesEditor rules={rrStandingsRules} onChange={setRrStandingsRules}/>}
            {matchMode!=="wl"&&<div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16,padding:"12px 16px",background:"var(--color-background-secondary)",borderRadius:10,border:"0.5px solid var(--color-border-tertiary)",flexWrap:"wrap"}}><Stepper label="Games per match" value={gamesPerMatch} min={1} max={11} onChange={setGamesPerMatch}/><span style={{fontSize:12,color:"var(--color-text-tertiary)"}}>Best of {gamesPerMatch} · need {Math.ceil(gamesPerMatch/2)} to win</span></div>}
            <button onClick={()=>setStep("teams")} style={{padding:"10px 28px",borderRadius:8,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:15,letterSpacing:"0.07em",textTransform:"uppercase",background:"#e9c46a",color:"#2c2c00",border:"none",cursor:"pointer",marginTop:8}}>Continue →</button>
          </>)}

          {formatType==="multi"&&(()=>{
            const totalAat=stages.slice(1).reduce((sum,stage)=>sum+(stage.aat||0),0);
            const requiredTeams=requiredMultiTeams(stages);
            return(<>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:8}}>Total Teams</div>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18,padding:"12px 16px",background:"var(--color-background-secondary)",borderRadius:10,border:"0.5px solid var(--color-border-tertiary)",flexWrap:"wrap"}}>
              <Stepper label="Total teams" value={teamCount} min={3} max={64} onChange={v=>{
                const nextTotal=Math.max(v,totalAat+2);
                setTeamCount(nextTotal);
                updateMultiStages(p=>p.map((s,i)=>i===0?{...s,teamCount:Math.max(2,nextTotal-totalAat),advance:Math.min(s.advance||Math.floor((nextTotal-totalAat)/2),Math.max(1,nextTotal-totalAat-1))}:s));
              }}/>
              <div style={{fontSize:12,color:"var(--color-text-tertiary)",fontFamily:"'Barlow Condensed',sans-serif"}}>
                <span><strong style={{color:"#e9c46a"}}>{stages[0]?.teamCount||0}</strong> start Stage 1 · <strong style={{color:"#2a9d8f"}}>{totalAat}</strong> total AAT · minimum needed: <strong>{requiredTeams}</strong></span>
              </div>
            </div>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:12}}>Stages ({stages.length})</div>
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
              {stages.map((stage,idx)=>{
                // Compute effective teamCount for each stage
                const computedTC=idx===0
                  ?(stage.teamCount||teamCount)
                  :(stages[idx-1]?.advance||2)+(stage.aat||0);
                const displayStage={...stage,teamCount:computedTC};
                const isLast=idx===stages.length-1;
                return(
                  <div key={idx} style={{position:"relative"}}>
                    <StageConfig
                      stage={displayStage}
                      idx={idx}
                      totalTeams={teamCount}
                      isLast={isLast}
                      onChange={updated=>{
                        updateMultiStages(p=>{
                          const next=p.map((s,i)=>i===idx?updated:s);
                          // cascade teamCounts downward
                          for(let k=1;k<next.length;k++){
                            next[k]={...next[k],teamCount:(next[k-1].advance||2)+(next[k].aat||0)};
                          }
                          return next;
                        });
                      }}
                    />
                    {stages.length>1&&<button onClick={()=>updateMultiStages(p=>p.filter((_,i)=>i!==idx))} style={{position:"absolute",top:8,right:8,width:20,height:20,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:"var(--color-text-tertiary)",background:"var(--color-background-primary)",border:"0.5px solid var(--color-border-tertiary)",borderRadius:4,cursor:"pointer",fontWeight:700,zIndex:1}}>×</button>}
                  </div>
                );
              })}
              {stages.length<6&&<button onClick={()=>{
                const lastAdv=stages[stages.length-1]?.advance||2;
                updateMultiStages(p=>[...p,{format:"roundrobin",teamCount:lastAdv,aat:0,matchMode:"wl",gamesPerMatch:1,advance:Math.max(1,Math.floor(lastAdv/2))}]);
              }} style={{padding:"8px 16px",borderRadius:8,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:13,textTransform:"uppercase",letterSpacing:"0.05em",background:"var(--color-background-secondary)",color:"var(--color-text-secondary)",border:"1px dashed var(--color-border-tertiary)",cursor:"pointer"}}>+ Add Stage</button>}
            </div>
            <button onClick={()=>setStep("teams")} style={{padding:"10px 28px",borderRadius:8,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:15,letterSpacing:"0.07em",textTransform:"uppercase",background:"#e9c46a",color:"#2c2c00",border:"none",cursor:"pointer",marginTop:8}}>Continue →</button>
          </>);})()}
        </div>
      )}

      {/* ── STEP 2: Teams ─────────────────────────────────────────────── */}
      {step==="teams"&&(
        <div>
          <div style={{fontSize:11,color:"var(--color-text-tertiary)",marginBottom:14,fontFamily:"'Barlow',sans-serif"}}>
            Teams are <strong>seeded by order</strong>. Drag to reorder. Click <strong>▼ Edit</strong> for region & roster.
            {isMulti&&(()=>{
              const totalAat=stages.slice(1).reduce((sum,stage)=>sum+(stage.aat||0),0);
              return totalAat>0
                ?<span> Top <strong style={{color:"#2a9d8f"}}>{totalAat}</strong> seeds are reserved as AAT across later stages. Next <strong style={{color:"#e9c46a"}}>{stages[0]?.teamCount}</strong> teams start Stage 1.</span>
                :<span> All <strong>{teamCount}</strong> teams start Stage 1.</span>;
            })()}
            {!isMulti&&(formatType==="single"||formatType==="double")&&(()=>{let sz=1;while(sz<teamCount)sz*=2;const b=sz-teamCount;return b>0?<span> Top <strong>{b}</strong> seed{b>1?"s":""} get a bye.</span>:null;})()}
          </div>
          {currentFolder&&(
            <div style={{padding:"12px 14px",borderRadius:10,border:"1px solid rgba(69,123,157,0.35)",background:"rgba(69,123,157,0.06)",marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:"#457b9d",marginBottom:7}}>Qualifier-linked seeds</div>
              <div style={{display:"flex",gap:7,flexWrap:"wrap",alignItems:"center"}}>
                <select value={qualifierSourceId} onChange={e=>setQualifierSourceId(e.target.value)} style={{padding:"6px 8px",borderRadius:6,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-primary)",fontFamily:"'Barlow Condensed',sans-serif"}}>
                  <option value="">Source tournament…</option>
                  {availableQualifierProjects.map(project=><option key={project.id} value={project.id}>{project.name}{tournamentIsComplete(project.state)?" · complete":" · unfinished"}</option>)}
                </select>
                <label style={{fontSize:11,color:"var(--color-text-secondary)"}}>Place <input type="number" min="1" value={qualifierPlacement} onChange={e=>setQualifierPlacement(e.target.value)} style={{width:44,marginLeft:4,padding:"5px",borderRadius:5,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-primary)"}}/></label>
                <span style={{color:"var(--color-text-tertiary)"}}>→</span>
                <label style={{fontSize:11,color:"var(--color-text-secondary)"}}>Seed <input type="number" min="1" max={teamCount} value={qualifierSeed} onChange={e=>setQualifierSeed(e.target.value)} style={{width:44,marginLeft:4,padding:"5px",borderRadius:5,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-primary)"}}/></label>
                <button onClick={addQualificationLink} disabled={!qualifierSourceId} style={{...btn(false),padding:"6px 11px",opacity:qualifierSourceId?1:0.45}}>Link seed</button>
              </div>
              {qualificationLinks.length>0&&<div style={{display:"flex",flexDirection:"column",gap:6,marginTop:10}}>{qualificationLinks.map(link=>{const resolved=resolveQualificationLink(link,savedProjects);return <div key={link.id} style={{display:"grid",gridTemplateColumns:"54px minmax(0,1fr) auto",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:6,background:"var(--color-background-primary)",border:"0.5px solid var(--color-border-tertiary)",fontSize:11}}><strong>Seed {link.seed}</strong><span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{resolved.source?.name||"Missing source"} · Place {link.placement} → <strong style={{color:resolved.team?"#2a9d8f":"#e63946"}}>{resolved.team?.name||"Locked until qualifier completes"}</strong></span><button onClick={()=>setQualificationLinks(prev=>prev.filter(x=>x.id!==link.id))} style={{border:"none",background:"none",color:"var(--color-text-tertiary)",cursor:"pointer",fontSize:15}}>×</button></div>;})}</div>}
            </div>
          )}
          <BulkTeamAdder onAdd={bulkAddTeams} maxAdd={Math.max(0,manualTeamCapacity-teams.length)}/>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <input value={teamInput} onChange={e=>setTeamInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&teams.length<manualTeamCapacity)addTeam();}} placeholder={`Manual team (${teams.length}/${manualTeamCapacity})`} style={{flex:1,fontFamily:"'Barlow Condensed',sans-serif",fontSize:15,fontWeight:600,padding:"8px 12px",borderRadius:8,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-primary)"}}/>
            <button onClick={()=>addTeam()} disabled={!teamInput.trim()||teams.length>=manualTeamCapacity} style={{padding:"0 16px",borderRadius:8,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:15,textTransform:"uppercase",background:"#e9c46a",color:"#2c2c00",border:"none",cursor:teamInput.trim()&&teams.length<manualTeamCapacity?"pointer":"not-allowed",opacity:!teamInput.trim()||teams.length>=manualTeamCapacity?0.5:1}}>+ Add</button>
          </div>
          <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
            {AUTOFILL_POOLS.map(([label,names])=>(
              <button key={label} onClick={()=>{setTeams(names.slice(0,manualTeamCapacity).map((n,i)=>({name:n,color:palette[i%palette.length],region:"",players:[]})));setDeletedTeams([]);}} style={{fontSize:11,padding:"4px 10px",borderRadius:5,cursor:"pointer",border:"0.5px solid var(--color-border-tertiary)",background:"var(--color-background-secondary)",color:"var(--color-text-secondary)",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase"}}>{label} ({Math.min(names.length,manualTeamCapacity)})</button>
            ))}
          </div>
          {teams.length>0&&<div style={{marginBottom:16}}><SeededTeamList teams={teams} onReorder={setTeams} onRemove={removeTeam} onTeamChange={updateTeam} allRegions={allRegions}/></div>}
          {teamsWithSeed.length<teamCount&&(
            <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:14}}>
              <span style={{fontSize:12,color:"var(--color-text-tertiary)",fontStyle:"italic"}}>{teamCount-teamsWithSeed.length} participant slot{teamCount-teamsWithSeed.length===1?"":"s"} remaining</span>
            </div>
          )}
          {deletedTeams.length>0&&(
            <div style={{marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:8}}>Removed — click to re-add</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {deletedTeams.map(t=>(
                  <div key={t.name} onClick={()=>teams.length<manualTeamCapacity&&addTeam(t)} style={{display:"inline-flex",alignItems:"center",gap:6,background:"var(--color-background-secondary)",border:"1px dashed var(--color-border-secondary)",borderRadius:6,padding:"4px 8px",fontSize:13,fontWeight:600,fontFamily:"'Barlow Condensed',sans-serif",cursor:teams.length<manualTeamCapacity?"pointer":"not-allowed",opacity:teams.length>=manualTeamCapacity?0.4:0.7}}>
                    <span style={{width:10,height:10,borderRadius:2,background:t.color,flexShrink:0}}/><span style={{color:"var(--color-text-secondary)"}}>{t.name}</span><span style={{fontSize:12,color:"var(--color-text-tertiary)"}}>↩</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <button onClick={()=>setStep("setup")} style={{padding:"9px 18px",borderRadius:8,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:14,letterSpacing:"0.05em",textTransform:"uppercase",background:"var(--color-background-secondary)",color:"var(--color-text-secondary)",border:"0.5px solid var(--color-border-tertiary)",cursor:"pointer"}}>← Back</button>
            <button onClick={startBracket} disabled={!canStartBracket} title={unresolvedQualificationLinks.length?"Complete every linked qualifier first":""} style={{padding:"9px 28px",borderRadius:8,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:15,letterSpacing:"0.07em",textTransform:"uppercase",background:canStartBracket?"#e9c46a":"var(--color-background-secondary)",color:canStartBracket?"#2c2c00":"var(--color-text-tertiary)",border:"none",cursor:canStartBracket?"pointer":"not-allowed"}}>Generate Bracket →</button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Bracket ───────────────────────────────────────────── */}
      {step==="bracket"&&(
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
            <input value={currentTournamentName} onChange={e=>setProjectName(e.target.value)} onBlur={()=>{if(!projectName.trim())setProjectName(projectNameFromState({formatType,teams:teamsWithSeed}));}} style={{flex:"1 1 260px",minWidth:0,fontFamily:"'Barlow Condensed',sans-serif",fontSize:22,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase",padding:"8px 10px",borderRadius:8,border:"1px solid var(--color-border-tertiary)",background:"var(--color-background-primary)",color:"var(--color-text-primary)"}}/>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {[["tournament","Tournament"],["settings","Setting"],["participants","Participant"]].map(([id,label])=>(
                <button key={id} onClick={()=>setBracketTab(id)} style={{...btn(bracketTab===id),padding:"7px 13px",fontSize:12}}>{label}</button>
              ))}
            </div>
          </div>
          {bracketTab==="tournament"&&(
            <>
          {!isMulti&&(
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,padding:"10px 14px",background:"var(--color-background-secondary)",borderRadius:8,border:"0.5px solid var(--color-border-tertiary)",flexWrap:"wrap"}}>
              <span style={{padding:"3px 10px",borderRadius:5,background:"rgba(233,196,106,0.12)",border:"1px solid rgba(233,196,106,0.3)",fontSize:12,fontWeight:700,color:"#b8921a",fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:"0.05em"}}>{matchMode==="wl"?"Win/Lose":matchMode==="games"?"Game Wins":"Score"}{matchMode!=="wl"&&` · Bo${effectiveGames}`}</span>
              {matchMode!=="wl"&&<><Stepper value={gamesPerMatch} min={1} max={11} onChange={reconfigureGames} small/><span style={{fontSize:11,color:"var(--color-text-tertiary)"}}>games</span></>}
              <button onClick={()=>setShowPlayers(p=>!p)} style={{...btn(showPlayers),padding:"4px 10px",fontSize:11}}>{showPlayers?"🏆 Teams":"👤 Players"}</button>
              <button onClick={()=>setShowAwards(p=>!p)} style={{...btn(showAwards),padding:"4px 10px",fontSize:11,borderColor:showAwards?"#e9c46a":"rgba(233,196,106,0.3)",color:showAwards?"#e9c46a":"rgba(233,196,106,0.7)"}}>⭐ MVP Awards</button>
              <div style={{marginLeft:"auto"}}><StatColsEditor statCols={statCols} onChange={setStatCols}/></div>
            </div>
          )}
          {isMulti&&(
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,padding:"10px 14px",background:"var(--color-background-secondary)",borderRadius:8,border:"0.5px solid var(--color-border-tertiary)",flexWrap:"wrap"}}>
              <span style={{fontSize:11,color:"var(--color-text-tertiary)",fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:"0.05em",textTransform:"uppercase"}}>Multi-Stage · {teams.length} teams</span>
              <button onClick={()=>setShowAwards(p=>!p)} style={{...btn(showAwards),padding:"4px 10px",fontSize:11,borderColor:showAwards?"#e9c46a":"rgba(233,196,106,0.3)",color:showAwards?"#e9c46a":"rgba(233,196,106,0.7)"}}>⭐ MVP Awards</button>
              <div style={{marginLeft:"auto"}}><StatColsEditor statCols={statCols} onChange={setStatCols}/></div>
            </div>
          )}

          {isMulti&&<MultiStageView stages={stages} stageData={stageData} teams={teamsWithSeed} statCols={statCols} onGameUpdate={handleStageGameUpdate} onMatchUpdate={handleStageMatchUpdate} onStageUpdate={handleStageDataUpdate} onAdvance={handleAdvance} activeStageIdx={activeStageIdx} setActiveStageIdx={setActiveStageIdx}/>}

          {!isMulti&&isRR&&<RoundRobinView rrRounds={rrRounds} teams={teamsWithSeed} onGameUpdate={handleGameUpdate} onMatchUpdate={handleMatchUpdate} onAddTiebreakRound={round=>setRrRounds(prev=>[...prev,round])} matchMode={matchMode} statCols={statCols} standingsRules={rrStandingsRules}/>}

          {!isMulti&&!isRR&&bracketData&&(isDE
            ?<DoubleElimView bracketData={bracketData} onGameUpdate={handleGameUpdate} onMatchUpdate={handleMatchUpdate} statCols={statCols}/>
            :<SingleElimView bracketData={bracketData} onGameUpdate={handleGameUpdate} onMatchUpdate={handleMatchUpdate} statCols={statCols}/>
          )}

          {/* Standings for non-RR single formats */}
          {!isMulti&&!isRR&&step==="bracket"&&(
            <div style={{marginTop:24}}>
              {!showPlayers
                ?<TeamStandingsTable teams={allBracketTeams} matches={allBracketMatches} title="Overall Standings" showScore={matchMode==="score"}/>
                :<PlayerStandingsTable teams={allBracketTeams} matches={allBracketMatches} statCols={statCols} title="Player Standings" sortBy={playerSort} onSortBy={setPlayerSort}/>}
            </div>
          )}

          {/* MVP Awards Panel */}
          {showAwards&&step==="bracket"&&(()=>{
            const roundCount=isRR?rrRounds.length:0;
            const stageCount=isMulti?stages.length:0;
            const getMatchesFromStageData=(sd)=>{
              if(!sd)return[];
              if(sd.type==="roundrobin")return(sd.rounds||[]).flat();
              if(sd.type==="groupstage")return(sd.groups||[]).flatMap(g=>(g.rounds||[]).flat());
              if(sd.type==="single")return[...(sd.winners||[]).flat(),...(sd.qualificationTiebreaker?.rounds||[]).flat()];
              if(sd.type==="double")return dataMatches(sd);
              return[];
            };
            const stageMatchSets=isMulti?stages.map((_,idx)=>playableMatches(getMatchesFromStageData(stageData[idx]))):[];
            const finalStageActive=isMulti&&activeStageIdx===stages.length-1;
            return(
              <>
                <MvpAwardsPanel
                  awards={awards}
                  onChange={setAwards}
                  allTeams={isMulti?Object.values(stageData).flatMap(sd=>sd?.teams||[]).filter((t,i,a)=>a.findIndex(x=>x.name===t.name)===i):teamsWithSeed}
                  roundCount={roundCount}
                  stageCount={stageCount}
                  isMulti={isMulti}
                  activeStageIdx={activeStageIdx}
                  isFinalStage={!isMulti||finalStageActive}
                />
                {finalStageActive&&(
                  <div style={{marginTop:14}}>
                    <PlayerStandingsTable
                      teams={teamsWithSeed}
                      matches={stageMatchSets.flat()}
                      stageMatchSets={stageMatchSets}
                      statCols={statCols}
                      title="Tournament MVP Stats"
                      sortBy={playerSort}
                      onSortBy={setPlayerSort}
                    />
                  </div>
                )}
              </>
            );
          })()}
            </>
          )}
          {bracketTab==="settings"&&renderSettingsTab()}
          {bracketTab==="participants"&&renderParticipantsTab()}
        </div>
      )}
    </div>
  );
}
