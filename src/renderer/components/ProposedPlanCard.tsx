import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyIcon, FileTextIcon } from "lucide-react";
import { buildCollapsedProposedPlanPreviewMarkdown, proposedPlanTitle, stripDisplayedPlanMarkdown } from "@renderer/lib/proposedPlan";

interface ProposedPlanCardProps {
  planMarkdown: string;
}

export function ProposedPlanCard({ planMarkdown }: ProposedPlanCardProps) {
  const [expanded, setExpanded] = useState(false);
  const title = useMemo(() => proposedPlanTitle(planMarkdown) ?? "Proposed plan", [planMarkdown]);
  const lineCount = planMarkdown.split(/\r?\n/).length;
  const canCollapse = planMarkdown.length > 900 || lineCount > 20;
  const displayMarkdown = expanded
    ? stripDisplayedPlanMarkdown(planMarkdown)
    : buildCollapsedProposedPlanPreviewMarkdown(planMarkdown, 10);

  return (
    <div className="plan-card">
      <div className="plan-card-header">
        <div className="plan-card-title">
          <span className="plan-card-badge">
            <FileTextIcon size={12} />
            Plan
          </span>
          <strong title={title}>{title}</strong>
        </div>
        <button
          type="button"
          className="icon-button"
          title="Copy plan"
          onClick={() => void navigator.clipboard.writeText(planMarkdown)}
        >
          <CopyIcon size={13} />
        </button>
      </div>

      <div className="plan-card-body">
        <div className="chat-markdown">
          <Markdown remarkPlugins={[remarkGfm]}>{displayMarkdown}</Markdown>
        </div>
      </div>

      {canCollapse ? (
        <div className="plan-card-actions">
          <button type="button" className="toolbar-chip" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Collapse plan" : "Expand plan"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
