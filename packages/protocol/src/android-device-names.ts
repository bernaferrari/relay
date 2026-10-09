/** People know their phone as "Galaxy S25", not "SM-S931B". adb reports the
 * hardware model code (with `-` and spaces turned into `_`), so names stored
 * from discovery read like part numbers. This maps the codes whose scheme is
 * stable and documented; anything else keeps its real code, made readable. */

const SAMSUNG_FOLDABLES: Readonly<Record<string, string>> = {
  F936: "Galaxy Z Fold4",
  F946: "Galaxy Z Fold5",
  F956: "Galaxy Z Fold6",
  F966: "Galaxy Z Fold7",
  F721: "Galaxy Z Flip4",
  F731: "Galaxy Z Flip5",
  F741: "Galaxy Z Flip6",
  F761: "Galaxy Z Flip7 FE",
  F766: "Galaxy Z Flip7",
};

/** Galaxy S flagships: SM-S9{generation}{tier}, e.g. S931 = S25, S938 = S25 Ultra. */
const S_GENERATIONS: Readonly<Record<string, string>> = { "0": "22", "1": "23", "2": "24", "3": "25" };
const S_TIERS: Readonly<Record<string, string>> = { "1": "", "6": "+", "7": " Edge", "8": " Ultra" };
/** Galaxy S FE: SM-S7{generation}1. */
const FE_GENERATIONS: Readonly<Record<string, string>> = { "1": "23", "2": "24", "3": "25" };

function samsungName(code: string): string | undefined {
  const body = code.slice(3, 7); // "S931" from "SM-S931B"
  const foldable = SAMSUNG_FOLDABLES[body];
  if (foldable) return foldable;
  const flagship = /^S9(\d)(\d)$/u.exec(body);
  if (flagship) {
    const generation = S_GENERATIONS[flagship[1]!];
    const tier = S_TIERS[flagship[2]!];
    if (generation !== undefined && tier !== undefined) return `Galaxy S${generation}${tier}`;
  }
  const fe = /^S7(\d)1$/u.exec(body);
  if (fe && FE_GENERATIONS[fe[1]!]) return `Galaxy S${FE_GENERATIONS[fe[1]!]} FE`;
  const legacyS21 = /^G99([0168])$/u.exec(body);
  if (legacyS21) {
    return { "0": "Galaxy S21 FE", "1": "Galaxy S21", "6": "Galaxy S21+", "8": "Galaxy S21 Ultra" }[
      legacyS21[1]!
    ];
  }
  // Galaxy A and M: the first two digits are the model number (A546 = A54).
  const midrange = /^([AM])(\d)(\d)\d$/u.exec(body);
  if (midrange) return `Galaxy ${midrange[1]}${midrange[2]}${midrange[3]}`;
  return undefined;
}

/** A human name for an Android model as reported by adb or stored on a Run. */
export function androidDeviceDisplayName(model: string): string {
  const raw = model.trim();
  const samsung = /^SM[\s_-]?([A-Z]\d{3}[A-Z0-9]*)$/iu.exec(raw);
  if (samsung) {
    const code = `SM-${samsung[1]!.toUpperCase()}`;
    return samsungName(code) ?? `Samsung ${code}`;
  }
  return raw.replaceAll("_", " ").replace(/\s+/gu, " ").trim();
}

/** For names already stored on Runs and targets: rewrites only Samsung model
 * codes and leaves every other device or browser name exactly as saved. */
export function readableDeviceName(name: string): string {
  return /^SM[\s_-]?[A-Z]\d{3}[A-Z0-9]*$/iu.test(name.trim()) ? androidDeviceDisplayName(name) : name;
}
