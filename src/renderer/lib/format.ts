import type { ProviderModel, RunStatus } from "@shared/types";

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "Never";
  }
  return new Date(value).toLocaleString();
}

export function formatRelativeTime(value: string): string {
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatTokenPrice(value: number | null, direction: "input" | "output"): string {
  if (value === null) {
    return `${direction} n/a`;
  }
  if (value === 0) {
    return `${direction} free`;
  }
  const pricePerMillionTokens = value * 1_000_000;
  const formattedPrice =
    pricePerMillionTokens >= 1 ? pricePerMillionTokens.toFixed(2) : pricePerMillionTokens.toPrecision(3);
  return `$${formattedPrice}/1M ${direction} tok`;
}

export function groupModels(models: ProviderModel[]): Array<[string, ProviderModel[]]> {
  const grouped = new Map<string, ProviderModel[]>();
  for (const model of models) {
    const current = grouped.get(model.provider) ?? [];
    current.push(model);
    grouped.set(model.provider, current);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
}

export function statusLabel(status: RunStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Complete";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Idle";
  }
}
