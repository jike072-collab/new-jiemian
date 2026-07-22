export const malaysiaShoeCopyCategories = [
  { id: "auto", label: "Auto", signals: ["unclear or mixed shoe content"] },
  { id: "sports", label: "Sports and running", signals: ["running shoe", "trainer", "jogging", "brisk walk", "gym"] },
  { id: "women", label: "Women's shoes", signals: ["women's sneaker", "flat", "ballet shoe", "heel", "sandal"] },
  { id: "men", label: "Men's shoes", signals: ["men's sneaker", "loafer", "formal shoe", "work shoe"] },
  { id: "kids", label: "Kids' shoes", signals: ["baby shoe", "kids' sneaker", "school shoe", "children's sandal"] },
  { id: "safety", label: "Safety and work", signals: ["safety shoe", "work boot", "factory shoe", "protective footwear"] },
  { id: "outdoor", label: "Outdoor and hiking", signals: ["hiking shoe", "trail shoe", "outdoor boot", "trekking"] },
  { id: "casual", label: "Casual and local style", signals: ["daily sneaker", "streetwear", "local brand", "casual outfit"] },
] as const;

export type MalaysiaShoeCopyCategory = (typeof malaysiaShoeCopyCategories)[number]["id"];

type CopyCategoryLibrary = {
  focus: string[];
  hookPatterns: string[];
  ctaPatterns: string[];
  hashtags: string[];
};

export const malaysiaShoeCopyLibrary: Record<Exclude<MalaysiaShoeCopyCategory, "auto">, CopyCategoryLibrary> = {
  sports: {
    focus: ["the clearest colour or silhouette", "the visible activity", "one visible movement or styling detail"],
    hookPatterns: ["reaction to the colourway", "a direct question for runners", "one must-have style observation"],
    ctaPatterns: ["Korang pilih warna mana?", "Team jalan santai atau jogging?", "Look ni ngam dengan outfit apa?"],
    hashtags: ["kasutsukan", "kasutlarian", "kasutjogging", "sportshoes", "runningshoes", "kasutsukanperempuan", "kasutsukanlelaki"],
  },
  women: {
    focus: ["colour combination", "simple or statement styling", "the visible outfit or occasion"],
    hookPatterns: ["a spontaneous colour reaction", "this-is-your-sign phrasing", "simple-but-kemas contrast"],
    ctaPatterns: ["Korang suka warna ni tak?", "Pakai dengan jeans atau dress?", "Design macam ni masuk wishlist tak?"],
    hashtags: ["kasutwanita", "kasutperempuan", "sneakerswanita", "womenshoes", "kasutballerina", "gayakasual", "kasutharian"],
  },
  men: {
    focus: ["clean silhouette", "casual or work styling", "the strongest visible colour detail"],
    hookPatterns: ["lelaki wajib tengok without a fake claim", "kemas-without-trying reaction", "a work-versus-casual choice"],
    ctaPatterns: ["Korang pilih casual atau smart?", "Warna ni senang match tak?", "Pair ni masuk rotation korang?"],
    hashtags: ["kasutlelaki", "kasutkasual", "kasutkerjalelaki", "menshoes", "mensfashion", "sneakerstyle", "kasutsukanlelaki"],
  },
  kids: {
    focus: ["visible cuteness or colour", "the child's visible activity", "school, play or outing only when shown"],
    hookPatterns: ["mak-mak attention hook", "comel reaction", "a simple choice for si kecil"],
    ctaPatterns: ["Mak-mak pilih warna mana?", "Si kecil mesti suka warna ni kan?", "Untuk sekolah atau jalan-jalan?"],
    hashtags: ["kasutkanakkanak", "kasutbudak", "kasutanak", "kasutbaby", "kidshoes", "kasutsekolah", "kasutsukanbudak"],
  },
  safety: {
    focus: ["work-shoe appearance", "a demonstrated closure or construction detail", "the visible work setting"],
    hookPatterns: ["looks-like-a-normal-shoe contrast", "direct question for workers", "one demonstrated feature only"],
    ctaPatterns: ["Korang kerja bidang apa?", "Design macam ni nampak kemas tak?", "Team kasut kerja low-cut atau boot?"],
    hashtags: ["kasutsafety", "safetyshoes", "kasutkerja", "kasutkerjalelaki", "workshoes", "safetyboot", "workwear"],
  },
  outdoor: {
    focus: ["trail-ready visual design", "the shown terrain or activity", "one visible outdoor detail"],
    hookPatterns: ["geng outdoor callout", "style-meets-trail observation", "a hiking-versus-daily choice"],
    ctaPatterns: ["Korang team hiking atau trekking?", "Trail macam mana korang selalu pergi?", "Warna ni ngam untuk outdoor tak?"],
    hashtags: ["kasuthiking", "kasutoutdoor", "hikingshoes", "hiking", "trekking", "outdoorshoes", "hikingmalaysia"],
  },
  casual: {
    focus: ["everyday styling", "local-brand identity only when visible", "colour and outfit pairing"],
    hookPatterns: ["simple-but-standout reaction", "daily rotation observation", "one local-style angle"],
    ctaPatterns: ["Korang match dengan outfit apa?", "Warna ni boleh masuk daily rotation tak?", "Simple atau bold, korang pilih mana?"],
    hashtags: ["kasutharian", "kasutviral", "gayakasual", "sneakers", "streetwear", "lokalbrand", "kasutviralmy"],
  },
};

