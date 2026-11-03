export interface RecipePhoto {
  src: string;
  author: string;
  license: string;
  sourceUrl: string;
  note?: string;
}

/** Finished-dish references from Wikimedia Commons. Photos are unmodified. */
export const recipeMedia: Record<string, RecipePhoto> = {
  "1": {
    src: "/recipe-media/1.jpg",
    author: "Huangdan2060",
    license: "CC BY 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Hunan_cuisine,_stir-fried_tomato_with_eggs.jpg",
    note: "装盘里有少量葱花。",
  },
  "3": {
    src: "/recipe-media/3.jpg",
    author: "Steven G. Johnson",
    license: "CC BY-SA 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Kung-pao-shanghai.jpg",
    note: "照片是花生配葱段的做法；本配方用黄瓜丁。",
  },
  "4": {
    src: "/recipe-media/4.jpg",
    author: "Wuzhiya",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:%E5%8F%AF%E4%B9%90%E9%B8%A1%E7%BF%85.jpg",
  },
  "5": {
    src: "/recipe-media/5.jpg",
    author: "FotoosVanRobin",
    license: "CC BY 2.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:%E7%B4%85%E7%87%92%E8%82%89_Braised_pork_in_brown_sauce.jpg",
    note: "照片配了米饭和青菜，配方本身是红烧肉。",
  },
  "7": {
    src: "/recipe-media/7.jpg",
    author: "Walter Grassroot",
    license: "CC BY-SA 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:%E6%B8%85%E8%92%B8%E9%B2%88%E9%B1%BC.jpg",
  },
  "10": {
    src: "/recipe-media/10.jpg",
    author: "Archon6812",
    license: "CC BY-SA 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Billyfoodmabodofu3.jpg",
  },
  "11": {
    src: "/recipe-media/11.jpg",
    author: "Tam3415",
    license: "CC BY-SA 2.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:ChineseSteamedEgg.jpg",
    note: "照片是葱花蒸蛋；本配方会再放上虾仁蒸熟。",
  },
  "16": {
    src: "/recipe-media/16.jpg",
    author: "Suginami",
    license: "CC0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:%E8%91%B1%E8%8A%B1%E8%91%B1%E6%B2%B9%E6%8B%8C%E9%9D%A2.jpg",
    note: "照片还撒了芝麻，配方里没有。",
  },
  "17": {
    src: "/recipe-media/17.jpg",
    author: "ProjectManhattan",
    license: "CC BY-SA 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Egg_fried_rice.jpg",
    note: "照片里有火腿；本配方用胡萝卜丁和豌豆。",
  },
  "18": {
    src: "/recipe-media/18.jpg",
    author: "wizdata",
    license: "CC0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Curry_rice.jpg",
    note: "照片看得到土豆和胡萝卜咖喱配饭；本配方还会加入鸡腿肉。",
  },
};
