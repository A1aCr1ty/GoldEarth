export interface Recipe { id: string; name: string; category: string; minutes: number; servings: number; ingredients: { name: string; amount: number; unit: string }[]; steps: string[] }
export const recipes: Recipe[] = [
  {
    "id": "1",
    "name": "番茄炒蛋",
    "category": "快手小炒",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "name": "番茄",
        "amount": 300.0,
        "unit": "g"
      },
      {
        "name": "鸡蛋",
        "amount": 3.0,
        "unit": "个"
      },
      {
        "name": "油",
        "amount": 10.0,
        "unit": "ml"
      },
      {
        "name": "盐",
        "amount": 2.0,
        "unit": "g"
      },
      {
        "name": "糖",
        "amount": 2.0,
        "unit": "g"
      }
    ],
    "steps": [
      "番茄切块，鸡蛋加一半盐打散。",
      "热锅放油，炒蛋至凝固后盛出。",
      "下番茄炒出汁，加糖及剩余盐，倒回鸡蛋翻匀煮透。"
    ]
  },
  {
    "id": "2",
    "name": "青椒土豆丝",
    "category": "素食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "name": "土豆",
        "amount": 300.0,
        "unit": "g"
      },
      {
        "name": "青椒",
        "amount": 1.0,
        "unit": "个"
      },
      {
        "name": "醋",
        "amount": 10.0,
        "unit": "ml"
      },
      {
        "name": "油",
        "amount": 10.0,
        "unit": "ml"
      },
      {
        "name": "盐",
        "amount": 2.0,
        "unit": "g"
      }
    ],
    "steps": [
      "土豆切细丝，清水洗去淀粉并沥干；青椒切丝。",
      "热锅放油，下土豆丝翻炒2分钟。",
      "加入青椒、醋和盐，炒至断生；干锅时沿边加少量水。"
    ]
  },
  {
    "id": "3",
    "name": "宫保鸡丁",
    "category": "荤菜",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "name": "鸡胸肉",
        "amount": 250.0,
        "unit": "g"
      },
      {
        "name": "黄瓜",
        "amount": 100.0,
        "unit": "g"
      },
      {
        "name": "熟花生",
        "amount": 40.0,
        "unit": "g"
      },
      {
        "name": "生抽",
        "amount": 15.0,
        "unit": "ml"
      },
      {
        "name": "醋",
        "amount": 10.0,
        "unit": "ml"
      },
      {
        "name": "糖",
        "amount": 5.0,
        "unit": "g"
      },
      {
        "name": "淀粉",
        "amount": 5.0,
        "unit": "g"
      },
      {
        "name": "油",
        "amount": 15.0,
        "unit": "ml"
      },
      {
        "name": "干辣椒",
        "amount": 2.0,
        "unit": "个"
      }
    ],
    "steps": [
      "鸡肉切丁，用一半生抽和淀粉拌匀腌10分钟，黄瓜切丁。",
      "剩余生抽、醋、糖加30ml水拌成碗汁。",
      "热油炒香干辣椒，下鸡丁炒至熟透。",
      "加入黄瓜和碗汁炒至挂汁，最后拌入熟花生。"
    ]
  },
  {
    "id": "4",
    "name": "可乐鸡翅",
    "category": "荤菜",
    "minutes": 35,
    "servings": 2,
    "ingredients": [
      {
        "name": "鸡翅中",
        "amount": 8.0,
        "unit": "个"
      },
      {
        "name": "可乐",
        "amount": 250.0,
        "unit": "ml"
      },
      {
        "name": "生抽",
        "amount": 15.0,
        "unit": "ml"
      },
      {
        "name": "姜",
        "amount": 10.0,
        "unit": "g"
      },
      {
        "name": "油",
        "amount": 5.0,
        "unit": "ml"
      }
    ],
    "steps": [
      "鸡翅擦干，两面划口，姜切片。",
      "少油将鸡翅两面煎至金黄。",
      "加入姜、生抽、可乐，煮开后小火加盖焖20分钟。",
      "确认鸡翅熟透后揭盖收汁，翻动防止糖汁糊底。"
    ]
  },
  {
    "id": "5",
    "name": "红烧肉",
    "category": "荤菜",
    "minutes": 80,
    "servings": 2,
    "ingredients": [
      {
        "name": "五花肉",
        "amount": 400.0,
        "unit": "g"
      },
      {
        "name": "冰糖",
        "amount": 15.0,
        "unit": "g"
      },
      {
        "name": "生抽",
        "amount": 20.0,
        "unit": "ml"
      },
      {
        "name": "老抽",
        "amount": 5.0,
        "unit": "ml"
      },
      {
        "name": "姜",
        "amount": 15.0,
        "unit": "g"
      },
      {
        "name": "八角",
        "amount": 1.0,
        "unit": "个"
      }
    ],
    "steps": [
      "五花肉切块，冷水下锅焯出浮沫，捞起洗净。",
      "锅中煸炒肉块至出油，加入冰糖炒融。",
      "加入姜、八角、生抽、老抽和没过肉的热水。",
      "小火加盖炖60分钟至软烂，开盖收汁。"
    ]
  },
  {
    "id": "6",
    "name": "香菇滑鸡",
    "category": "荤菜",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "name": "鸡腿肉",
        "amount": 300.0,
        "unit": "g"
      },
      {
        "name": "鲜香菇",
        "amount": 150.0,
        "unit": "g"
      },
      {
        "name": "生抽",
        "amount": 15.0,
        "unit": "ml"
      },
      {
        "name": "淀粉",
        "amount": 5.0,
        "unit": "g"
      },
      {
        "name": "姜",
        "amount": 10.0,
        "unit": "g"
      },
      {
        "name": "油",
        "amount": 10.0,
        "unit": "ml"
      }
    ],
    "steps": [
      "鸡腿肉切块，用生抽、淀粉腌10分钟；香菇切片。",
      "油热炒香姜片，下鸡肉炒变色。",
      "加入香菇与100ml水，盖锅焖12分钟至鸡肉熟透。",
      "开盖翻炒收浓汤汁。"
    ]
  },
  {
    "id": "7",
    "name": "清蒸鲈鱼",
    "category": "荤菜",
    "minutes": 25,
    "servings": 2,
    "ingredients": [
      {
        "name": "净鲈鱼",
        "amount": 500.0,
        "unit": "g"
      },
      {
        "name": "姜",
        "amount": 15.0,
        "unit": "g"
      },
      {
        "name": "葱",
        "amount": 20.0,
        "unit": "g"
      },
      {
        "name": "蒸鱼豉油",
        "amount": 20.0,
        "unit": "ml"
      },
      {
        "name": "油",
        "amount": 10.0,
        "unit": "ml"
      }
    ],
    "steps": [
      "鱼处理干净，在厚肉处划刀，铺姜葱。",
      "蒸锅水沸后放入鱼，大火蒸12至15分钟，按鱼厚度延长至熟透。",
      "倒掉蒸出的腥水，换上新葱丝。",
      "淋蒸鱼豉油及烧热的食用油。"
    ]
  },
  {
    "id": "8",
    "name": "蒜蓉西兰花",
    "category": "素食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "name": "西兰花",
        "amount": 300.0,
        "unit": "g"
      },
      {
        "name": "蒜",
        "amount": 15.0,
        "unit": "g"
      },
      {
        "name": "油",
        "amount": 10.0,
        "unit": "ml"
      },
      {
        "name": "盐",
        "amount": 2.0,
        "unit": "g"
      }
    ],
    "steps": [
      "西兰花切小朵洗净，蒜切末。",
      "沸水中焯西兰花2分钟，捞出沥干。",
      "热油炒香蒜末，倒入西兰花加盐翻炒熟。"
    ]
  },
  {
    "id": "9",
    "name": "手撕包菜",
    "category": "素食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "name": "包菜",
        "amount": 350.0,
        "unit": "g"
      },
      {
        "name": "蒜",
        "amount": 10.0,
        "unit": "g"
      },
      {
        "name": "干辣椒",
        "amount": 2.0,
        "unit": "个"
      },
      {
        "name": "生抽",
        "amount": 10.0,
        "unit": "ml"
      },
      {
        "name": "醋",
        "amount": 5.0,
        "unit": "ml"
      },
      {
        "name": "油",
        "amount": 10.0,
        "unit": "ml"
      }
    ],
    "steps": [
      "包菜撕小片洗净，充分沥干。",
      "热油小火炒香蒜片与干辣椒。",
      "转大火倒入包菜翻炒，加生抽与醋，炒至断生出锅。"
    ]
  },
  {
    "id": "10",
    "name": "麻婆豆腐",
    "category": "荤菜",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "name": "豆腐",
        "amount": 400.0,
        "unit": "g"
      },
      {
        "name": "猪肉末",
        "amount": 100.0,
        "unit": "g"
      },
      {
        "name": "豆瓣酱",
        "amount": 15.0,
        "unit": "g"
      },
      {
        "name": "蒜",
        "amount": 10.0,
        "unit": "g"
      },
      {
        "name": "淀粉",
        "amount": 5.0,
        "unit": "g"
      },
      {
        "name": "油",
        "amount": 10.0,
        "unit": "ml"
      }
    ],
    "steps": [
      "豆腐切块，热水煮2分钟捞出；淀粉加20ml水调匀。",
      "热油炒熟肉末，加蒜末与豆瓣酱小火炒香。",
      "加入豆腐与150ml水，小火煮5分钟。",
      "沿边倒淀粉水轻推，煮至汤汁浓稠。"
    ]
  },
  {
    "id": "11",
    "name": "虾仁蒸蛋",
    "category": "蒸煮",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "name": "鸡蛋",
        "amount": 3.0,
        "unit": "个"
      },
      {
        "name": "虾仁",
        "amount": 100.0,
        "unit": "g"
      },
      {
        "name": "温水",
        "amount": 225.0,
        "unit": "ml"
      },
      {
        "name": "盐",
        "amount": 1.0,
        "unit": "g"
      },
      {
        "name": "生抽",
        "amount": 5.0,
        "unit": "ml"
      }
    ],
    "steps": [
      "鸡蛋打散，加温水和盐过筛，撇去泡沫。",
      "盖耐热盘或留孔保鲜膜，水沸后中小火蒸8分钟。",
      "摆上虾仁继续蒸5至7分钟，确认虾仁和蛋液完全熟透。",
      "出锅淋生抽。"
    ]
  },
  {
    "id": "12",
    "name": "冬瓜排骨汤",
    "category": "汤羹",
    "minutes": 65,
    "servings": 2,
    "ingredients": [
      {
        "name": "排骨",
        "amount": 350.0,
        "unit": "g"
      },
      {
        "name": "冬瓜",
        "amount": 300.0,
        "unit": "g"
      },
      {
        "name": "姜",
        "amount": 15.0,
        "unit": "g"
      },
      {
        "name": "盐",
        "amount": 3.0,
        "unit": "g"
      },
      {
        "name": "水",
        "amount": 1000.0,
        "unit": "ml"
      }
    ],
    "steps": [
      "排骨冷水下锅焯水，冲洗干净。",
      "排骨、姜和水放汤锅，煮开转小火炖40分钟。",
      "冬瓜去皮切块加入，再炖15分钟至软，最后加盐。"
    ]
  },
  {
    "id": "13",
    "name": "紫菜蛋花汤",
    "category": "汤羹",
    "minutes": 10,
    "servings": 2,
    "ingredients": [
      {
        "name": "紫菜",
        "amount": 5.0,
        "unit": "g"
      },
      {
        "name": "鸡蛋",
        "amount": 2.0,
        "unit": "个"
      },
      {
        "name": "水",
        "amount": 700.0,
        "unit": "ml"
      },
      {
        "name": "盐",
        "amount": 2.0,
        "unit": "g"
      },
      {
        "name": "香油",
        "amount": 3.0,
        "unit": "ml"
      }
    ],
    "steps": [
      "紫菜按包装说明清理，鸡蛋打散。",
      "水煮开，放紫菜煮1分钟。",
      "缓缓淋入蛋液，待蛋花凝固煮熟后加盐与香油。"
    ]
  },
  {
    "id": "14",
    "name": "番茄牛腩",
    "category": "荤菜",
    "minutes": 100,
    "servings": 2,
    "ingredients": [
      {
        "name": "牛腩",
        "amount": 400.0,
        "unit": "g"
      },
      {
        "name": "番茄",
        "amount": 400.0,
        "unit": "g"
      },
      {
        "name": "姜",
        "amount": 15.0,
        "unit": "g"
      },
      {
        "name": "生抽",
        "amount": 15.0,
        "unit": "ml"
      },
      {
        "name": "盐",
        "amount": 2.0,
        "unit": "g"
      },
      {
        "name": "油",
        "amount": 10.0,
        "unit": "ml"
      }
    ],
    "steps": [
      "牛腩切块焯水，番茄切块。",
      "热油炒香姜和一半番茄，炒软后加入牛腩。",
      "加生抽和没过食材的热水，小火炖80分钟至软烂。",
      "加入剩余番茄再煮10分钟，加盐调味。"
    ]
  },
  {
    "id": "15",
    "name": "黄瓜拌木耳",
    "category": "凉菜",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "name": "黄瓜",
        "amount": 250.0,
        "unit": "g"
      },
      {
        "name": "干木耳",
        "amount": 10.0,
        "unit": "g"
      },
      {
        "name": "蒜",
        "amount": 10.0,
        "unit": "g"
      },
      {
        "name": "生抽",
        "amount": 10.0,
        "unit": "ml"
      },
      {
        "name": "醋",
        "amount": 15.0,
        "unit": "ml"
      },
      {
        "name": "香油",
        "amount": 5.0,
        "unit": "ml"
      }
    ],
    "steps": [
      "干木耳冷水泡发后去根洗净，泡发时间遵循包装说明，不隔夜常温浸泡。",
      "木耳沸水煮3至5分钟至熟，沥干放凉。",
      "黄瓜拍碎切段，与木耳、蒜末及调味料拌匀，即做即吃。"
    ]
  },
  {
    "id": "16",
    "name": "葱油拌面",
    "category": "主食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "name": "面条",
        "amount": 200.0,
        "unit": "g"
      },
      {
        "name": "小葱",
        "amount": 40.0,
        "unit": "g"
      },
      {
        "name": "油",
        "amount": 20.0,
        "unit": "ml"
      },
      {
        "name": "生抽",
        "amount": 15.0,
        "unit": "ml"
      },
      {
        "name": "老抽",
        "amount": 5.0,
        "unit": "ml"
      },
      {
        "name": "糖",
        "amount": 3.0,
        "unit": "g"
      }
    ],
    "steps": [
      "小葱切段，擦干水分。",
      "油中小火熬葱段至金黄，加入生抽、老抽、糖和20ml水煮开。",
      "面条按包装时间煮熟沥干，拌入葱油汁。"
    ]
  },
  {
    "id": "17",
    "name": "蛋炒饭",
    "category": "主食",
    "minutes": 15,
    "servings": 2,
    "ingredients": [
      {
        "name": "熟米饭",
        "amount": 400.0,
        "unit": "g"
      },
      {
        "name": "鸡蛋",
        "amount": 2.0,
        "unit": "个"
      },
      {
        "name": "胡萝卜",
        "amount": 80.0,
        "unit": "g"
      },
      {
        "name": "豌豆",
        "amount": 60.0,
        "unit": "g"
      },
      {
        "name": "油",
        "amount": 15.0,
        "unit": "ml"
      },
      {
        "name": "盐",
        "amount": 2.0,
        "unit": "g"
      }
    ],
    "steps": [
      "使用妥善冷藏的熟米饭，胡萝卜切丁，豌豆与胡萝卜焯熟。",
      "热油将蛋液炒散。",
      "加入米饭炒散，再加蔬菜和盐。",
      "持续翻炒至米饭中心也充分热透，即炒即吃。"
    ]
  },
  {
    "id": "18",
    "name": "咖喱鸡肉饭",
    "category": "主食",
    "minutes": 35,
    "servings": 2,
    "ingredients": [
      {
        "name": "鸡腿肉",
        "amount": 250.0,
        "unit": "g"
      },
      {
        "name": "土豆",
        "amount": 200.0,
        "unit": "g"
      },
      {
        "name": "胡萝卜",
        "amount": 100.0,
        "unit": "g"
      },
      {
        "name": "洋葱",
        "amount": 100.0,
        "unit": "g"
      },
      {
        "name": "咖喱块",
        "amount": 40.0,
        "unit": "g"
      },
      {
        "name": "熟米饭",
        "amount": 400.0,
        "unit": "g"
      },
      {
        "name": "油",
        "amount": 10.0,
        "unit": "ml"
      }
    ],
    "steps": [
      "鸡肉和蔬菜切块，热油炒香洋葱。",
      "下鸡肉翻炒，加入土豆、胡萝卜及400ml水。",
      "煮开后小火炖20分钟至鸡肉熟透、土豆软。",
      "关小火拌入咖喱块，煮浓稠后浇在热米饭上。"
    ]
  },
  {
    "id": "19",
    "name": "香煎豆腐",
    "category": "素食",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "name": "老豆腐",
        "amount": 400.0,
        "unit": "g"
      },
      {
        "name": "生抽",
        "amount": 15.0,
        "unit": "ml"
      },
      {
        "name": "糖",
        "amount": 3.0,
        "unit": "g"
      },
      {
        "name": "淀粉",
        "amount": 5.0,
        "unit": "g"
      },
      {
        "name": "油",
        "amount": 15.0,
        "unit": "ml"
      },
      {
        "name": "葱",
        "amount": 10.0,
        "unit": "g"
      }
    ],
    "steps": [
      "豆腐切厚片擦干，调味料加80ml水拌成汁。",
      "平底锅放油，两面煎至金黄。",
      "倒入料汁，小火煮3至5分钟，撒葱花出锅。"
    ]
  },
  {
    "id": "20",
    "name": "小米南瓜粥",
    "category": "主食",
    "minutes": 35,
    "servings": 2,
    "ingredients": [
      {
        "name": "小米",
        "amount": 80.0,
        "unit": "g"
      },
      {
        "name": "南瓜",
        "amount": 200.0,
        "unit": "g"
      },
      {
        "name": "水",
        "amount": 900.0,
        "unit": "ml"
      }
    ],
    "steps": [
      "小米淘洗，南瓜去皮切小块。",
      "水煮开，下小米再次煮沸，转小火煮15分钟。",
      "加入南瓜煮15分钟至软，期间搅拌防粘底。"
    ]
  },
  {
    "id": "21",
    "name": "蚝油生菜",
    "category": "素食",
    "minutes": 10,
    "servings": 2,
    "ingredients": [
      {
        "name": "生菜",
        "amount": 300.0,
        "unit": "g"
      },
      {
        "name": "蒜",
        "amount": 10.0,
        "unit": "g"
      },
      {
        "name": "蚝油",
        "amount": 15.0,
        "unit": "g"
      },
      {
        "name": "油",
        "amount": 10.0,
        "unit": "ml"
      },
      {
        "name": "水",
        "amount": 40.0,
        "unit": "ml"
      }
    ],
    "steps": [
      "生菜逐叶洗净，蒜切末。",
      "沸水焯生菜约30至60秒至断生，沥水装盘。",
      "热油炒蒜末，加入蚝油与水煮开，淋在生菜上。"
    ]
  },
  {
    "id": "22",
    "name": "青椒肉丝",
    "category": "荤菜",
    "minutes": 20,
    "servings": 2,
    "ingredients": [
      {
        "name": "猪里脊",
        "amount": 200.0,
        "unit": "g"
      },
      {
        "name": "青椒",
        "amount": 200.0,
        "unit": "g"
      },
      {
        "name": "生抽",
        "amount": 15.0,
        "unit": "ml"
      },
      {
        "name": "淀粉",
        "amount": 5.0,
        "unit": "g"
      },
      {
        "name": "油",
        "amount": 15.0,
        "unit": "ml"
      },
      {
        "name": "姜",
        "amount": 5.0,
        "unit": "g"
      }
    ],
    "steps": [
      "肉切丝，用一半生抽与淀粉腌10分钟；青椒切丝。",
      "热油炒香姜丝，下肉丝炒至熟透盛出。",
      "青椒炒断生，回锅肉丝，加剩余生抽翻匀。"
    ]
  },
  {
    "id": "23",
    "name": "山药玉米汤",
    "category": "汤羹",
    "minutes": 30,
    "servings": 2,
    "ingredients": [
      {
        "name": "山药",
        "amount": 200.0,
        "unit": "g"
      },
      {
        "name": "玉米",
        "amount": 1.0,
        "unit": "根"
      },
      {
        "name": "胡萝卜",
        "amount": 100.0,
        "unit": "g"
      },
      {
        "name": "水",
        "amount": 900.0,
        "unit": "ml"
      },
      {
        "name": "盐",
        "amount": 2.0,
        "unit": "g"
      }
    ],
    "steps": [
      "山药戴手套去皮切段，玉米切段，胡萝卜切块。",
      "锅中加水和玉米、胡萝卜，煮开转小火15分钟。",
      "加入山药再煮10至15分钟至软熟，加盐。"
    ]
  },
  {
    "id": "24",
    "name": "土豆炖豆角",
    "category": "素食",
    "minutes": 35,
    "servings": 2,
    "ingredients": [
      {
        "name": "土豆",
        "amount": 250.0,
        "unit": "g"
      },
      {
        "name": "四季豆",
        "amount": 250.0,
        "unit": "g"
      },
      {
        "name": "蒜",
        "amount": 10.0,
        "unit": "g"
      },
      {
        "name": "生抽",
        "amount": 15.0,
        "unit": "ml"
      },
      {
        "name": "油",
        "amount": 15.0,
        "unit": "ml"
      }
    ],
    "steps": [
      "四季豆去筋掰段，土豆切块。",
      "热油炒香蒜末，下土豆与四季豆翻炒。",
      "加生抽与300ml水，加盖小火炖20分钟以上。",
      "确认四季豆完全熟透、没有生硬感后再收汁。"
    ]
  }
];
