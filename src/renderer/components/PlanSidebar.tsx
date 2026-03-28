import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PanelRightCloseIcon } from "lucide-react";
import type { ProposedPlan } from "@shared/types";
import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "@renderer/lib/proposedPlan";

interface PlanSidebarProps {
  plan: ProposedPlan | null;
  onClose: () => void;
}

export function PlanSidebar({ plan, onClose }: PlanSidebarProps) {
  const [expanded, setExpanded] = useState(true);
  const title = useMemo(() => (plan ? proposedPlanTitle(plan.planMarkdown) ?? plan.title : "Plan"), [plan]);

  return (
    <aside className="plan-sidebar">
      <div className="plan-sidebar-header">
        <div>
          <p className="eyebrow">Plan</p>
          <h3>{title}</h3>
        </div>
        <button type="button" className="icon-button" onClick={onClose} title="Close plan sidebar">
          <PanelRightCloseIcon size={14} />
        </button>
      </div>

      <div className="plan-sidebar-body">
        {plan ? (
          <>
            <div className="plan-sidebar-meta">
              <span className={`status-pill status-${plan.status === "implemented" ? "completed" : "queued"}`}>
                {plan.status}
              </span>
            </div>
            <div className="plan-sidebar-section">
              <button type="button" className="toolbar-chip" onClick={() => setExpanded((value) => !value)}>
                {expanded ? "Hide full plan" : "Show full plan"}
              </button>
            </div>
            {expanded ? (
              <div className="plan-sidebar-markdown chat-markdown">
                <Markdown remarkPlugins={[remarkGfm]}>{stripDisplayedPlanMarkdown(plan.planMarkdown)}</Markdown>
              </div>
            ) : null}
          </>
        ) : (
          <div className="empty-panel">
            <p className="eyebrow">Plan</p>
            <h2>No plan selected</h2>
            <p>Switch to plan mode and send a prompt to generate a reviewable implementation plan.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
