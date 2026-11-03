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
const { makeSet, volume, validSet, routines, exercises } = load('../src/lib/workouts.ts');
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
 assert.equal(routines.length, 7);
});
