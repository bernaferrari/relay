/** Generic iOS hardware classification used when evidence stamps its capture surface. */

export const IOS_HARDWARE_CLASSES = [
  "physical-ipad",
  "physical-iphone",
  "simulator",
  "unproven",
] as const;
export type IosHardwareClass = (typeof IOS_HARDWARE_CLASSES)[number];

export function classifyIosHardware(input: {
  kind?: string;
  name?: string;
  device?: string;
  serial?: string;
  approximation?: "simulator" | "emulator" | "browser";
}): IosHardwareClass {
  if (input.approximation === "simulator") return "simulator";
  const blob = `${input.kind ?? ""} ${input.name ?? ""} ${input.device ?? ""}`;
  if (/simulator/iu.test(blob)) return "simulator";
  if (/ipad/iu.test(blob)) return "physical-ipad";
  if (/iphone|ipod/iu.test(blob)) return "physical-iphone";
  return "unproven";
}

/** One hardware class does not cover another; unproven covers nothing. */
export function iosHardwareCovers(observed: IosHardwareClass, claimed: IosHardwareClass): boolean {
  if (observed === "unproven" || claimed === "unproven") return false;
  return observed === claimed;
}

export function iosHardwareLabel(value: IosHardwareClass): string {
  if (value === "physical-ipad") return "physical iPad";
  if (value === "physical-iphone") return "physical iPhone";
  if (value === "simulator") return "iOS simulator";
  return "unproven iOS hardware";
}
