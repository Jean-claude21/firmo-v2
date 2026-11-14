// Couleurs dérivées de la couleur de marque : texte lisible dessus (contraste AA) et teinte douce.

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function hex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Mélange vers le blanc : 0 = couleur, 1 = blanc. */
export function mix(color: string, amount: number): string {
  const [r, g, b] = rgb(color);
  return hex([r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount]);
}

/** Assombrit jusqu'à un contraste AA (4,5) sur blanc : une couleur trop claire reste lisible. */
export function readableOnWhite(color: string): string {
  let c = color;
  for (let i = 0; i < 20 && contrast(c, "#FFFFFF") < 4.5; i++) {
    const [r, g, b] = rgb(c);
    c = hex([r * 0.85, g * 0.85, b * 0.85]);
  }
  return c;
}

export function palette(brandColor: string) {
  // Fond : la couleur choisie par l'artisan, telle quelle ; texte posé dessus : noir ou blanc
  // selon le meilleur contraste. Textes colorés sur blanc : version assombrie (AA).
  const brand = /^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor.toUpperCase() : "#1F3A5F";
  return {
    brand,
    onBrand: contrast(brand, "#FFFFFF") >= contrast(brand, "#111827") ? "#FFFFFF" : "#111827",
    accent: readableOnWhite(brand),
    tint: mix(brand, 0.92),
    ink: "#1A1D23",
    muted: "#5B6170",
    line: "#D9DCE3",
  };
}
