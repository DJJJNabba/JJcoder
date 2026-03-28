import { SearchIcon, SparklesIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProviderModel } from "@shared/types";
import { formatTokenPrice, groupModels } from "@renderer/lib/format";

interface ModelPickerProps {
  models: ProviderModel[];
  selectedModelId: string;
  onSelect: (modelId: string) => void;
}

export function ModelPicker({ models, selectedModelId, onSelect }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    if (!open) {
      return;
    }

    const focusSearch = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });

    const handlePointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusSearch);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleSelect(modelId: string) {
    onSelect(modelId);
    setOpen(false);
  }

  return (
    <div className="model-picker" ref={pickerRef}>
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
                ref={searchInputRef}
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
              onClick={() => handleSelect("openrouter/auto")}
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
                      onClick={() => handleSelect(model.id)}
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
                        <span>{formatTokenPrice(model.promptPrice, "input")}</span>
                        <span>{formatTokenPrice(model.completionPrice, "output")}</span>
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