export const malaysiaShoeCopySharedLibrary = {
  reviewedAt: "2026-07-22",
  market: "Malaysia",
  voice: ["natural Bahasa Melayu with light English mixing", "short spoken phrasing", "one sales angle per caption"],
  naturalWords: ["ni", "je", "tau", "korang", "ualls", "kemas", "comel", "padu", "wajib ada"],
  hookPatterns: ["first-look reaction", "colour reaction", "scene fit", "choice question", "reply-to-comment only when supported"],
  ctaPatterns: ["ask for a colour choice", "ask how viewers would style it", "ask which use case fits them"],
  evidenceOnlyClaims: [
    "brand",
    "price",
    "discount",
    "stock or sold-out status",
    "material",
    "size or fit",
    "comfort",
    "weight",
    "anti-slip, waterproof or protective performance",
    "durability",
    "sales or social proof",
  ],
  unrelatedTrendHashtags: ["rainbowpfp", "spain", "final"],
  hashtagRules: ["use 4-6 relevant tags", "mix category, audience and content tags", "do not add #fyp by default", "never add unrelated trending tags"],
  goodStructureExamples: [
    {
      category: "sports",
      title: "Color ni terus bagi look lain",
      caption: "Simple, kemas, tapi tetap nampak standout. Korang pilih warna mana?",
      hashtags: ["#kasutsukan", "#kasutviral", "#sportshoes", "#kasutwanita", "#kasutviralmy"],
    },
    {
      category: "kids",
      title: "Comelnya bila si kecil pakai ni",
      caption: "Warna dia memang terus tarik mata. Mak-mak pilih yang mana?",
      hashtags: ["#kasutkanakkanak", "#kasutbudak", "#kidshoes", "#kasutanak"],
    },
    {
      category: "safety",
      title: "Sekali tengok macam kasut biasa je",
      caption: "Design dia nampak kemas untuk gaya kerja. Korang team low-cut atau boot?",
      hashtags: ["#kasutsafety", "#safetyshoes", "#kasutkerja", "#workshoes"],
    },
  ],
} as const;

export function malaysiaShoeCopyCategory(value: unknown): MalaysiaShoeCopyCategory {
  return malaysiaShoeCopyCategories.some((category) => category.id === value)
    ? value as MalaysiaShoeCopyCategory
    : "auto";
}

export function malaysiaShoeCopyHashtagPool(category: MalaysiaShoeCopyCategory) {
  return category === "auto" ? ["kasut", "kasutviral", "shoes", "kasutviralmy"] : malaysiaShoeCopyLibrary[category].hashtags;
}

export function malaysiaShoeCopyPromptLibrary() {
  return JSON.stringify({
    shared: malaysiaShoeCopySharedLibrary,
    categories: malaysiaShoeCopyCategories.filter((category) => category.id !== "auto").map((category) => ({
      ...category,
      ...malaysiaShoeCopyLibrary[category.id as Exclude<MalaysiaShoeCopyCategory, "auto">],
    })),
  });
}
