import { autoAnimate } from "@formkit/auto-animate";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDownIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderCodeIcon,
  FolderIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  SquarePenIcon
} from "lucide-react";
import type { AgentRun, Conversation, SortMode, Website } from "@shared/types";
import { formatRelativeTime } from "@renderer/lib/format";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";

const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out"
} as const;

interface WebsiteSidebarProps {
  websites: Website[];
  conversations: Conversation[];
  runs: AgentRun[];
  collapsed: boolean;
  projectSortMode: SortMode;
  selectedWebsiteId: string | null;
  selectedConversationId: string | null;
  onSelectWebsite: (websiteId: string) => void;
  onSelectConversation: (conversationId: string, websiteId: string) => void;
  onCreateWebsite: () => void;
  onCreateConversation: (websiteId: string) => void;
  onChangeProjectSortMode: (sortMode: SortMode) => void;
  onReorderWebsites: (orderedIds: string[]) => void;
  onReorderConversations: (websiteId: string, orderedIds: string[]) => void;
  onToggleCollapse: () => void;
}

function describeSortMode(value: SortMode): string {
  switch (value) {
    case "name":
      return "A-Z";
    case "manual":
      return "Manual";
    default:
      return "Last user message";
  }
}

function toFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return encodeURI(normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`);
}

function candidateProjectIconUrls(workspacePath: string): string[] {
  const normalized = workspacePath.replace(/[\\/]+$/, "");
  const candidates = [
    "favicon.ico",
    "favicon.png",
    "favicon.svg",
    "public/favicon.ico",
    "public/favicon.png",
    "public/favicon.svg",
    "src/favicon.ico",
    "src/favicon.png",
    "src/favicon.svg",
    "src/assets/favicon.ico",
    "src/assets/favicon.png",
    "src/assets/favicon.svg",
    "app/favicon.ico",
    "app/favicon.png",
    "app/favicon.svg"
  ];
  return candidates.map((relativePath) => toFileUrl(`${normalized}/${relativePath}`));
}

function ProjectIcon({ website }: { website: Website }) {
  const sources = useMemo(() => candidateProjectIconUrls(website.workspacePath), [website.workspacePath]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSourceIndex(0);
    setLoaded(false);
  }, [sources]);

  const source = sources[sourceIndex] ?? null;

  return (
    <span className="website-project-icon-slot" aria-hidden="true">
      {!loaded ? <FolderIcon size={14} className="website-folder-icon" /> : null}
      {source ? (
        <img
          src={source}
          alt=""
          className={`website-project-icon ${loaded ? "loaded" : ""}`}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            setSourceIndex((current) => current + 1);
          }}
        />
      ) : null}
    </span>
  );
}

interface SortMenuProps {
  label: string;
  value: SortMode;
  onChange: (mode: SortMode) => void;
}

function SortMenu({ label, value, onChange }: SortMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const options: { mode: SortMode; label: string }[] = [
    { mode: "recent", label: "Last user message" },
    { mode: "name", label: "A-Z" },
    { mode: "manual", label: "Manual" }
  ];

  return (
    <div className="sort-menu-wrapper" ref={menuRef}>
      <button
        type="button"
        className="icon-button"
        onClick={() => setOpen((prev) => !prev)}
        title={`${label}: ${describeSortMode(value)}`}
      >
        <ArrowUpDownIcon size={14} />
      </button>
      {open ? (
        <div className="sort-dropdown">
          <span className="sort-dropdown-label">{label}</span>
          {options.map((option) => (
            <button
              key={option.mode}
              type="button"
              className={`sort-dropdown-option ${option.mode === value ? "active" : ""}`}
              onClick={() => {
                onChange(option.mode);
                setOpen(false);
              }}
            >
              {option.label}
              {option.mode === value ? <span className="sort-check">&#10003;</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface DragItem {
  type: "website" | "conversation";
  id: string;
  websiteId?: string;
  startY: number;
  startIndex: number;
  currentIndex: number;
  offsetY: number;
  containerEl: HTMLElement | null;
  itemEls: HTMLElement[];
  itemHeight: number;
}

export function WebsiteSidebar(props: WebsiteSidebarProps) {
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const dragRef = useRef<DragItem | null>(null);
  const animatedProjectListsRef = useRef(new WeakSet<HTMLElement>());
  const animatedThreadListsRef = useRef(new WeakSet<HTMLElement>());
  const [expandedWebsiteIds, setExpandedWebsiteIds] = useState<Set<string>>(
    () => new Set(props.selectedWebsiteId ? [props.selectedWebsiteId] : [])
  );

  const attachProjectListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedProjectListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedProjectListsRef.current.add(node);
  }, []);

  const attachThreadListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedThreadListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedThreadListsRef.current.add(node);
  }, []);

  useEffect(() => {
    const selectedWebsiteId = props.selectedWebsiteId;
    if (!selectedWebsiteId) {
      return;
    }
    setExpandedWebsiteIds((current) => {
      if (current.has(selectedWebsiteId)) {
        return current;
      }
      const next = new Set(current);
      next.add(selectedWebsiteId);
      return next;
    });
  }, [props.selectedWebsiteId]);

  const runsByConversationId = useMemo(() => {
    const map = new Map<string, AgentRun[]>();
    for (const run of props.runs) {
      const next = map.get(run.conversationId) ?? [];
      next.push(run);
      map.set(run.conversationId, next);
    }
    return map;
  }, [props.runs]);

  const conversationsByWebsiteId = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const conversation of props.conversations) {
      const next = map.get(conversation.websiteId) ?? [];
      next.push(conversation);
      map.set(conversation.websiteId, next);
    }
    return map;
  }, [props.conversations]);

  const orderedWebsites = useMemo(() => {
    switch (props.projectSortMode) {
      case "name":
        return [...props.websites].sort((left, right) => left.name.localeCompare(right.name));
      case "manual":
        return props.websites;
      default:
        return [...props.websites].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    }
  }, [props.projectSortMode, props.websites]);

  const getOrderedConversations = useCallback((website: Website) => {
    const conversations = conversationsByWebsiteId.get(website.id) ?? [];
    const manualOrder = new Map(website.conversationIds.map((id, index) => [id, index]));
    switch (props.projectSortMode) {
      case "name":
        return [...conversations].sort((left, right) => left.title.localeCompare(right.title));
      case "manual":
        return [...conversations].sort(
          (left, right) => (manualOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (manualOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
        );
      default:
        return [...conversations].sort(
          (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        );
    }
  }, [conversationsByWebsiteId, props.projectSortMode]);

  // Pointer-based smooth drag reorder
  const handlePointerDown = useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    type: "website" | "conversation",
    id: string,
    websiteId?: string
  ) => {
    const target = event.currentTarget;
    const container = target.closest<HTMLElement>(type === "website" ? ".website-list" : ".website-runs");
    if (!container) return;
    const items = Array.from(container.querySelectorAll<HTMLElement>(
      type === "website" ? ".website-row-shell" : ".conversation-item"
    ));
    const itemEl = target.closest<HTMLElement>(type === "website" ? ".website-row-shell" : ".conversation-item");
    if (!itemEl) return;
    const startIndex = items.indexOf(itemEl);
    if (startIndex < 0) return;

    const rect = itemEl.getBoundingClientRect();
    const item: DragItem = {
      type,
      id,
      websiteId,
      startY: event.clientY,
      startIndex,
      currentIndex: startIndex,
      offsetY: 0,
      containerEl: container,
      itemEls: items,
      itemHeight: rect.height + 4 // gap
    };
    dragRef.current = item;
    setDragItem(item);
    target.setPointerCapture(event.pointerId);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaY = event.clientY - drag.startY;
      const indexDelta = Math.round(deltaY / drag.itemHeight);
      const newIndex = Math.max(0, Math.min(drag.itemEls.length - 1, drag.startIndex + indexDelta));
      drag.offsetY = deltaY;
      drag.currentIndex = newIndex;
      dragRef.current = { ...drag };
      setDragItem({ ...drag });
    };

    const handlePointerUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      if (drag.currentIndex !== drag.startIndex) {
        if (drag.type === "website") {
          const ids = orderedWebsites.map((w) => w.id);
          const [moved] = ids.splice(drag.startIndex, 1);
          ids.splice(drag.currentIndex, 0, moved);
          props.onReorderWebsites(ids);
        } else if (drag.websiteId) {
          const website = props.websites.find((w) => w.id === drag.websiteId);
          if (website) {
            const convos = getOrderedConversations(website);
            const ids = convos.map((c) => c.id);
            const [moved] = ids.splice(drag.startIndex, 1);
            ids.splice(drag.currentIndex, 0, moved);
            props.onReorderConversations(drag.websiteId, ids);
          }
        }
      }
      dragRef.current = null;
      setDragItem(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [orderedWebsites, getOrderedConversations, props]);

  const isManualProjects = props.projectSortMode === "manual";
  const isManualConversations = props.projectSortMode === "manual";

  const getDragStyle = (type: "website" | "conversation", index: number): React.CSSProperties => {
    if (!dragItem || dragItem.type !== type) return {};
    if (index === dragItem.startIndex) {
      return {
        transform: `translateY(${dragItem.offsetY}px)`,
        zIndex: 10,
        position: "relative",
        opacity: 0.9,
        transition: "none"
      };
    }
    // Shift other items
    if (dragItem.currentIndex > dragItem.startIndex) {
      if (index > dragItem.startIndex && index <= dragItem.currentIndex) {
        return { transform: `translateY(-${dragItem.itemHeight}px)`, transition: "transform 150ms ease" };
      }
    } else if (dragItem.currentIndex < dragItem.startIndex) {
      if (index < dragItem.startIndex && index >= dragItem.currentIndex) {
        return { transform: `translateY(${dragItem.itemHeight}px)`, transition: "transform 150ms ease" };
      }
    }
    return { transition: "transform 150ms ease" };
  };

  return (
    <aside className={`website-sidebar ${props.collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-brand">
        {!props.collapsed ? (
          <h1>JJcoder</h1>
        ) : null}
        <div className="sidebar-brand-actions">
          <button type="button" className="icon-button" onClick={props.onToggleCollapse} title={props.collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {props.collapsed ? <PanelLeftOpenIcon size={14} /> : <PanelLeftCloseIcon size={14} />}
          </button>
        </div>
      </div>

      <div className="sidebar-scroll">
        {!props.collapsed ? (
          <div className="sidebar-section-header">
            <p className="sidebar-subtitle">Projects</p>
            <div className="sidebar-section-actions">
              <SortMenu label="Sort projects" value={props.projectSortMode} onChange={props.onChangeProjectSortMode} />
              <button type="button" className="icon-button" onClick={props.onCreateWebsite} title="New project">
                <PlusIcon size={14} />
              </button>
            </div>
          </div>
        ) : null}

        {orderedWebsites.length === 0 ? (
          <div className="empty-sidebar">
            <FolderCodeIcon size={16} />
            {!props.collapsed ? (
              <>
                <p>No projects yet</p>
                <button type="button" className="text-button" onClick={props.onCreateWebsite}>
                  Create your first project
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="website-list" ref={attachProjectListAutoAnimateRef}>
          {orderedWebsites.map((website, index) => {
            const selected = website.id === props.selectedWebsiteId;
            const conversations = getOrderedConversations(website);
            const expanded = expandedWebsiteIds.has(website.id);
            const pinnedCollapsedConversation =
              !expanded && props.selectedConversationId
                ? conversations.find((conversation) => conversation.id === props.selectedConversationId) ?? null
                : null;
            const shouldShowConversationPanel = expanded || pinnedCollapsedConversation !== null;
            const renderedConversations = pinnedCollapsedConversation ? [pinnedCollapsedConversation] : conversations;

            return (
              <div key={website.id} className={`website-group ${selected ? "selected" : ""}`}>
                <div className="website-row-shell" style={isManualProjects && !props.collapsed ? getDragStyle("website", index) : {}}>
                  {!props.collapsed ? (
                    <button
                      type="button"
                      className="website-expander-button"
                      aria-label={expanded ? `Collapse ${website.name}` : `Expand ${website.name}`}
                      aria-expanded={expanded}
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedWebsiteIds((current) => {
                          const next = new Set(current);
                          if (next.has(website.id)) {
                            next.delete(website.id);
                          } else {
                            next.add(website.id);
                          }
                          return next;
                        });
                      }}
                    >
                      <span className="website-expander" aria-hidden="true">
                        {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
                      </span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="website-row"
                    onClick={() => props.onSelectWebsite(website.id)}
                    onPointerDown={
                      isManualProjects && !props.collapsed
                        ? (event) => handlePointerDown(event, "website", website.id)
                        : undefined
                    }
                  >
                    {!props.collapsed ? <ProjectIcon website={website} /> : null}
                    <div className="website-copy">
                      <strong>{props.collapsed ? website.name.slice(0, 1).toUpperCase() : website.name}</strong>
                    </div>
                    {!props.collapsed && selected ? (
                      <button
                        type="button"
                        className="project-compose-button"
                        title="New chat"
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onCreateConversation(website.id);
                        }}
                      >
                        <SquarePenIcon size={14} />
                      </button>
                    ) : null}
                  </button>
                </div>

                {!props.collapsed ? (
                  <Collapsible open={shouldShowConversationPanel}>
                    <CollapsibleContent className="conversation-panel">
                      <div className="conversation-list-shell">
                        <div className="website-runs" ref={attachThreadListAutoAnimateRef}>
                          {expanded && conversations.length === 0 ? <span className="run-placeholder">No chats yet</span> : null}
                          {renderedConversations.map((conversation, convIndex) => {
                          const isSelectedConversation = conversation.id === props.selectedConversationId;
                          const hasActiveRun = (runsByConversationId.get(conversation.id) ?? []).some(
                            (run) => run.status === "queued" || run.status === "running"
                          );

                          return (
                            <div
                              key={conversation.id}
                              style={isManualConversations ? getDragStyle("conversation", convIndex) : {}}
                              className="conversation-item"
                            >
                              <button
                                type="button"
                                className={`conversation-row ${isSelectedConversation ? "selected" : ""}`}
                                onPointerDown={
                                  isManualConversations
                                    ? (event) => handlePointerDown(event, "conversation", conversation.id, website.id)
                                    : undefined
                                }
                                onClick={() => props.onSelectConversation(conversation.id, website.id)}
                              >
                                <div className="conversation-copy">
                                  <div className="conversation-line">
                                    {hasActiveRun ? <span className="conversation-active-dot" aria-hidden="true" /> : null}
                                    <strong>{conversation.title}</strong>
                                  </div>
                                </div>
                                <time>{formatRelativeTime(conversation.updatedAt)}</time>
                              </button>
                            </div>
                          );
                        })}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
