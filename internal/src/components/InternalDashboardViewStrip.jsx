import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  LayoutDashboard,
  Lock,
  Pencil,
  Pin,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useInternalAuth } from "../auth/AuthContext";
import {
  INTERNAL_MAX_BLOCKS_PER_VIEW,
  INTERNAL_MAX_CUSTOM_VIEWS,
  INTERNAL_VIEW_BUILDER_EVENT,
  INTERNAL_VIEW_CHANGE_EVENT,
  INTERNAL_VIEW_STORAGE_KEY,
  cloneInternalBlocks,
  createInternalViewDraft,
  createInternalViewId,
  defaultInternalBlocks,
  getVisibleInternalBuiltinTabs,
  internalBuiltinViewFor,
  internalViewBlockLibrary,
  internalViewColorPresets,
  normalizeInternalCustomView,
  pathForInternalView,
  readInternalViewState,
  saveInternalViewState,
  uniqueInternalViewLabel,
} from "../views/internalViews";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "./ui/drawer";

export { INTERNAL_VIEW_STORAGE_KEY };

function syncLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Last sync now";
  const minutes = Math.max(
    0,
    Math.round((Date.now() - date.getTime()) / 60000),
  );
  if (minutes < 1) return "Last sync now";
  if (minutes < 60) return `Last sync ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Last sync ${hours}h`;
  return `Last sync ${Math.round(hours / 24)}d`;
}

function existingLabelMatches(labels, value) {
  const label = String(value || "")
    .trim()
    .toLowerCase();
  return (
    Boolean(label) &&
    labels.some(
      (item) =>
        String(item || "")
          .trim()
          .toLowerCase() === label,
    )
  );
}

function blockLibraryItem(type) {
  return internalViewBlockLibrary.find((item) => item.type === type);
}

function DashboardBlockRow({
  block,
  index,
  total,
  onMove,
  onUpdate,
  onRemove,
}) {
  const libraryItem = blockLibraryItem(block.type);
  const modes = libraryItem?.modes || ["metric"];

  return (
    <article className="internal-view-builder__block-row">
      <div className="internal-view-builder__row-header">
        <div>
          <strong>{libraryItem?.title || block.title}</strong>
          <small>{libraryItem?.description || "Internal view block."}</small>
        </div>
        <button
          type="button"
          className="internal-view-builder__icon-action"
          onClick={() => onRemove(block.id)}
          aria-label={`Remove ${block.title}`}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="internal-view-builder__row-controls">
        <label>
          <span>Block Title</span>
          <input
            value={block.title}
            onChange={(event) =>
              onUpdate(block.id, { title: event.target.value })
            }
          />
        </label>
        <label>
          <span>Block Size</span>
          <select
            value={block.size}
            onChange={(event) =>
              onUpdate(block.id, { size: event.target.value })
            }
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="wide">Wide</option>
          </select>
        </label>
        <label>
          <span>Display Mode</span>
          <select
            value={block.displayMode}
            onChange={(event) =>
              onUpdate(block.id, { displayMode: event.target.value })
            }
          >
            {modes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="internal-view-builder__row-footer">
        <div className="internal-view-builder__mini-swatches">
          {Object.entries(internalViewColorPresets).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              className={block.colorPreset === key ? "is-selected" : ""}
              onClick={() => onUpdate(block.id, { colorPreset: key })}
              aria-label={`Use ${preset.label} block color`}
            >
              <span style={{ background: preset.accent }} />
            </button>
          ))}
        </div>
        <div className="internal-view-builder__move-controls">
          <button
            type="button"
            onClick={() => onMove(index, index - 1)}
            disabled={index === 0}
            aria-label="Move block up"
          >
            <ArrowUp aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onMove(index, index + 1)}
            disabled={index >= total - 1}
            aria-label="Move block down"
          >
            <ArrowDown aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

