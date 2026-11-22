/** HTML entities accepted in JSX text and attribute strings. */
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lbrace: "{",
  rbrace: "}",
  times: "×",
  divide: "÷",
  middot: "·",
  bull: "•",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  minus: "−",
  plusmn: "±",
  deg: "°",
  le: "≤",
  ge: "≥",
  ne: "≠",
  asymp: "≈",
  infin: "∞",
  sum: "∑",
  prod: "∏",
  radic: "√",
  part: "∂",
  nabla: "∇",
  isin: "∈",
  oplus: "⊕",
  otimes: "⊗",
  odot: "⊙",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  harr: "↔",
  lArr: "⇐",
  rArr: "⇒",
  hArr: "⇔",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  phi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Delta: "Δ",
  Sigma: "Σ",
  Omega: "Ω",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED[body] ?? match;
  });
}

/** Escapes `&` only where it would otherwise be read back as an entity. */
export function escapeAmpersands(value: string): string {
  return value.replace(/&(?=#x[0-9a-fA-F]+;|#[0-9]+;|[A-Za-z][A-Za-z0-9]*;)/g, "&amp;");
}
