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
        <p className="eyebrow">Preview</p>
        <h2>No website selected</h2>
        <p>Create or select a website to see the live preview.</p>
      </div>
    );
  }

  const hasPreview = Boolean(props.website.preview.url);

  return (
    <div className="preview-area">
      <div className="preview-header">
        <h3>{props.website.name}</h3>
        <div className="preview-actions">
          {!hasPreview ? (
            <button type="button" className="toolbar-chip" onClick={() => props.onStartPreview(props.website!.id)}>
              <EyeIcon size={13} />
              Start
            </button>
          ) : (
            <button type="button" className="toolbar-chip" onClick={() => props.onStopPreview(props.website!.id)}>
              <EyeOffIcon size={13} />
              Stop
            </button>
          )}
          {props.website.vercel.deploymentUrl ? (
            <button
              type="button"
              className="toolbar-chip"
              onClick={() => props.onOpenExternal(props.website!.vercel.deploymentUrl!)}
            >
              <RocketIcon size={13} />
              Live
            </button>
          ) : null}
        </div>
      </div>

      {hasPreview && props.website.preview.url ? (
        <>
          <div className="preview-toolbar">
            <span>{props.website.preview.url}</span>
            <button type="button" className="icon-button" onClick={() => props.onOpenExternal(props.website!.preview.url!)}>
              <ExternalLinkIcon size={13} />
            </button>
          </div>
          <iframe className="preview-frame" src={props.website.preview.url} title={`${props.website.name} preview`} />
        </>
      ) : (
        <div className="preview-placeholder">
          <p>Preview offline</p>
          <small>{props.website.preview.lastOutput ?? "Start a dev server to see your site here."}</small>
        </div>
      )}
    </div>
  );
}
