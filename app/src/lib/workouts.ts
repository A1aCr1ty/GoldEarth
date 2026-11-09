export interface Exercise {
  id: string;
  name: string;
  muscle: string;
  equipment: string;
  timed?: boolean;
  cue: string;
  steps: string[];
  breathing: string;
  mistake: string;
}
export const exercises: Exercise[] = [
  { id: "squat", name: "徒手深蹲", muscle: "腿部", equipment: "徒手", cue: "双脚站稳，屈髋屈膝下蹲，膝盖跟随脚尖方向，在可控幅度内起身。", steps: ["双脚与肩同宽，脚尖自然朝外，收紧腹部。", "臀部向后下方坐，膝盖跟随脚尖方向，保持脚掌完整贴地。", "下蹲至大腿接近平行或舒适深度，再踩稳地面起身。"], breathing: "下蹲吸气，起身呼气。", mistake: "避免膝盖内扣、脚跟抬起和弓背；不要追求超出控制范围的深度。" },
  { id: "pushup", name: "俯卧撑", muscle: "胸部", equipment: "徒手", cue: "收紧腹部，身体保持直线，缓慢下降再推起；可用上斜俯卧撑降低难度。", steps: ["双手略宽于肩，手指朝前，双腿向后伸直。", "收紧腹部和臀部，让头、躯干与双腿保持一条直线。", "屈肘让胸口靠近地面，再推地回到起始姿势。"], breathing: "下降吸气，推起呼气。", mistake: "避免塌腰、耸肩和肘部完全向两侧打开；可降低幅度或改做上斜俯卧撑。" },
  { id: "bridge", name: "臀桥", muscle: "臀部", equipment: "徒手", cue: "仰卧屈膝，脚掌踩地，收紧臀部抬髋，避免腰部过度后仰。", steps: ["仰卧屈膝，双脚与髋同宽，脚跟靠近臀部。", "轻收腹部，脚掌发力，将髋部抬至肩、髋、膝接近一条直线。", "顶端夹紧臀部短暂停留，再缓慢下放。"], breathing: "抬髋呼气，下放吸气。", mistake: "不要用腰部过度后仰换取高度，也不要让膝盖向内倒。" },
  { id: "plank", name: "平板支撑", muscle: "核心", equipment: "徒手", timed: true, cue: "肘在肩下，保持正常呼吸，躯干成直线；姿势失控就结束本组。", steps: ["前臂撑地，肘部位于肩膀正下方，双腿向后伸直。", "收紧腹部和臀部，轻推地面，保持头到脚跟成直线。", "在躯干稳定的前提下保持计时，姿势失控即结束。"], breathing: "全程缓慢、均匀呼吸，不要憋气。", mistake: "避免塌腰、臀部抬得过高或憋气；可屈膝降低难度。" },
  { id: "row", name: "哑铃划船", muscle: "背部", equipment: "哑铃", cue: "保持背部稳定，肘向髋部方向拉，缓慢放回；两侧分别完成所记次数。", steps: ["一只手和同侧膝撑稳训练凳，另一只手持哑铃自然下垂。", "保持背部自然平直，将肘部朝髋部方向拉起。", "顶端轻收肩胛，再控制哑铃缓慢回到起始位置。"], breathing: "拉起呼气，下放吸气。", mistake: "避免耸肩、扭转躯干或借惯性甩动；两侧使用相同动作幅度。" },
  { id: "press", name: "哑铃肩推", muscle: "肩部", equipment: "哑铃", cue: "腹部收紧，从肩部上推到舒适幅度，避免耸肩和腰部过度后仰。", steps: ["坐稳或站直，双手持哑铃位于肩部两侧，掌心朝前。", "收紧腹部，将哑铃向上推至手臂自然伸展。", "缓慢下放至肩部附近，保持颈部放松。"], breathing: "上推呼气，下放吸气。", mistake: "避免腰部过度后仰、耸肩和哑铃在头顶猛烈碰撞；肩部疼痛时停止。" },
  { id: "curl", name: "哑铃弯举", muscle: "手臂", equipment: "哑铃", cue: "肘靠近身体，避免借力摇摆，缓慢伸肘还原。", steps: ["站立收紧躯干，双手持哑铃，手臂自然下垂。", "保持上臂贴近身体，屈肘将哑铃举向肩部。", "在顶端不甩腕，随后缓慢伸肘还原。"], breathing: "弯举呼气，下放吸气。", mistake: "避免摆动身体、肘部前移和快速下落；宁可用更轻的重量。" },
  { id: "goblet", name: "高脚杯深蹲", muscle: "腿部", equipment: "哑铃", cue: "哑铃置于胸前，双脚踩稳，按可控深度下蹲起身。", steps: ["双手托住一只哑铃置于胸前，手肘自然朝下。", "双脚站稳，屈髋屈膝向后下方坐，保持哑铃贴近身体。", "脚掌发力起身，全程保持躯干稳定。"], breathing: "下蹲吸气，起身呼气。", mistake: "避免哑铃远离身体、膝盖内扣和脚跟离地。" },
  { id: "rdl", name: "哑铃罗马尼亚硬拉", muscle: "臀部", equipment: "哑铃", cue: "膝微屈，髋向后移动，负重贴近腿部，保持背部自然稳定。", steps: ["双手持哑铃放在大腿前，膝盖保持轻微弯曲。", "将臀部向后推，躯干随之前倾，哑铃贴近腿部下放。", "感觉到大腿后侧拉伸后，收紧臀部并向前推髋站起。"], breathing: "下放吸气，站起呼气。", mistake: "这是髋部后移而不是深蹲；避免弓背、哑铃离腿过远或盲目追求下放深度。" },
  { id: "bench", name: "哑铃卧推", muscle: "胸部", equipment: "哑铃", cue: "在稳定训练凳上仰卧，脚踩地，缓慢下放再推起，重量以可控为准。", steps: ["仰卧在稳定训练凳上，双脚踩地，哑铃位于胸部两侧。", "保持肩胛稳定，向上推起哑铃至手臂自然伸展。", "控制哑铃沿原路径下放，肘部略低于躯干即可。"], breathing: "推起呼气，下放吸气。", mistake: "避免腰部大幅拱起、肘部过度下落和快速反弹；大重量训练应有人保护。" },
  { id: "deadbug", name: "死虫式", muscle: "核心", equipment: "徒手", cue: "仰卧收紧腹部，交替伸出对侧手脚，腰背保持稳定；记录每侧次数。", steps: ["仰卧，双臂指向天花板，髋膝均约呈 90 度。", "轻收腹部，让腰背保持稳定，缓慢伸出一侧手臂和对侧腿。", "回到起始位置后换另一侧，交替完成。"], breathing: "伸出时缓慢呼气，还原时吸气。", mistake: "避免腰部拱起和手脚快速下落；先缩小活动范围再逐渐增加。" },
  { id: "walk", name: "快走", muscle: "心肺", equipment: "徒手", timed: true, cue: "选择平整路线，以能正常说短句的舒适节奏走动；时间以秒记录。", steps: ["选择平整安全的路线，穿合脚的运动鞋并先慢走热身。", "抬头看前方，手臂自然摆动，以稳定轻快的步伐前进。", "以能正常说短句的强度持续，结束前逐渐放慢。"], breathing: "保持自然有节奏的呼吸，不要憋气。", mistake: "避免刻意跨大步、低头看手机或突然提速；胸闷、眩晕时立即停止。" },
  { id: "lunge", name: "行走弓步", muscle: "腿部", equipment: "徒手", cue: "向前迈出一大步下蹲，前脚全脚掌着地，再迈出另一侧；左右交替，记录单侧次数。", steps: ["站直，收紧腹部，向前迈出一步，前脚踩稳。", "后膝朝地面方向弯曲，前膝跟随脚尖，下蹲至可控深度。", "前脚发力站起并向前走一步，换另一侧重复。"], breathing: "下蹲吸气，站起呼气。", mistake: "避免前脚脚跟抬起、膝盖内扣和身体前扑；空间不够时改为原地弓步。" },
  { id: "incline", name: "上斜俯卧撑", muscle: "胸部", equipment: "徒手", cue: "双手撑在稳固的桌沿、台阶或墙面，身体保持直线，胸口靠近支撑再推起。", steps: ["选择不会滑动的支撑，越高越省力，双手略宽于肩。", "双脚向后踩稳，收紧腹部，头到脚跟保持直线。", "屈肘让胸口靠近支撑，再推回起始位置。"], breathing: "下降吸气，推起呼气。", mistake: "避免塌腰、耸肩和支撑物滑动；肩部疼痛时升高支撑或停止。" },
  { id: "crunch", name: "卷腹", muscle: "核心", equipment: "徒手", cue: "仰卧屈膝，肩胛轻轻离开地面，不要用手拉脖子，也不必坐到直立。", steps: ["仰卧，双膝弯曲，脚掌踩地，双手轻扶头侧。", "呼气时收紧腹部，把肩胛抬离地面。", "在顶端短暂停留，再缓慢回到地面，后脑不要砸下。"], breathing: "卷起呼气，回落吸气。", mistake: "避免用手向前拽脖子、憋气和用惯性弹起；腰背不必完全离地。" },
  { id: "revcrunch", name: "反向卷腹", muscle: "核心", equipment: "徒手", cue: "仰卧收紧腹部，把膝盖朝胸口轻卷，腰部只略微离开地面。", steps: ["仰卧，双臂放在身体两侧，髋膝弯曲，小腿抬离地面。", "呼气时用腹部把膝盖拉向胸口，骨盆轻轻卷起。", "缓慢放回，脚不要突然下落砸向地面。"], breathing: "卷起呼气，回落吸气。", mistake: "避免把身体翻过头顶、颈部用力或双腿快速下落。" },
  { id: "sideplank", name: "侧平板", muscle: "核心", equipment: "徒手", timed: true, cue: "前臂撑地，身体成一条斜线并计时；两侧分开完成，姿势失控就结束。", steps: ["侧卧，肘在肩下方，双腿伸直并叠放。", "抬起髋部，使头、躯干和双脚接近一条直线。", "上方手可扶在髋部，保持均匀呼吸，直到姿势失控。"], breathing: "全程缓慢呼吸，不要憋气。", mistake: "避免髋部下沉、身体转向地面或憋气；可以屈膝降低难度。" },
  { id: "kick", name: "跪姿后踢", muscle: "臀部", equipment: "徒手", cue: "四点支撑，把一侧腿向后上方抬起，腰背保持稳定；左右分开计数。", steps: ["双手和双膝撑地，手腕在肩下，膝在髋下。", "收紧腹部，将一侧腿向后抬起，膝可保持微屈。", "抬至大腿接近与躯干平行后缓慢收回，再换另一侧。"], breathing: "后踢呼气，收回吸气。", mistake: "避免腰部下塌、骨盆左右扭转和把腿踢得过高。" },
  { id: "slbridge", name: "单腿臀桥", muscle: "臀部", equipment: "徒手", cue: "仰卧单脚撑地抬髋，另一腿抬起；先能稳定完成双腿臀桥再做，左右分开计数。", steps: ["仰卧屈膝，一脚踩地，另一腿抬离地面。", "支撑脚发力，把髋部抬到肩、髋、膝接近一条直线。", "顶端停留片刻，缓慢下放，再换另一侧。"], breathing: "抬髋呼气，下放吸气。", mistake: "避免腰部过度后仰、支撑膝内扣和用摆动代替发力。" },
  { id: "superman", name: "超人式", muscle: "背部", equipment: "徒手", cue: "俯卧，手脚同时轻轻抬离地面，幅度以腰部舒适为准，再缓慢放下。", steps: ["俯卧，手臂向前伸展，腿伸直，额头可轻触地面。", "收紧背部和臀部，把手和脚轻轻抬起。", "保持短暂停留后缓慢放下，不要甩动身体。"], breathing: "抬起呼气，放下吸气。", mistake: "避免抬得过高导致腰部反弓、憋气和用惯性甩腿。" },
  { id: "pullup", name: "引体向上", muscle: "背部", equipment: "单杠", cue: "正握稳固单杠，身体悬垂后拉至下巴过杠，再缓慢放下；做不到全程可只做离心下放。", steps: ["双手略宽于肩正握单杠，肩胛先轻轻下沉。", "屈肘把胸口拉向单杠，直到下巴超过横杠。", "控制身体缓慢放回悬垂，不要突然松手。"], breathing: "上拉呼气，下放吸气。", mistake: "避免甩腿借力、耸肩到耳朵和半程急速下落；肩肘疼痛时停止。" },
  { id: "dip", name: "凳上臂屈伸", muscle: "手臂", equipment: "训练凳", cue: "双手撑在稳固椅子或凳子边缘，脚放在地面，屈肘下降再撑起。", steps: ["双手放在凳边，手指朝前，臀部移出凳面，双脚踩地。", "屈肘让身体下降，上臂接近与地面平行即可。", "手掌发力撑起，凳子必须稳定且不会滑动。"], breathing: "下降吸气，撑起呼气。", mistake: "避免肩部过度下沉、凳子滑动和追求过深幅度；肩前侧疼痛时停止。" },
  { id: "lateral", name: "哑铃侧平举", muscle: "肩部", equipment: "哑铃", cue: "肘部微屈，把哑铃向两侧抬到与肩同高，再缓慢放下。", steps: ["站直，双手持较轻的哑铃，放在身体两侧。", "肘部保持微屈，沿身体两侧抬到与肩同高。", "在顶端不要耸肩，随后控制哑铃缓慢放下。"], breathing: "抬起呼气，放下吸气。", mistake: "避免借摆动甩起、超过肩膀继续上举和用过重的重量。" },
  { id: "front", name: "交替前平举", muscle: "肩部", equipment: "哑铃", cue: "双臂交替把哑铃举到肩高，躯干保持直立；记录单侧次数。", steps: ["站直，双手持哑铃放在大腿前。", "一侧手臂微屈，把哑铃举到与肩同高。", "缓慢放下后换另一侧，身体不要前后摇。"], breathing: "上举呼气，放下吸气。", mistake: "避免腰部后仰、举过头顶和用惯性甩动。" },
  { id: "fly", name: "哑铃飞鸟", muscle: "胸部", equipment: "哑铃", cue: "仰卧在稳固训练凳上，肘部微屈，向两侧打开后再合拢到胸上方。", steps: ["仰卧，双脚踩地，哑铃举在胸口上方，掌心相对。", "肘部保持微屈，沿弧线向两侧打开。", "感觉胸口拉伸后，再沿原路径合拢。"], breathing: "打开吸气，合拢呼气。", mistake: "避免手臂完全伸直、下放过深和在底部反弹；大重量应有人保护。" },
  { id: "rear", name: "俯身飞鸟", muscle: "肩部", equipment: "哑铃", cue: "俯身保持背部稳定，肘部微屈，把哑铃向两侧抬到与肩同高。", steps: ["俯身或让额头靠在稳固凳面上，双手持轻哑铃自然下垂。", "保持背部平直，将哑铃向两侧抬起。", "抬到与肩同高后缓慢放下，不要耸肩。"], breathing: "抬起呼气，放下吸气。", mistake: "避免弓背、用甩动把哑铃甩起来和重量过大。" },
  { id: "hammer", name: "交替锤式弯举", muscle: "手臂", equipment: "哑铃", cue: "掌心相对，左右交替屈肘，上臂贴近身体；也可以双臂同时完成，记录口径要一致。", steps: ["站直，双手持哑铃，掌心朝向身体。", "一侧屈肘，把哑铃举向肩部，上臂尽量不前移。", "缓慢伸肘还原后换另一侧。"], breathing: "弯举呼气，下放吸气。", mistake: "避免摆动躯干、甩腕和快速掉落。" },
  { id: "kickback", name: "哑铃臂屈伸", muscle: "手臂", equipment: "哑铃", cue: "单手撑稳训练凳，上臂贴近体侧，伸直前臂后再缓慢弯回；左右分开计数。", steps: ["一手和同侧膝撑在稳固凳上，另一手持哑铃。", "上臂贴近躯干并大致与地面平行，前臂自然下垂。", "伸直前臂，顶端短暂停留，再缓慢弯回。"], breathing: "伸肘呼气，弯回吸气。", mistake: "避免上臂大幅摆动、耸肩和借惯性甩铃。" },
  { id: "calf", name: "单腿提踵", muscle: "腿部", equipment: "哑铃", cue: "前脚掌踩在平放的哑铃上，手扶稳固支撑，单腿抬起脚后跟再缓慢放下。", steps: ["把一只哑铃平放在地面，前脚掌踩在哑铃柄上，手扶墙或稳固家具。", "抬起脚后跟，重量留在前脚掌。", "在顶端停留后缓慢放下，再换另一只脚。"], breathing: "抬起呼气，放下吸气。", mistake: "避免支撑不稳、脚后跟砸落和膝盖锁定后还用力晃动。" },
  { id: "bentrow", name: "俯身双臂划船", muscle: "背部", equipment: "哑铃", cue: "屈髋俯身，背部保持稳定，双肘向髋部方向拉起哑铃，再缓慢放下。", steps: ["双脚站稳，膝微屈，髋向后坐，躯干前倾到舒适角度。", "双手持哑铃下垂，将肘部朝髋部拉起。", "肩胛轻轻收拢后，控制哑铃放回。"], breathing: "拉起呼气，放下吸气。", mistake: "避免弓背、用甩动起铃和站起时用腿代替背部发力。" },
  { id: "shrug", name: "哑铃耸肩", muscle: "背部", equipment: "哑铃", cue: "手臂伸直持哑铃，只把肩膀向上耸起，再缓慢放下，不要靠屈肘完成。", steps: ["站直，双手持哑铃垂在身体两侧。", "肩部垂直向上提起，颈部保持放松。", "在顶端不要翻肩画圈，再缓慢放下。"], breathing: "上提呼气，放下吸气。", mistake: "避免弯肘把哑铃举起来、低头和用过重的重量耸肩。" },
  { id: "floor", name: "地板卧推", muscle: "胸部", equipment: "哑铃", cue: "仰卧在地面，膝弯曲，哑铃从胸部上推，肘部碰到地面就停止下放。", steps: ["仰卧，双膝弯曲，双脚踩地，哑铃位于胸口两侧。", "向上推起，手臂自然伸展，哑铃不必互相碰撞。", "缓慢下放，直到上臂接触地面。"], breathing: "推起呼气，下放吸气。", mistake: "避免腰部拱起、哑铃在头顶相撞和肘部离开地面后继续下沉。" },
  { id: "split", name: "保加利亚分腿蹲", muscle: "腿部", equipment: "哑铃", cue: "后脚脚尖搭在稳固凳面，前脚支撑下蹲再站起；没有凳子时后脚点地即可。左右分开计数。", steps: ["后脚脚尖放在不会滑动的凳面上，前脚向前站稳。", "双手持哑铃垂于身侧，屈前膝下蹲到可控深度。", "前脚发力站起，保持躯干稳定，再换另一侧。"], breathing: "下蹲吸气，站起呼气。", mistake: "避免前膝内扣、凳子滑动和后膝砸地。" },
  { id: "step", name: "哑铃上台阶", muscle: "腿部", equipment: "哑铃", cue: "一脚踩上稳固台阶站直，再缓慢踏下；台阶大约到膝下方，左右分开计数。", steps: ["面对不会滑动的台阶或训练凳，双手持哑铃。", "整只脚踩上台阶，用这条腿站直，另一脚跟上。", "缓慢踏回地面，再换另一侧。"], breathing: "踏上呼气，踏下吸气。", mistake: "避免台阶过高或滑动、用摆腿惯性蹬起和膝盖内扣。" },
];
export const routines = [
  { name: "居家全身", description: "徒手 · 腿 / 胸 / 臀 / 核心", ids: ["squat", "pushup", "bridge", "plank"] },
  { name: "上肢力量", description: "哑铃 · 胸 / 背 / 肩 / 手臂", ids: ["bench", "row", "press", "curl"] },
  { name: "下肢与核心", description: "哑铃 + 徒手 · 腿 / 臀 / 核心", ids: ["goblet", "rdl", "bridge", "deadbug"] },
  { name: "徒手进阶", description: "徒手 · 腿 / 胸 / 臀 / 核心", ids: ["lunge", "incline", "kick", "sideplank"] },
  { name: "核心巩固", description: "徒手 · 核心 / 背 / 臀", ids: ["crunch", "revcrunch", "superman", "slbridge"] },
  { name: "哑铃肩臂", description: "哑铃 · 肩 / 手臂", ids: ["lateral", "rear", "hammer", "kickback"] },
  { name: "下肢进阶", description: "哑铃 · 腿 / 分腿蹲 / 台阶", ids: ["split", "step", "calf", "lunge"] },
];
export interface WorkoutSet { id: string; exerciseId: string; load: number; reps: number; done: boolean }
export interface Workout { id: string; name: string; started: number; ended?: number; sets: WorkoutSet[] }
export interface GymData { active: Workout | null; history: Workout[]; weights: { date: string; kg: number }[]; restUntil: number; plan: string[] }
export const emptyGym: GymData = { active: null, history: [], weights: [], restUntil: 0, plan: ["居家全身", "休息", "上肢力量", "休息", "下肢与核心", "休息", "休息"] };
export function makeSet(exerciseId: string): WorkoutSet {
  return { id: crypto.randomUUID(), exerciseId, load: 0, reps: exercises.find(e => e.id === exerciseId)?.timed ? 30 : 10, done: false };
}
export function volume(sets: WorkoutSet[]) {
  return sets.filter(s => s.done && !exercises.find(e => e.id === s.exerciseId)?.timed).reduce((sum, s) => sum + s.load * s.reps, 0);
}
export function validSet(s: WorkoutSet) {
  return Number.isFinite(s.load) && s.load >= 0 && s.load <= 1000 && Number.isInteger(s.reps) && s.reps > 0 && s.reps <= 86400;
}
