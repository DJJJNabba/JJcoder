import { ExternalLinkIcon, EyeIcon, EyeOffIcon, RocketIcon } from "lucide-react";
import type { Website } from "@shared/types";

interface PreviewPaneProps {
  website: Website | null;
  onStartPreview: (websiteId: string) => void;
  onStopPreview: (websiteId: string) => void;
  onOpenExternal: (url: string) => void;
}

export function PreviewPane(props: PreviewPaneProps) {
  if (!props.website) {
    return (
      <div className="empty-panel">
        <p className="eyebrow">Live preview</p>
        <h2>No website selected</h2>
        <p>Create or import a website to get the in-app preview and deployment controls.</p>
      </div>
    );
  }

  const hasPreview = Boolean(props.website.preview.url);

  return (
    <div className="preview-panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Live preview</p>
          <h2>{props.website.name}</h2>
        </div>
        <div className="preview-actions">
          {!hasPreview ? (
            <button type="button" className="toolbar-chip" onClick={() => props.onStartPreview(props.website!.id)}>
              <EyeIcon size={14} />
              Start preview
            </button>
          ) : (
            <button type="button" className="toolbar-chip" onClick={() => props.onStopPreview(props.website!.id)}>
              <EyeOffIcon size={14} />
              Stop preview
            </button>
          )}
          {props.website.vercel.deploymentUrl ? (
            <button
              type="button"
              className="toolbar-chip"
              onClick={() => props.onOpenExternal(props.website!.vercel.deploymentUrl!)}
            >
              <RocketIcon size={14} />
              Open deployment
            </button>
          ) : null}
        </div>
      </header>

      {hasPreview && props.website.preview.url ? (
        <>
          <div className="preview-toolbar">
            <span>{props.website.preview.url}</span>
            <button type="button" className="icon-button" onClick={() => props.onOpenExternal(props.website!.preview.url!)}>
              <ExternalLinkIcon size={14} />
            </button>
          </div>
          <iframe className="preview-frame" src={props.website.preview.url} title={`${props.website.name} preview`} />
        </>
      ) : (
        <div className="preview-placeholder">
          <p>The preview server is offline.</p>
          <small>{props.website.preview.lastOutput ?? "Start a Vite dev server inside the app when you are ready."}</small>
        </div>
      )}
    </div>
  );
}
