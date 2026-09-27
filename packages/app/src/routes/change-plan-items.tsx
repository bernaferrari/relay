/** @jsxImportSource react */
import type { ProductVerificationItem } from "@relay/product/change-journey";
import type { ProductChangeDetail } from "../data/change-product-service";

export function VerificationItem({
  item,
  detail,
}: {
  item: ProductVerificationItem;
  detail: ProductChangeDetail;
}) {
  const test = detail.names.tests[`${item.appId}:${item.testId}`] ?? humanize(item.testId);
  return (
    <li className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <strong className="block text-sm font-medium text-foreground">{test}</strong>
      <span className="mt-0.5 block text-sm text-muted-foreground">
        {item.targetName} · {platformLabel(item.platform)}
      </span>
    </li>
  );
}

function humanize(value: string): string {
  const spaced = value
    .replaceAll(/[-_.]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : "Unnamed";
}

function platformLabel(platform: ProductVerificationItem["platform"]): string {
  if (platform === "ios") return "iOS";
  if (platform === "android") return "Android";
  return "Browser";
}
