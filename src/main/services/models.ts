import type { ProviderModel } from "@shared/types";

interface OpenRouterModelsResponse {
  data: Array<{
    id: string;
    name: string;
    description?: string;
    context_length?: number;
    pricing?: {
      prompt?: string;
      completion?: string;
    };
    architecture?: {
      modality?: string;
      tokenizer?: string;
      instruct_type?: string;
    };
  }>;
}

function parsePrice(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveTags(model: ProviderModel): string[] {
  const tags = new Set<string>();
  if (model.contextLength >= 200_000) {
    tags.add("long-context");
  }
  if ((model.promptPrice ?? 0) <= 0.0000015) {
    tags.add("budget");
  }
  if (model.provider.includes("openai") || model.provider.includes("anthropic")) {
    tags.add("frontier");
  }
  if (model.id.includes("vision")) {
    tags.add("vision");
  }
  return [...tags];
}

export async function fetchOpenRouterModels(apiKey: string | null): Promise<ProviderModel[]> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: apiKey
      ? {
          Authorization: `Bearer ${apiKey}`
        }
      : undefined
  });

  if (!response.ok) {
    throw new Error(`OpenRouter model fetch failed (${response.status}).`);
  }

  const payload = (await response.json()) as OpenRouterModelsResponse;
  return payload.data
    .map((item) => {
      const provider = item.id.split("/")[0] ?? "unknown";
      const model: ProviderModel = {
        id: item.id,
        name: item.name || item.id,
        provider,
        contextLength: item.context_length ?? 0,
        description: item.description ?? null,
        promptPrice: parsePrice(item.pricing?.prompt),
        completionPrice: parsePrice(item.pricing?.completion),
        tags: []
      };
      return {
        ...model,
        tags: deriveTags(model)
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}
