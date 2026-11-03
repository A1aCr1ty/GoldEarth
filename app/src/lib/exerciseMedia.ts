export interface ExerciseMedia { sourceId: string; sourceUrl: string; note: string; frames: { src: string; caption: string }[] }
export const exerciseMedia: Record<string, ExerciseMedia> = {
  "squat": {
    "sourceId": "Bodyweight_Squat",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Bodyweight_Squat",
    "note": "图中双手置于头后；也可双臂前伸保持平衡。",
    "frames": [
      {
        "src": "/exercise-media/Bodyweight_Squat/0.jpg",
        "caption": "站立准备"
      },
      {
        "src": "/exercise-media/Bodyweight_Squat/1.jpg",
        "caption": "屈髋下蹲"
      }
    ]
  },
  "pushup": {
    "sourceId": "Pushups",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Pushups",
    "note": "",
    "frames": [
      {
        "src": "/exercise-media/Pushups/0.jpg",
        "caption": "直臂支撑"
      },
      {
        "src": "/exercise-media/Pushups/1.jpg",
        "caption": "屈肘下降"
      }
    ]
  },
  "bridge": {
    "sourceId": "Butt_Lift_Bridge",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Butt_Lift_Bridge",
    "note": "",
    "frames": [
      {
        "src": "/exercise-media/Butt_Lift_Bridge/0.jpg",
        "caption": "仰卧准备"
      },
      {
        "src": "/exercise-media/Butt_Lift_Bridge/1.jpg",
        "caption": "抬髋收臀"
      }
    ]
  },
  "plank": {
    "sourceId": "Plank",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Plank",
    "note": "静态保持动作，保持呼吸，不需要反复起落。",
    "frames": [
      {
        "src": "/exercise-media/Plank/1.jpg",
        "caption": "前臂支撑保持"
      }
    ]
  },
  "row": {
    "sourceId": "One-Arm_Dumbbell_Row",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/One-Arm_Dumbbell_Row",
    "note": "图示为训练凳支撑的单臂版本；完成后换侧。",
    "frames": [
      {
        "src": "/exercise-media/One-Arm_Dumbbell_Row/0.jpg",
        "caption": "支撑并下放"
      },
      {
        "src": "/exercise-media/One-Arm_Dumbbell_Row/1.jpg",
        "caption": "向髋部拉起"
      }
    ]
  },
  "press": {
    "sourceId": "Dumbbell_Shoulder_Press",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Dumbbell_Shoulder_Press",
    "note": "图示采用有靠背的坐姿版本。",
    "frames": [
      {
        "src": "/exercise-media/Dumbbell_Shoulder_Press/0.jpg",
        "caption": "坐姿肩部准备"
      },
      {
        "src": "/exercise-media/Dumbbell_Shoulder_Press/1.jpg",
        "caption": "向上推举"
      }
    ]
  },
  "curl": {
    "sourceId": "Dumbbell_Bicep_Curl",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Dumbbell_Bicep_Curl",
    "note": "",
    "frames": [
      {
        "src": "/exercise-media/Dumbbell_Bicep_Curl/0.jpg",
        "caption": "手臂自然下垂"
      },
      {
        "src": "/exercise-media/Dumbbell_Bicep_Curl/1.jpg",
        "caption": "屈肘弯举"
      }
    ]
  },
  "goblet": {
    "sourceId": "Goblet_Squat",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Goblet_Squat",
    "note": "图中使用壶铃；当前计划使用哑铃时，双手托住哑铃一端，不照搬壶铃握法。",
    "frames": [
      {
        "src": "/exercise-media/Goblet_Squat/0.jpg",
        "caption": "胸前持铃"
      },
      {
        "src": "/exercise-media/Goblet_Squat/1.jpg",
        "caption": "下蹲位置"
      }
    ]
  },
  "rdl": {
    "sourceId": "Stiff-Legged_Dumbbell_Deadlift",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Stiff-Legged_Dumbbell_Deadlift",
    "note": "相近动作参考：来源为哑铃直腿硬拉。当前罗马尼亚硬拉保持膝微屈，下放幅度以髋部活动能力为准，不追求触地。",
    "frames": [
      {
        "src": "/exercise-media/Stiff-Legged_Dumbbell_Deadlift/0.jpg",
        "caption": "站立持铃"
      },
      {
        "src": "/exercise-media/Stiff-Legged_Dumbbell_Deadlift/1.jpg",
        "caption": "髋部后移"
      }
    ]
  },
  "bench": {
    "sourceId": "Dumbbell_Bench_Press",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Dumbbell_Bench_Press",
    "note": "",
    "frames": [
      {
        "src": "/exercise-media/Dumbbell_Bench_Press/0.jpg",
        "caption": "胸侧准备"
      },
      {
        "src": "/exercise-media/Dumbbell_Bench_Press/1.jpg",
        "caption": "向上推起"
      }
    ]
  },
  "deadbug": {
    "sourceId": "Dead_Bug",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Dead_Bug",
    "note": "图示为双臂竖直、交替伸腿的基础版本；熟练后再按步骤加入对侧手臂伸展。",
    "frames": [
      {
        "src": "/exercise-media/Dead_Bug/0.jpg",
        "caption": "髋膝屈曲准备"
      },
      {
        "src": "/exercise-media/Dead_Bug/1.jpg",
        "caption": "交替伸腿"
      }
    ]
  },
  "walk": {
    "sourceId": "Walking_Treadmill",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Walking_Treadmill",
    "note": "图中为跑步机步行参考；户外快走仍选择平整路线，速度按自身能力调整。",
    "frames": [
      {
        "src": "/exercise-media/Walking_Treadmill/0.jpg",
        "caption": "自然步行姿势"
      }
    ]
  },
  "lunge": {
    "sourceId": "Bodyweight_Walking_Lunge",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Bodyweight_Walking_Lunge",
    "note": "图中先提膝迈步，再下蹲成弓步，双手叉腰。原地空间不足时不必向前走，双手也可自然下垂。",
    "frames": [
      { "src": "/exercise-media/Bodyweight_Walking_Lunge/0.jpg", "caption": "提膝迈步" },
      { "src": "/exercise-media/Bodyweight_Walking_Lunge/1.jpg", "caption": "下蹲成弓步" }
    ]
  },
  "incline": {
    "sourceId": "Incline_Push-Up",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Incline_Push-Up",
    "note": "图中双手撑在箱子上。换成墙面、桌沿或台阶时，先确认支撑不会滑动；支撑越高越容易。",
    "frames": [
      { "src": "/exercise-media/Incline_Push-Up/0.jpg", "caption": "胸口靠近支撑" },
      { "src": "/exercise-media/Incline_Push-Up/1.jpg", "caption": "推直手臂" }
    ]
  },
  "crunch": {
    "sourceId": "Crunches",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Crunches",
    "note": "双手轻扶头侧即可，不要用力把脖子向前拉。肩胛离开地面就够，不必坐起来。",
    "frames": [
      { "src": "/exercise-media/Crunches/0.jpg", "caption": "仰卧屈膝" },
      { "src": "/exercise-media/Crunches/1.jpg", "caption": "肩胛离地" }
    ]
  },
  "revcrunch": {
    "sourceId": "Reverse_Crunch",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Reverse_Crunch",
    "note": "第二张把髋部卷得很高。实际只需膝盖朝胸口轻卷，不要把身体翻过头顶。",
    "frames": [
      { "src": "/exercise-media/Reverse_Crunch/0.jpg", "caption": "屈髋准备" },
      { "src": "/exercise-media/Reverse_Crunch/1.jpg", "caption": "卷起骨盆" }
    ]
  },
  "sideplank": {
    "sourceId": "Side_Bridge",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Side_Bridge",
    "note": "静态保持。图中上方手扶在髋部，双脚叠放；只保留成直线的姿势，不把髋部下沉的准备姿势轮播进来。",
    "frames": [
      { "src": "/exercise-media/Side_Bridge/1.jpg", "caption": "前臂侧撑保持" }
    ]
  },
  "kick": {
    "sourceId": "Glute_Kickback",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Glute_Kickback",
    "note": "第二张后踢很高。实际抬到大腿接近与躯干平行即可，避免腰部下塌。完成后换另一侧。",
    "frames": [
      { "src": "/exercise-media/Glute_Kickback/0.jpg", "caption": "四点支撑" },
      { "src": "/exercise-media/Glute_Kickback/1.jpg", "caption": "向后抬腿" }
    ]
  },
  "slbridge": {
    "sourceId": "Single_Leg_Glute_Bridge",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Single_Leg_Glute_Bridge",
    "note": "图中非支撑腿向上伸直。也可以屈膝抬起；先能稳定完成双腿臀桥再尝试单腿。",
    "frames": [
      { "src": "/exercise-media/Single_Leg_Glute_Bridge/0.jpg", "caption": "单脚准备" },
      { "src": "/exercise-media/Single_Leg_Glute_Bridge/1.jpg", "caption": "抬髋伸髋" }
    ]
  },
  "superman": {
    "sourceId": "Superman",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Superman",
    "note": "第二张手脚抬得较高。实际轻轻离地即可，不要为了贴近照片而把腰部大幅反弓。",
    "frames": [
      { "src": "/exercise-media/Superman/0.jpg", "caption": "俯卧伸展" },
      { "src": "/exercise-media/Superman/1.jpg", "caption": "手脚离地" }
    ]
  },
  "pullup": {
    "sourceId": "Pullups",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Pullups",
    "note": "需要稳固单杠。图中佩戴助力带，动作本身不依赖它；做不到全程时可以只做缓慢离心下放。",
    "frames": [
      { "src": "/exercise-media/Pullups/0.jpg", "caption": "悬垂" },
      { "src": "/exercise-media/Pullups/1.jpg", "caption": "拉至下巴过杠" }
    ]
  },
  "dip": {
    "sourceId": "Bench_Dips",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Bench_Dips",
    "note": "图中双脚垫高并且下放很深。初学把脚放在地面，肘屈到上臂接近与地面平行即可。",
    "frames": [
      { "src": "/exercise-media/Bench_Dips/0.jpg", "caption": "手臂支撑" },
      { "src": "/exercise-media/Bench_Dips/1.jpg", "caption": "屈肘下降" }
    ]
  },
  "lateral": {
    "sourceId": "Side_Lateral_Raise",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Side_Lateral_Raise",
    "note": "",
    "frames": [
      { "src": "/exercise-media/Side_Lateral_Raise/0.jpg", "caption": "哑铃在身侧" },
      { "src": "/exercise-media/Side_Lateral_Raise/1.jpg", "caption": "抬至肩高" }
    ]
  },
  "front": {
    "sourceId": "Front_Dumbbell_Raise",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Front_Dumbbell_Raise",
    "note": "图示为左右交替。记录单侧次数；若改成双臂同时举起，每次记录都要使用同一种口径。",
    "frames": [
      { "src": "/exercise-media/Front_Dumbbell_Raise/0.jpg", "caption": "哑铃在身前" },
      { "src": "/exercise-media/Front_Dumbbell_Raise/1.jpg", "caption": "单臂举至肩高" }
    ]
  },
  "fly": {
    "sourceId": "Dumbbell_Flyes",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Dumbbell_Flyes",
    "note": "需要稳固训练凳。肘部始终微屈，向两侧打开到胸口有拉伸即可。",
    "frames": [
      { "src": "/exercise-media/Dumbbell_Flyes/0.jpg", "caption": "哑铃在胸上方" },
      { "src": "/exercise-media/Dumbbell_Flyes/1.jpg", "caption": "向两侧打开" }
    ]
  },
  "rear": {
    "sourceId": "Bent_Over_Dumbbell_Rear_Delt_Raise_With_Head_On_Bench",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Bent_Over_Dumbbell_Rear_Delt_Raise_With_Head_On_Bench",
    "note": "图中额头靠在上斜训练凳上。没有凳子时可只俯身并保持背部平直，不必勉强模仿靠凳。",
    "frames": [
      { "src": "/exercise-media/Bent_Over_Dumbbell_Rear_Delt_Raise_With_Head_On_Bench/0.jpg", "caption": "俯身下垂" },
      { "src": "/exercise-media/Bent_Over_Dumbbell_Rear_Delt_Raise_With_Head_On_Bench/1.jpg", "caption": "向两侧抬起" }
    ]
  },
  "hammer": {
    "sourceId": "Hammer_Curls",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Hammer_Curls",
    "note": "图示为左右交替，掌心相对。也可以双臂同时弯举，记录口径保持一致。",
    "frames": [
      { "src": "/exercise-media/Hammer_Curls/0.jpg", "caption": "掌心相对下垂" },
      { "src": "/exercise-media/Hammer_Curls/1.jpg", "caption": "单臂弯举" }
    ]
  },
  "kickback": {
    "sourceId": "Tricep_Dumbbell_Kickback",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Tricep_Dumbbell_Kickback",
    "note": "两张都是伸肘后的位置。开始时前臂自然下垂、上臂贴住躯干，再向后伸直。单侧完成；没有凳子时可改为站立俯身。",
    "frames": [
      { "src": "/exercise-media/Tricep_Dumbbell_Kickback/0.jpg", "caption": "前臂向后伸直" },
      { "src": "/exercise-media/Tricep_Dumbbell_Kickback/1.jpg", "caption": "伸肘保持" }
    ]
  },
  "calf": {
    "sourceId": "Calf_Raise_On_A_Dumbbell",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Calf_Raise_On_A_Dumbbell",
    "note": "哑铃平放在地面，只给前脚掌垫高，不握在手里当负重。图中手扶固定横杆；家中改扶墙或稳固家具，一次只做一条腿。",
    "frames": [
      { "src": "/exercise-media/Calf_Raise_On_A_Dumbbell/0.jpg", "caption": "前脚掌踩稳" },
      { "src": "/exercise-media/Calf_Raise_On_A_Dumbbell/1.jpg", "caption": "抬起脚后跟" }
    ]
  },
  "bentrow": {
    "sourceId": "Bent_Over_Two-Dumbbell_Row",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Bent_Over_Two-Dumbbell_Row",
    "note": "躯干前倾角度以腰背能保持稳定为准，不必压到与地面平行。",
    "frames": [
      { "src": "/exercise-media/Bent_Over_Two-Dumbbell_Row/0.jpg", "caption": "俯身下放" },
      { "src": "/exercise-media/Bent_Over_Two-Dumbbell_Row/1.jpg", "caption": "双肘拉起" }
    ]
  },
  "shrug": {
    "sourceId": "Dumbbell_Shrug",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Dumbbell_Shrug",
    "note": "",
    "frames": [
      { "src": "/exercise-media/Dumbbell_Shrug/0.jpg", "caption": "肩膀放松" },
      { "src": "/exercise-media/Dumbbell_Shrug/1.jpg", "caption": "向上耸肩" }
    ]
  },
  "floor": {
    "sourceId": "Dumbbell_Floor_Press",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Dumbbell_Floor_Press",
    "note": "两张都是仰卧推起后的位置，用来看身体摆放：膝弯曲、哑铃在胸口上方。下放时上臂碰到地面就停。图中在卧推架下示范，家中铺垫即可。",
    "frames": [
      { "src": "/exercise-media/Dumbbell_Floor_Press/0.jpg", "caption": "仰卧，哑铃在胸口上方" },
      { "src": "/exercise-media/Dumbbell_Floor_Press/1.jpg", "caption": "推起后的位置" }
    ]
  },
  "split": {
    "sourceId": "Split_Squat_with_Dumbbells",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Split_Squat_with_Dumbbells",
    "note": "图示后脚搭在训练凳上。凳子必须稳固；没有合适凳子时，后脚脚尖点地做分腿蹲即可。",
    "frames": [
      { "src": "/exercise-media/Split_Squat_with_Dumbbells/0.jpg", "caption": "后脚搭凳" },
      { "src": "/exercise-media/Split_Squat_with_Dumbbells/1.jpg", "caption": "前腿下蹲" }
    ]
  },
  "step": {
    "sourceId": "Dumbbell_Step_Ups",
    "sourceUrl": "https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/Dumbbell_Step_Ups",
    "note": "需要不会滑动的台阶或训练凳。一张是单脚踏在台阶上，另一张是双脚已经站上。台阶高度约在膝下；太高时先改为徒手。",
    "frames": [
      { "src": "/exercise-media/Dumbbell_Step_Ups/1.jpg", "caption": "单脚踏在台阶上" },
      { "src": "/exercise-media/Dumbbell_Step_Ups/0.jpg", "caption": "双脚站上台阶" }
    ]
  }
};
