import { SearchIcon, SparklesIcon, ChevronDownIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProviderModel } from "@shared/types";
import { formatPrice, groupModels } from "@renderer/lib/format";

interface ModelPickerProps {
  models: ProviderModel[];
  selectedModelId: string;
  onSelect: (modelId: string) => void;
}

export function ModelPicker({ models, selectedModelId, onSelect }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedModel = models.find((model) => model.id === selectedModelId);
  const filteredModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return models;
    }
    return models.filter((model) => {
      return (
        model.name.toLowerCase().includes(normalized) ||
        model.id.toLowerCase().includes(normalized) ||
        model.provider.toLowerCase().includes(normalized) ||
        model.tags.some((tag) => tag.toLowerCase().includes(normalized))
      );
    });
  }, [models, query]);

  return (
    <div className="model-picker">
      <button className="toolbar-chip model-trigger" type="button" onClick={() => setOpen((value) => !value)}>
        <SparklesIcon size={14} />
        <span className="trigger-copy">
          <strong>{selectedModel?.name ?? "Choose model"}</strong>
          <small>{selectedModel?.provider ?? "OpenRouter catalog"}</small>
        </span>
        <ChevronDownIcon size={14} />
      </button>
      {open ? (
        <div className="model-popover">
          <label className="field model-search">
            <span>Search models</span>
            <div className="search-input">
              <SearchIcon size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="gpt-5, claude, budget, long-context..."
              />
            </div>
          </label>
          <div className="model-groups">
            <button
              type="button"
              className={`model-row quick-row ${selectedModelId === "openrouter/auto" ? "selected" : ""}`}
              onClick={() => {
                onSelect("openrouter/auto");
                setOpen(false);
              }}
            >
              <div>
                <strong>OpenRouter Auto</strong>
                <p>Let OpenRouter route the task to the best available model.</p>
              </div>
              <span className="model-pill">Smart default</span>
            </button>
            {groupModels(filteredModels).map(([provider, items]) => (
              <section key={provider} className="model-group">
                <header>
                  <span>{provider}</span>
                  <small>{items.length} models</small>
                </header>
                <div className="model-list">
                  {items.map((model) => (
                    <button
                      type="button"
                      key={model.id}
                      className={`model-row ${model.id === selectedModelId ? "selected" : ""}`}
                      onClick={() => {
                        onSelect(model.id);
                        setOpen(false);
                      }}
                    >
                      <div>
                        <strong>{model.name}</strong>
                        <p>{model.description ?? model.id}</p>
                        <div className="model-tags">
                          {model.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="model-pill">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <aside>
                        <span>{Math.round(model.contextLength / 1000)}k ctx</span>
                        <span>{formatPrice(model.promptPrice)}</span>
                      </aside>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