function ViewBuilderDrawer({
  composer,
  customViews,
  builtinTabs,
  onClose,
  onSubmit,
  onDuplicate,
  onDelete,
}) {
  const [draft, setDraft] = useState(
    () => composer?.draft || createInternalViewDraft(),
  );
  const editingView = composer?.mode === "edit" ? composer?.tab : null;

  useEffect(() => {
    if (!composer) return;
    setDraft(composer.draft || createInternalViewDraft());
  }, [composer]);

  const existingLabels = useMemo(
    () => [
      ...builtinTabs.map((tab) => tab.label),
      ...customViews
        .filter((view) => view.id !== draft.id)
        .map((view) => view.label),
    ],
    [builtinTabs, customViews, draft.id],
  );
  const label = draft.label.trim();
  const duplicateLabel = existingLabelMatches(existingLabels, label);
  const limitReached =
    !editingView && customViews.length >= INTERNAL_MAX_CUSTOM_VIEWS;
  const validation = !label
    ? "View name is required."
    : duplicateLabel
      ? "Use a unique view name."
      : limitReached
        ? `You can create up to ${INTERNAL_MAX_CUSTOM_VIEWS} custom views.`
        : draft.blocks.length === 0
          ? "Add at least one block."
          : "";

  function updateDraft(next) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function addBlock(libraryItem) {
    if (draft.blocks.length >= INTERNAL_MAX_BLOCKS_PER_VIEW) return;
    setDraft((current) => ({
      ...current,
      blocks: [
        ...current.blocks,
        {
          id: createInternalViewId("block"),
          type: libraryItem.type,
          title: libraryItem.title,
          size: libraryItem.size,
          displayMode: libraryItem.displayMode,
          colorPreset: current.colorPreset,
        },
      ],
    }));
  }

  function moveBlock(from, to) {
    setDraft((current) => {
      const next = [...current.blocks];
      const target = Math.max(0, Math.min(next.length - 1, to));
      const [moved] = next.splice(from, 1);
      if (!moved) return current;
      next.splice(target, 0, moved);
      return { ...current, blocks: next };
    });
  }

  function updateBlock(id, next) {
    setDraft((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === id ? { ...block, ...next } : block,
      ),
    }));
  }

  function removeBlock(id) {
    setDraft((current) => ({
      ...current,
      blocks: current.blocks.filter((block) => block.id !== id),
    }));
  }

  function resetLayout() {
    updateDraft({ blocks: defaultInternalBlocks() });
  }

  function save(event) {
    event.preventDefault();
    if (validation) return;
    const now = new Date().toISOString();
    onSubmit({
      ...draft,
      label,
      subtitle: draft.subtitle?.trim() || "Custom Internal overview.",
      createdAt: draft.createdAt || now,
      updatedAt: now,
    });
  }

  return (
    <Drawer
      open={Boolean(composer)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      direction="right"
    >
      <DrawerContent className="internal-view-builder-drawer">
        <DrawerHeader>
          <DrawerTitle>
            {editingView ? "Edit Custom View" : "Create Custom View"}
          </DrawerTitle>
          <DrawerDescription>
            Build a scoped Internal command view with ordered blocks, saved
            locally in this browser.
          </DrawerDescription>
        </DrawerHeader>
        <form className="internal-view-builder" onSubmit={save}>
          <section className="internal-view-builder__panel">
            <div className="internal-view-builder__grid">
              <label className="internal-view-builder__field">
                <span>View Name</span>
                <input
                  value={draft.label}
                  onChange={(event) =>
                    updateDraft({ label: event.target.value })
                  }
                  autoFocus
                />
              </label>
              <label className="internal-view-builder__field">
                <span>Header Subtitle</span>
                <input
                  value={draft.subtitle || ""}
                  onChange={(event) =>
                    updateDraft({ subtitle: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="internal-view-builder__section">
              <span>Color Preset</span>
              <div className="internal-view-builder__swatches">
                {Object.entries(internalViewColorPresets).map(
                  ([key, preset]) => (
                    <button
                      key={key}
                      type="button"
                      className={`internal-view-swatch ${draft.colorPreset === key ? "is-selected" : ""}`}
                      onClick={() => updateDraft({ colorPreset: key })}
                    >
                      <span style={{ background: preset.accent }} />
                      {preset.label}
                    </button>
                  ),
                )}
              </div>
            </div>
          </section>

          <section className="internal-view-builder__section">
            <div className="internal-view-builder__section-head">
              <div>
                <span>Block Library</span>
                <small>
                  Add up to {INTERNAL_MAX_BLOCKS_PER_VIEW} operational blocks.
                </small>
              </div>
              <button
                type="button"
                className="secondary-action"
                onClick={resetLayout}
              >
                <RotateCcw aria-hidden="true" />
                Reset
              </button>
            </div>
            <div className="internal-view-builder__library">
              {internalViewBlockLibrary.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => addBlock(item)}
                  disabled={draft.blocks.length >= INTERNAL_MAX_BLOCKS_PER_VIEW}
                >
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                  <Plus aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>

          <section className="internal-view-builder__section">
            <div className="internal-view-builder__section-head">
              <div>
                <span>View Blocks</span>
                <small>Order and tune the blocks included in this view.</small>
              </div>
              <strong>
                {draft.blocks.length}/{INTERNAL_MAX_BLOCKS_PER_VIEW}
              </strong>
            </div>
            {draft.blocks.length ? (
              <div className="internal-view-builder__rows">
                {draft.blocks.map((block, index) => (
                  <DashboardBlockRow
                    key={block.id}
                    block={block}
                    index={index}
                    total={draft.blocks.length}
                    onMove={moveBlock}
                    onUpdate={updateBlock}
                    onRemove={removeBlock}
                  />
                ))}
              </div>
            ) : (
              <div className="internal-view-builder__empty">
                Add blocks from the library to compose this overview.
              </div>
            )}
          </section>
        </form>
        <DrawerFooter className="internal-view-builder__footer">
          <div className="internal-view-builder__validation">{validation}</div>
          {editingView ? (
            <>
              <button
                type="button"
                className="secondary-action"
                onClick={() => onDuplicate(editingView.id)}
              >
                <Copy aria-hidden="true" />
                Duplicate
              </button>
              <button
                type="button"
                className="secondary-action internal-view-builder__danger"
                onClick={() => onDelete(editingView)}
              >
                <Trash2 aria-hidden="true" />
                Delete
              </button>
            </>
          ) : null}
          <button type="button" className="secondary-action" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={Boolean(validation)}
            onClick={save}
          >
            <Save aria-hidden="true" />
            Save View
          </button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

export default function InternalDashboardViewStrip() {
  const { session } = useInternalAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const stripRef = useRef(null);
  const dragRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    scrollLeft: 0,
  });
  const [viewState, setViewState] = useState(() => readInternalViewState());
  const [contextMenu, setContextMenu] = useState(null);
  const [viewComposer, setViewComposer] = useState(null);
  const [lastSync, setLastSync] = useState(() => new Date().toISOString());
  const [refreshing, setRefreshing] = useState(false);

  const builtInTabs = useMemo(
    () => getVisibleInternalBuiltinTabs(session?.profile?.navigation || []),
    [session?.profile?.navigation],
  );
  const customViews = viewState.customViews;
  const pinnedTabIds = viewState.pinnedTabIds;
  const orderedCustomTabs = useMemo(() => {
    const pinned = customViews.filter((view) => pinnedTabIds.includes(view.id));
    const unpinned = customViews.filter(
      (view) => !pinnedTabIds.includes(view.id),
    );
    return [...pinned, ...unpinned].map((view) => ({
      ...view,
      path: `/views/${view.id}`,
    }));
  }, [customViews, pinnedTabIds]);
  const tabs = useMemo(
    () => [...builtInTabs, ...orderedCustomTabs],
    [builtInTabs, orderedCustomTabs],
  );
  const activeCustom =
    customViews.find((view) => location.pathname === `/views/${view.id}`) ||
    null;
  const activeBuiltIn =
    builtInTabs.find((tab) => location.pathname === tab.path) || null;
  const activeTabId = activeCustom?.id || activeBuiltIn?.id || "";
  const customLimitReached = customViews.length >= INTERNAL_MAX_CUSTOM_VIEWS;

  useEffect(() => {
    const refreshViews = () => setViewState(readInternalViewState());
    window.addEventListener("storage", refreshViews);
    window.addEventListener(INTERNAL_VIEW_CHANGE_EVENT, refreshViews);
    return () => {
      window.removeEventListener("storage", refreshViews);
      window.removeEventListener(INTERNAL_VIEW_CHANGE_EVENT, refreshViews);
    };
  }, []);

  useEffect(() => {
    const openBuilder = (event) => {
      const detail = event.detail || {};
      if (detail.mode === "edit" && detail.viewId) {
        if (detail.view) {
          openEditView(detail.view);
          return;
        }
        openEditViewById(detail.viewId);
        return;
      }
      openCreateView();
    };
    window.addEventListener(INTERNAL_VIEW_BUILDER_EVENT, openBuilder);
    return () =>
      window.removeEventListener(INTERNAL_VIEW_BUILDER_EVENT, openBuilder);
  });

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  function saveViewState(nextState) {
    const saved = saveInternalViewState(nextState);
    setViewState(saved);
    return saved;
  }

  function currentLabels() {
    return [
      ...builtInTabs.map((tab) => tab.label),
      ...customViews.map((view) => view.label),
    ];
  }

  function viewForTab(tabOrId) {
    const id = typeof tabOrId === "string" ? tabOrId : tabOrId?.id;
    if (!id) return null;
    return (
      customViews.find((view) => view.id === id) || internalBuiltinViewFor(id)
    );
  }

  function openTab(tab) {
    if (!tab) return;
    navigate(pathForInternalView(tab));
  }

  function openCreateView() {
    setViewComposer({
      mode: "create",
      draft: createInternalViewDraft(currentLabels()),
    });
  }

  function createView(payload) {
    if (customLimitReached) return;
    const nextView = normalizeInternalCustomView(payload);
    if (!nextView) return;
    saveViewState({ ...viewState, customViews: [...customViews, nextView] });
    navigate(`/views/${nextView.id}`);
  }

  function openEditView(tab) {
    if (!tab || tab.kind !== "custom") return;
    setViewComposer({
      mode: "edit",
      tab,
      draft: {
        ...tab,
        blocks: cloneInternalBlocks(tab.blocks).map((block, index) => ({
          ...block,
          id: tab.blocks?.[index]?.id || block.id,
        })),
      },
    });
  }

  function openEditViewById(id) {
    const view = customViews.find((item) => item.id === id);
    if (view) openEditView(view);
  }

  function editView(tab, payload) {
    if (!tab || tab.kind !== "custom") return;
    const nextView = normalizeInternalCustomView({
      ...payload,
      id: tab.id,
      createdAt: tab.createdAt,
    });
    if (!nextView) return;
    saveViewState({
      ...viewState,
      customViews: customViews.map((view) =>
        view.id === tab.id ? nextView : view,
      ),
    });
  }

  function deleteView(tab) {
    if (!tab || tab.kind !== "custom") return;
    if (!window.confirm(`Delete "${tab.label}"?`)) return;
    saveViewState({
      customViews: customViews.filter((view) => view.id !== tab.id),
      pinnedTabIds: pinnedTabIds.filter((id) => id !== tab.id),
    });
    if (activeTabId === tab.id) navigate("/views");
    if (viewComposer?.tab?.id === tab.id) setViewComposer(null);
  }

  function duplicateView(tabOrId) {
    const source = viewForTab(tabOrId);
    if (!source || customLimitReached) return;
    const now = new Date().toISOString();
    const nextView = normalizeInternalCustomView({
      ...source,
      id: createInternalViewId("view"),
      kind: "custom",
      label: uniqueInternalViewLabel(`${source.label} Copy`, currentLabels()),
      blocks: cloneInternalBlocks(source.blocks),
      createdAt: now,
      updatedAt: now,
    });
    if (!nextView) return;
    saveViewState({ ...viewState, customViews: [...customViews, nextView] });
    navigate(`/views/${nextView.id}`);
    setViewComposer({ mode: "edit", tab: nextView, draft: nextView });
  }

  function copyView(tab) {
    const view = viewForTab(tab);
    const text = view ? JSON.stringify(view, null, 2) : tab?.label || "";
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  function togglePin(tab) {
    if (!tab) return;
    const pinned = new Set(pinnedTabIds);
    if (pinned.has(tab.id)) pinned.delete(tab.id);
    else pinned.add(tab.id);
    saveViewState({ ...viewState, pinnedTabIds: [...pinned] });
  }

  function runContextAction(action) {
    action();
    setContextMenu(null);
  }

  function refreshCurrentView() {
    setRefreshing(true);
    setLastSync(new Date().toISOString());
    window.dispatchEvent(
      new CustomEvent("smartlink:internal-dashboard-refresh", {
        detail: { path: location.pathname },
      }),
    );
    window.setTimeout(() => setRefreshing(false), 420);
  }

  if (!tabs.length) return null;

  const contextView = contextMenu ? viewForTab(contextMenu.tab) : null;
  const canDuplicateContext = Boolean(contextView) && !customLimitReached;
  const contextIsCustom = contextMenu?.tab?.kind === "custom";

  return (
    <div className="internal-view-strip">
      <div
        ref={stripRef}
        className="internal-view-strip__scroll"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const el = stripRef.current;
          dragRef.current = {
            active: Boolean(el && el.scrollWidth > el.clientWidth),
            moved: false,
            startX: event.clientX,
            scrollLeft: el?.scrollLeft || 0,
          };
          if (!dragRef.current.active || !el) return;
          el.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const el = stripRef.current;
          if (!el || !dragRef.current.active) return;
          dragRef.current.moved =
            Math.abs(event.clientX - dragRef.current.startX) > 6;
          el.scrollLeft =
            dragRef.current.scrollLeft -
            (event.clientX - dragRef.current.startX);
        }}
        onPointerUp={(event) => {
          dragRef.current.active = false;
          stripRef.current?.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={() => {
          dragRef.current.active = false;
        }}
      >
        <div className="internal-view-strip__tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`internal-view-tab ${activeTabId === tab.id ? "active" : ""}`}
              onClick={() => {
                if (!dragRef.current.moved) openTab(tab);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ tab, x: event.clientX, y: event.clientY });
              }}
            >
              {tab.label}
              {pinnedTabIds.includes(tab.id) ? (
                <Pin aria-hidden="true" />
              ) : null}
              {tab.kind === "custom" ? <span>Custom</span> : null}
            </button>
          ))}
          <button
            type="button"
            className="internal-view-tab internal-view-tab--new"
            onClick={openCreateView}
          >
            <Plus aria-hidden="true" />
            New View
          </button>
        </div>
      </div>

      <div className="internal-view-strip__actions">
        <span className="internal-view-sync">
          <span className={refreshing ? "loading" : ""} />
          {syncLabel(lastSync)}
        </span>
        <button
          type="button"
          className="internal-view-icon-btn"
          onClick={refreshCurrentView}
          aria-label="Refresh current view"
        >
          <RefreshCcw
            aria-hidden="true"
            className={refreshing ? "loading" : ""}
          />
        </button>
        {activeCustom ? (
          <button
            type="button"
            className="internal-view-icon-btn internal-view-icon-btn--danger"
            onClick={() => deleteView(activeCustom)}
            aria-label="Delete custom view"
          >
            <Trash2 aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          className="internal-view-primary-btn"
          onClick={() =>
            activeCustom ? openEditView(activeCustom) : openCreateView()
          }
        >
          {activeCustom ? (
            <Pencil aria-hidden="true" />
          ) : (
            <LayoutDashboard aria-hidden="true" />
          )}
          <span>{activeCustom ? "Edit View" : "New View"}</span>
        </button>
      </div>

      {viewComposer ? (
        <ViewBuilderDrawer
          composer={viewComposer}
          customViews={customViews}
          builtinTabs={builtInTabs}
          onClose={() => setViewComposer(null)}
          onSubmit={(payload) => {
            if (viewComposer.mode === "edit")
              editView(viewComposer.tab, payload);
            else createView(payload);
            setViewComposer(null);
          }}
          onDuplicate={duplicateView}
          onDelete={deleteView}
        />
      ) : null}

      {contextMenu ? (
        <div
          className="internal-view-menu"
          style={{
            left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 228)),
            top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 250)),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => runContextAction(() => togglePin(contextMenu.tab))}
          >
            {pinnedTabIds.includes(contextMenu.tab.id) ? (
              <Check aria-hidden="true" />
            ) : (
              <Pin aria-hidden="true" />
            )}
            {pinnedTabIds.includes(contextMenu.tab.id)
              ? "Unpin Tab"
              : "Pin Tab"}
          </button>
          <button
            type="button"
            disabled={!canDuplicateContext}
            onClick={() =>
              runContextAction(() => duplicateView(contextMenu.tab))
            }
          >
            <Copy aria-hidden="true" />
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => runContextAction(() => copyView(contextMenu.tab))}
          >
            <Copy aria-hidden="true" />
            Copy
          </button>
          {contextIsCustom ? (
            <button
              type="button"
              onClick={() =>
                runContextAction(() => openEditView(contextMenu.tab))
              }
            >
              <Pencil aria-hidden="true" />
              Edit
            </button>
          ) : null}
          <div className="internal-view-menu__divider" />
          <button
            type="button"
            className="is-danger"
            disabled={!contextIsCustom}
            onClick={() => runContextAction(() => deleteView(contextMenu.tab))}
          >
            <Trash2 aria-hidden="true" />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}
