/* A wallet's avatar, drawn from its address: a disc shading between two neighbouring hues, a darker third under it
   and a soft light over it. Every address gets its own, and the same one every time, so a trader is recognisable
   from list to list without a profile picture. */
const SVG = "http://www.w3.org/2000/svg";

// Gradient ids are global to the page, and one wallet can be drawn many times over.
let drawn = 0;

export function walletAvatar(wallet: string): SVGSVGElement {
  const bytes = seed(wallet);
  const hue = (bytes[0] * 256 + bytes[1]) % 360;
  // The second hue sits to either side of the first, which keeps neighbours on the colour wheel apart.
  const spread = (35 + (bytes[2] % 50)) * (bytes[8] & 1 ? 1 : -1);
  const id = `wallet-avatar-${++drawn}`;

  const svg = node("svg", { viewBox: "0 0 80 80", "aria-hidden": "true", focusable: "false" });
  const defs = node("defs", {});
  defs.append(
    gradient("linearGradient", `${id}-base`, { gradientTransform: `rotate(${Math.round((bytes[3] / 255) * 360)} 0.5 0.5)` }, [
      [color(hue, 78, 62), 1],
      [color(hue + spread, 82, 70), 1],
    ]),
    gradient("radialGradient", `${id}-shade`, {}, [
      [color(hue - spread, 70, 42), 0.8],
      [color(hue - spread, 70, 42), 0],
    ]),
    gradient("radialGradient", `${id}-light`, {}, [
      ["#ffffff", 0.65],
      ["#ffffff", 0],
    ]),
  );
  const clip = node("clipPath", { id: `${id}-disc` });
  clip.append(node("circle", { cx: "40", cy: "40", r: "40" }));
  defs.append(clip);

  const disc = node("g", { "clip-path": `url(#${id}-disc)` });
  disc.append(
    node("rect", { width: "80", height: "80", fill: `url(#${id}-base)` }),
    node("circle", { cx: String(55 + (bytes[6] % 30)), cy: String(60 + (bytes[7] % 30)), r: "42", fill: `url(#${id}-shade)` }),
    node("circle", { cx: String(25 + (bytes[4] % 35)), cy: String(18 + (bytes[5] % 30)), r: "30", fill: `url(#${id}-light)` }),
  );
  svg.append(defs, disc);
  return svg;
}

/** Twenty bytes hashed from the whole address. Its own first bytes would do, but vanity addresses share them. */
function seed(wallet: string): number[] {
  const text = wallet.toLowerCase();
  let hash = 2166136261;
  return Array.from({ length: 20 }, (_, index) => {
    for (const char of `${text}:${index}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return hash >>> 8 & 255;
  });
}

function color(hue: number, saturation: number, lightness: number): string {
  return `hsl(${((hue % 360) + 360) % 360}, ${saturation}%, ${lightness}%)`;
}

function gradient(kind: "linearGradient" | "radialGradient", id: string, attributes: Record<string, string>, stops: [string, number][]): SVGElement {
  const element = node(kind, { id, ...attributes });
  stops.forEach(([stopColor, opacity], index) => element.append(node("stop", { offset: String(index), "stop-color": stopColor, "stop-opacity": String(opacity) })));
  return element;
}

function node<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}
