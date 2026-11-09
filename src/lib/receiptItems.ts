// The item lines of a store receipt (Costco, Walmart, Target, Indian grocers),
// what kind of spending each one is, and how a bill's total splits across
// categories. Pure, so it can be tested alone; text comes from on-phone OCR.

export type ReceiptItem = { name: string; amount: number; code: string | null };

export type ItemKind = "GROCERIES" | "FOOD" | "CLOTHING" | "HOME" | "PERSONAL_CARE" | "MEDICAL" | "GAS" | "SHOPPING";

// Lines that carry money but aren't items.
const NOT_ITEM =
  /sub\s*-?\s*total|\btotal\b|\btax(es)?\b|\b[cs]?gst\b|\bvat\b|\bchange\b|\bbalance\b|\bcash\b|\btender|\bvisa\b|\bmaster\s*card\b|\bamex\b|\bdiscover\b|\bdebit\b|\bcredit\b|\bpayment\b|\bapproved\b|\bauth\b|\bitems?\s*sold\b|\bnumber of items\b|\bmember\b|\bsav(ed|ings)\s*(today|total)?\s*$|\byou saved\b|\brebate\b|\bpoints?\b|\brewards?\b|\bref\s*#|\btran(s|saction)\b|\bacct\b|\bterminal\b|\bchip\b|\bpurchase\b|\bamount\b/i;
const PRICE = /(\d{1,5}\.\d{2})\s*(-)?\s*[A-Z]{0,2}\s*$/;

