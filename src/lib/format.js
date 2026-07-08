// Presentation helpers shared by the popup and the dashboard. Kept here (not
// duplicated per surface) so price/phone/spec formatting stays consistent and
// is unit-testable without a DOM.

const nf = new Intl.NumberFormat("tr-TR");

// Format a price object ({ amount, currency, raw }). `empty` is returned when
// there's nothing to show (popup wants "", the dashboard wants "—").
export function fmtPrice(price, empty = "") {
  if (!price) return empty;
  if (price.amount != null)
    return `${nf.format(price.amount)} ${price.currency || ""}`.trim();
  return price.raw || empty;
}

// national 10-digit -> "0532 111 22 33"
export function fmtPhone(p) {
  const d = String(p || "");
  if (d.length !== 10) return d;
  return `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
}

// The handful of attributes that matter most for a listing's category, in
// priority order. Keys are the exact Turkish labels sahibinden uses in its
// info table (see the live captures under test/.live/sahibinden/).
const SPEC_KEYS = {
  konut: [
    "Oda Sayısı",
    "m² (Net)",
    "m² (Brüt)",
    "Bina Yaşı",
    "Bulunduğu Kat",
    "Isıtma",
    "Aidat (TL)",
    "Eşyalı",
  ],
  ticari: [
    "Türü",
    "m²",
    "Bölüm & Oda Sayısı",
    "Bina Yaşı",
    "Bulunduğu Kat",
    "Isıtma",
    "Yapının Durumu",
    "Aidat (TL)",
  ],
  arsa: [
    "İmar Durumu",
    "m²",
    "m² Fiyatı",
    "Kaks (Emsal)",
    "Ada No",
    "Parsel No",
    "Tapu Durumu",
  ],
  diger: ["m²", "Oda Sayısı", "Bina Yaşı", "İmar Durumu", "Isıtma"],
};

// Compact the verbose sahibinden keys for the one-line summary. Order matters:
// multi-word replacements run before the generic suffix trims.
const SHORTEN = [
  ["Bölüm & Oda Sayısı", "Bölüm/Oda"],
  ["Bulunduğu Kat", "Kat"],
  ["Kaks (Emsal)", "Kaks"],
  [" (Brüt)", " br."],
  [" (Net)", " net"],
  [" (TL)", ""],
  [" Sayısı", ""],
];

function shortKey(key) {
  let k = key;
  for (const [from, to] of SHORTEN) k = k.replace(from, to);
  return k;
}

// A " · "-joined summary of the top `max` category-relevant attributes present.
export function specLine(attrs, category, max = 5) {
  if (!attrs) return "";
  const keys = SPEC_KEYS[category] || SPEC_KEYS.diger;
  return keys
    .filter((k) => attrs[k])
    .slice(0, max)
    .map((k) => `${shortKey(k)}: ${attrs[k]}`)
    .join(" · ");
}
