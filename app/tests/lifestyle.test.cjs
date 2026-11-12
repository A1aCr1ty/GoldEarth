const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve(file), 'utf8'), {compilerOptions:{module: ts.ModuleKind.CommonJS}}).outputText, { module:m, exports:m.exports, crypto:require('node:crypto').webcrypto });
 return m.exports;
}
const { bestLifts, createWorkoutPlan, estimateOneRepMax, gymToCsv, latestExerciseSets, makeSet, muscleTraining, personalRecords, progressionSuggestion, trainingCalendar, volume, validSet, routines, exercises } = load('../src/lib/workouts.ts');
test('training volume excludes timed and unfinished sets; bodyweight adds no artificial load', () => {
 const sets = [{...makeSet('row'),load:20,reps:10,done:true}, {...makeSet('row'),load:20,reps:10}, {...makeSet('plank'),load:50,reps:60,done:true}, {...makeSet('pushup'),reps:10,done:true}];
 assert.equal(volume(sets),200);
 assert.equal(validSet({...makeSet('row'),reps:0}),false);
 assert.equal(validSet({...makeSet('row'),load:NaN}),false);
 assert.equal(validSet({...makeSet('row'),reps:1.5}),false);
 assert.equal(validSet(makeSet('plank')),true);
});
test('templates resolve to real exercises, and sets have independent identifiers', () => {
 for(const r of routines) for(const id of r.ids) assert.ok(exercises.some(e=>e.id===id));
 assert.notEqual(makeSet('row').id,makeSet('row').id);
});
test('height and weight produce a synchronized seven-day plan for each BMI range', () => {
 const cases = [
  [170,50,'偏低','增肌与基础体能',17.3],
  [170,65,'正常','均衡力量与心肺',22.5],
  [170,80,'超重','低冲击减脂与体能',27.7],
  [170,90,'肥胖','低冲击活动与习惯建立',31.1],
 ];
 for(const [height,weight,category,goal,bmi] of cases){
  const result=createWorkoutPlan(height,weight,new Date('2026-11-12T08:00:00+08:00'));
  assert.equal(result.profile.category,category);
  assert.equal(result.profile.goal,goal);
  assert.equal(result.profile.bmi,bmi);
  assert.equal(result.profile.generatedAt,'2026-11-12T00:00:00.000Z');
  assert.equal(result.plan.length,7);
  for(const name of result.plan) assert.ok(name==='休息'||routines.some(r=>r.name===name),name);
 }
 assert.ok(createWorkoutPlan(170,65).plan.includes('心肺快走'));
 assert.ok(createWorkoutPlan(170,80).plan.includes('低冲击全身'));
 assert.equal(createWorkoutPlan(100,23.96).profile.category,'正常','分类使用未四舍五入的 BMI');
 assert.equal(createWorkoutPlan(100,24).profile.category,'超重');
 assert.throws(()=>createWorkoutPlan(0,65),/身高/);
 assert.throws(()=>createWorkoutPlan(170,NaN),/体重/);
});
test('cardio and low-impact routines apply their configured set counts and durations', () => {
 const cardio=routines.find(r=>r.name==='心肺快走');
 const lowImpact=routines.find(r=>r.name==='低冲击全身');
 assert.equal(cardio.sets,1);
 assert.equal(makeSet('walk',cardio.reps.walk).reps,1800);
 assert.equal(lowImpact.sets,2);
 assert.equal(makeSet('walk',lowImpact.reps.walk).reps,600);
});
const doneSet=(exerciseId,load,reps,rir)=>({...makeSet(exerciseId,reps,load),done:true,...(rir===undefined?{}:{rir})});
const session=(started,sets,name='测试训练')=>({id:String(started),name,started,ended:started+1000,sets});
test('guided training reads only completed sets from the latest performance', () => {
 const older=session(Date.UTC(2026,10,1),[doneSet('bench',20,8)]);
 const latest=session(Date.UTC(2026,10,8),[doneSet('bench',20,10),doneSet('bench',20,12),{...makeSet('bench',5,25),done:false}]);
 const previous=latestExerciseSets('bench',[older,latest]);
 assert.equal(previous.length,2);
 assert.equal(previous[0].load,20);
 assert.equal(previous[0].reps,10);
 assert.equal(previous[1].reps,12);
});
test('personal records distinguish load, estimated 1RM, bodyweight reps and timed holds', () => {
 const baseline=[session(Date.UTC(2026,10,1),[doneSet('bench',20,10),doneSet('pushup',0,10),doneSet('plank',0,30)])];
 assert.equal(personalRecords(doneSet('bench',20,10),[]).length,0,'first performance is a baseline, not a PR');
 assert.equal(personalRecords(doneSet('bench',22.5,5),baseline).join('|'),'重量');
 assert.equal(personalRecords(doneSet('bench',20,12),baseline).join('|'),'估算 1RM');
 assert.equal(personalRecords(doneSet('pushup',0,12),baseline).join('|'),'次数');
 assert.equal(personalRecords(doneSet('plank',0,45),baseline).join('|'),'时长');
 assert.equal(personalRecords(doneSet('bench',20,8),baseline).length,0);
 assert.equal(validSet({...makeSet('row'),rir:0}),true);
 assert.equal(validSet({...makeSet('row'),rir:11}),false);
});
test('progression and best lifts use completed performance rather than load alone', () => {
 const history=[session(Date.UTC(2026,10,8),[doneSet('bench',20,12),doneSet('bench',20,12),doneSet('row',100,5),doneSet('row',110,1)])];
 assert.match(progressionSuggestion('bench',history),/22\.5 kg/);
 assert.match(progressionSuggestion('pushup',[session(Date.UTC(2026,10,8),[doneSet('pushup',0,10)])]),/11 次/);
 assert.match(progressionSuggestion('plank',[session(Date.UTC(2026,10,8),[doneSet('plank',0,30)])]),/40 秒/);
 assert.ok(Math.abs(estimateOneRepMax(doneSet('row',100,5))-116.6666667)<0.0001);
 const lifts=bestLifts(history);
 assert.equal(lifts[0].exercise.id,'row');
 assert.equal(lifts[0].load,100,'higher estimated 1RM wins over a heavier single');
 assert.equal(lifts[0].reps,5);
});
test('muscle volume and annual activity are derived from completed sets in range', () => {
 const now=new Date(2026,10,12,12);
 const current=session(now.getTime(),[doneSet('bench',20,10),doneSet('row',20,10),{...makeSet('squat'),done:false}]);
 const old=session(new Date(2026,8,1).getTime(),[doneSet('bench',100,10)]);
 const muscles=muscleTraining([old,current],30,now);
 assert.equal(muscles.length,2);
 assert.equal(muscles.find(m=>m.muscle==='胸部').sets,1);
 assert.equal(muscles.find(m=>m.muscle==='胸部').volume,200);
 assert.equal(muscles.find(m=>m.muscle==='背部').volume,200);
 const calendar=trainingCalendar([current],2,now);
 assert.equal(calendar.length,14);
 const today=calendar.find(day=>day.date===now.toLocaleDateString('sv-SE'));
 assert.equal(today.sets,2);
 assert.equal(today.level,1);
 assert.equal(calendar[0].date,'2026-11-01');
});
test('CSV export preserves Chinese text, RIR, weights and escaped workout names', () => {
 const history=[session(Date.UTC(2026,10,8),[doneSet('bench',20,10,2)],'上肢, "力量"')];
 const csv=gymToCsv({active:null,history,weights:[{date:'2026-11-12',kg:80}],restUntil:0,plan:[]});
 assert.ok(csv.startsWith('记录类型,日期,训练,动作'));
 assert.ok(csv.includes('"上肢, ""力量"""'));
 assert.ok(csv.includes('哑铃卧推'));
 assert.ok(csv.includes('10,,20,2,200,'));
 assert.ok(csv.includes('体重,2026-11-12'));
 assert.ok(csv.endsWith(',80'));
});
const { recipes } = load('../src/lib/recipes.ts');
const { recipeMedia } = load('../src/lib/recipeMedia.ts');
test('recipe catalogue has complete scalable ingredients and cooking steps', () => {
 assert.ok(recipes.length>=24);
 assert.equal(new Set(recipes.map(r=>r.id)).size,recipes.length);
 for(const r of recipes){assert.ok(r.servings>0 && r.minutes>0 && r.steps.length>=3); for(const i of r.ingredients) assert.ok(i.name && i.unit && Number.isFinite(i.amount) && i.amount>0);}
});
test('packaged recipe photos match the dish and the Commons attribution manifest', () => {
 const root = path.resolve(__dirname, '../public/recipe-media');
 const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ATTRIBUTION.json'), 'utf8'));
 const ids = Object.keys(recipeMedia);
 assert.equal(ids.length, 10);
 for (const id of ids) {
  assert.ok(recipes.some(r => r.id === id), id);
  const media = recipeMedia[id];
  const relative = media.src.replace('/recipe-media/', '');
  const entry = manifest.files.find(f => f.path === relative);
  assert.equal(entry.author, media.author);
  assert.equal(entry.license, media.license);
  assert.equal(entry.sourceUrl, media.sourceUrl);
  assert.ok(media.sourceUrl.startsWith('https://commons.wikimedia.org/wiki/File:'));
  const bytes = fs.readFileSync(path.join(root, relative));
  assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
 }
});