function cleanName(raw: string): { name: string; code: string | null } {
  let s = raw.replace(/\s+/g, " ").trim();
  // Costco's "E " (eligible) flag and leading item numbers; Walmart's UPCs.
  s = s.replace(/^[A-Z]\s+(?=\d)/, "");
  const code = s.match(/^\/?\s*(\d{4,})\b/)?.[1] ?? null;
  s = s.replace(/^\/?\s*\d{4,}\s*/, "").replace(/\b\d{8,}[A-Z]{0,2}\b/g, "").replace(/\s+[A-Z]$/, "");
  return { name: s.replace(/[^A-Za-z0-9&%'./ -]+/g, " ").replace(/\s+/g, " ").trim(), code };
}

export function parseReceiptItems(text: string): ReceiptItem[] {
  const items: ReceiptItem[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/(\d)\s+\.\s*(\d{2})\b/g, "$1.$2").trim();
    const m = line.match(PRICE);
    if (!m) continue;
    const before = line.slice(0, m.index).trim();
    if (NOT_ITEM.test(before)) continue;
    // "2 @ 3.49", "1.23 lb @ 0.58/lb": the price line for the item above.
    if (/@/.test(before) && !/[a-z]{3,}/i.test(before.replace(/\b(lb|lbs|kg|ea|oz)\b/gi, ""))) continue;
    const amount = Number(m[1]);
    const negative = !!m[2] || /^\s*\//.test(before) || /\b(instant savings|coupon|discount|tpd|markdown|savings)\b/i.test(before);
    const { name, code } = cleanName(before);
    if (negative) {
      // A discount: off the item whose number it names, else the one above.
      const ref = before.match(/\/\s*(\d{4,})/)?.[1];
      const target = (ref && [...items].reverse().find((i) => i.code === ref)) || items[items.length - 1];
      if (target) target.amount = Math.round((target.amount - amount) * 100) / 100;
      continue;
    }
    if ((name.match(/[a-z]/gi) ?? []).length < 2 || amount <= 0) continue;
    items.push({ name, amount, code });
  }
  return items.filter((i) => i.amount > 0);
}

// ---- what an item is -------------------------------------------------------

const K = (words: string) => new RegExp(`\\b(${words})`, "i");
const KINDS: [ItemKind, RegExp][] = [
  ["CLOTHING", K("shirt|tee\\b|t-shirt|polo|blouse|top\\b|pant|jean|jogger|legging|short\\b|shorts|sock|underwear|boxer|brief|bra\\b|jacket|coat|hoodie|sweater|sweatshirt|fleece|vest|dress|skirt|kurta|saree|pajama|pjs|sleepwear|robe|shoe|sneaker|sandal|slipper|boot|hat\\b|cap\\b|beanie|glove|scarf|apparel|mens\\b|men's|womens|women's|wmns|ladies|boys\\b|girls\\b|kids'? (wear|apparel)|toddler|32 degrees|george\\b|old navy|carter")],
  ["MEDICAL", K("vitamin|multivit|supplement|fish oil|omega|probiotic|ibuprofen|acetaminophen|tylenol|advil|motrin|aleve|aspirin|allergy|zyrtec|claritin|allegra|cetirizine|loratadine|antacid|tums|pepcid|nexium|cough|cold & flu|mucinex|nyquil|bandage|band-aid|first aid|thermometer|rx\\b|pharmacy|prescription|contact lens|eye drop|insulin|glucose")],
  ["PERSONAL_CARE", K("shampoo|conditioner|body wash|soap|hand wash|toothpaste|toothbrush|floss|mouthwash|listerine|crest|colgate|oral-?b|deodorant|antiperspirant|razor|shave|gillette|lotion|moistur|sunscreen|cosmetic|makeup|cotton|q-?tip|feminine|tampon|\\bpads?\\b|diaper|wipes|huggies|pampers|hair oil|hair color|dove\\b|nivea|cetaphil|aveeno")],
  ["HOME", K("paper towel|bath tissue|toilet paper|\\btp\\b|\\bpt\\b|tissue|napkin|kleenex|bounty|charmin|detergent|tide\\b|gain\\b|downy|dryer sheet|fabric|bleach|clorox|lysol|cleaner|disinfect|dish|dawn\\b|cascade|finish\\b|sponge|trash bag|garbage bag|glad\\b|hefty|foil|plastic wrap|ziploc|storage bag|food storage|battery|batteries|light bulb|bulb\\b|air filter|candle|air freshener|febreze|laundry|mop|broom|vacuum|towel|pillow|sheet set|blanket|comforter|hanger|storage bin|kitchen|cookware|pan\\b|pot\\b|knife|utensil|plates?\\b|cups?\\b|plants?\\b|soil|fertil|pest|ant trap")],
  ["GAS", K("unleaded|premium gas|regular gas|diesel|gasoline|fuel|pump\\s*#?\\d")],
  ["FOOD", K("food court|hot dog|pizza slice|whole pizza|chicken bake|churro|soda fountain|fountain drink|frozen yogurt|sundae|acai bowl|combo meal|meal deal|cafe|coffee drink|latte|frappuccino|smoothie bowl")],
  ["SHOPPING", K("tv\\b|television|laptop|ipad|iphone|tablet|headphone|airpods|earbud|speaker|charger|cable|hdmi|usb|printer|ink\\b|toner|camera|monitor|keyboard|mouse\\b|router|game|playstation|xbox|nintendo|toy|lego|book|gift card|card\\b|wrapping|stationery|pen\\b|pens\\b|notebook|backpack|luggage|suitcase|tool|drill|garden hose|furniture|chair|table\\b|lamp|rug\\b|mattress|appliance|blender|instant pot|air fryer")],
  ["GROCERIES", K("banana|apple|orange|mandarin|clementine|grape|berr|strawb|strwb|blueb|blub|raspb|blackb|cherr|mango|pineapple|kiwi|melon|watermelon|peach|pear|plum|lemon|lime|avocado|tomato|onion|potato|garlic|ginger|carrot|broccoli|cauliflower|spinach|lettuce|salad|cucumber|pepper|capsicum|okra|bhindi|eggplant|brinjal|cabbage|celery|corn|beans|peas|cilantro|coriander|mint|methi|produce|organic|\\borg\\b|fruit|veg|milk|eggs?\\b|cheese|yogurt|yoghurt|curd|paneer|butter|ghee|cream|dahi|bread|bagel|tortilla|naan|roti|chapati|rice|basmati|atta|flour|maida|sooji|rava|dal\\b|lentil|toor|moong|urad|chana|rajma|besan|poha|oats|cereal|granola|pasta|noodle|maggi|sugar|jaggery|salt|spice|masala|turmeric|haldi|chilli|chili|cumin|jeera|mustard|oil\\b|olive|canola|sunflower|chicken|chkn|beef|pork|lamb|mutton|goat|fish|salmon|shrimp|prawn|tuna|turkey|bacon|sausage|meat|tofu|frozen|ice cream|juice|water\\b|sparkling|soda|coke|pepsi|sprite|tea\\b|chai|coffee|k-?cup|honey|jam|peanut butter|nutella|ketchup|sauce|pickle|achar|chutney|soup|broth|snack|chip|crisps|cracker|cookie|biscuit|chocolate|candy|gummies|nuts|almond|cashew|pistachio|walnut|peanut|trail mix|popcorn|pretzel|granola bar|protein bar|kirkland signature|\\bks\\b|great value|\\bgv\\b|marketside|good & gather|haldiram|mtr\\b|deep\\b|laxmi|swad")],
];

export function classifyItem(name: string): ItemKind | null {
  for (const [kind, re] of KINDS) if (re.test(name)) return kind;
  return null;
}

// The household's category for each kind: best name first; `create` names a
// new one to add when none fits (only Clothing, as agreed, and only on save).
export const KIND_CATEGORY: Record<ItemKind, { patterns: RegExp[]; create: string | null; label: string }> = {
  GROCERIES: { patterns: [/grocer/i, /kirana/i, /^food\b/i], create: "Groceries", label: "Groceries" },
  FOOD: { patterns: [/^(food|dining|restaurants?|eating out)\b/i], create: null, label: "Food" },
  CLOTHING: { patterns: [/cloth|apparel|dress/i], create: "Clothing", label: "Clothing" },
  HOME: { patterns: [/household/i, /^home\b/i, /home/i], create: null, label: "Home" },
  PERSONAL_CARE: { patterns: [/personal care|toiletr|beauty/i], create: null, label: "Personal Care" },
  MEDICAL: { patterns: [/medic|health|pharm/i], create: null, label: "Medical" },
  GAS: { patterns: [/^(gas|fuel|petrol)\b/i], create: null, label: "Gas" },
  SHOPPING: { patterns: [/shopping/i, /^misc/i, /other expense/i], create: null, label: "Shopping" },
};

// Where an item goes when it fits nowhere, or its kind has no category here.
const FALLBACK: ItemKind[] = ["SHOPPING", "GROCERIES"];

export type Cat = { id: string; name: string };
export const NEW_PREFIX = "new:";

export function categoryForKind(kind: ItemKind | null, cats: Cat[]): string | null {
  const tries = kind ? [kind, ...FALLBACK] : ["GROCERIES" as ItemKind, ...FALLBACK];
  for (const k of tries) {
    for (const re of KIND_CATEGORY[k].patterns) {
      const c = cats.find((x) => re.test(x.name.trim()));
      if (c) return c.id;
    }
    // Clothing gets its own category even when there's none yet.
    if (k === "CLOTHING" && KIND_CATEGORY.CLOTHING.create) return `${NEW_PREFIX}${KIND_CATEGORY.CLOTHING.create}`;
  }
  return null;
}

// A stable key for remembering an item's category: "KS ORG STRAWBERRY 2LB"
// and "KS ORG STRAWBERRY 2 LB" are the same item.
export function itemKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\b\d+(\.\d+)?\s*(LB|LBS|OZ|KG|G|ML|L|CT|PK|PACK)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

// Split a total across categories in proportion to their items, to the cent.
// Tax, instant savings and anything OCR missed are spread the same way.
export function allocate(parts: { key: string; amount: number }[], total: number): { key: string; amount: number }[] {
  const positive = parts.filter((p) => p.amount > 0);
  const sum = positive.reduce((t, p) => t + p.amount, 0);
  if (!positive.length || sum <= 0) return [];
  const cents = Math.round(total * 100);
  const out = positive.map((p) => ({ key: p.key, amount: Math.floor((p.amount / sum) * cents) }));
  // Hand out the leftover cents to the biggest shares.
  let left = cents - out.reduce((t, p) => t + p.amount, 0);
  const order = [...out.keys()].sort((a, b) => positive[b].amount - positive[a].amount);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) out[order[i]].amount += 1;
  return out.map((p) => ({ key: p.key, amount: p.amount / 100 }));
}