const { exerciseMedia } = load('../src/lib/exerciseMedia.ts');
const path = require('node:path');
const crypto = require('node:crypto');
test('every exercise has local reviewed media and captions; packaged files match source manifest', () => {
 const root = path.resolve(__dirname, '../public/exercise-media');
 const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ATTRIBUTION.json'), 'utf8'));
 for (const exercise of exercises) {
  const media = exerciseMedia[exercise.id];
  assert.ok(media && media.frames.length > 0, exercise.id);
  assert.ok(media.sourceUrl.includes(manifest.revision));
  for (const frame of media.frames) {
   const relative = frame.src.replace('/exercise-media/', '');
   assert.ok(frame.caption);
   const entry = manifest.files.find(f => f.path === relative);
   assert.ok(entry, relative);
   const bytes = fs.readFileSync(path.join(root, relative));
   assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8);
   assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  }
 }
 assert.equal(exerciseMedia.plank.frames.length, 1, 'Static plank must not cycle through a kneeling preparation');
 assert.equal(exerciseMedia.sideplank.frames.length, 1, 'Static side plank must not cycle through a sagging preparation');
 for (const id of ['goblet','rdl','deadbug','walk','lunge','incline','crunch','revcrunch','sideplank','kick','slbridge','superman','pullup','dip','front','fly','rear','hammer','kickback','calf','bentrow','floor','split','step']) assert.ok(exerciseMedia[id].note, id);
 assert.equal(exercises.length, 34);
 assert.equal(routines.length, 9);
});
