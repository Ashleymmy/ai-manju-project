import {
  ChevronLeft,
  ChevronRight,
  Database,
  Loader2,
  RefreshCcw,
  Search,
  Trash2,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SeedanceAssetTag } from "@/entities/asset";

import type { SeedanceAssetsController } from "../controllers/useSeedanceAssetsController";
import {
  isSeedanceTagColor,
  SEEDANCE_PAGE_SIZE,
  SEEDANCE_TAG_DEFAULT_COLOR,
} from "../model/seedance";

export function SeedanceAssetsPanel({
  controller,
}: {
  controller: SeedanceAssetsController;
}) {
  const {
    busy,
    closeDeleteDialog: closeRemoveSeedanceAssetDialog,
    closeEditDialog: closeEditSeedanceAssetDialog,
    closeTagDeleteDialog: closeRemoveSeedanceTagDialog,
    closeTagDialog: closeSeedanceTagDialog,
    closeUploadDialog: closeSeedanceUploadDialog,
    closeUrlDialog: closeSeedanceUrlDialog,
    confirmDelete: confirmRemoveSeedanceAsset,
    confirmTagDelete: confirmRemoveSeedanceTag,
    deleteBusy: seedanceDeleteBusy,
    deleteError: seedanceDeleteError,
    deleteOpen: seedanceDeleteOpen,
    deleteTarget: seedanceDeleteTarget,
    editBusy: seedanceEditBusy,
    editDialogOpen: seedanceEditDialogOpen,
    editDraft: seedanceEditDraft,
    editErrors: seedanceEditErrors,
    editTarget: seedanceEditTarget,
    listLoading: seedanceListLoading,
    loadAssets: loadSeedanceAssets,
    openDeleteDialog: openRemoveSeedanceAssetDialog,
    openEditDialog: openEditSeedanceAssetDialog,
    openTagDeleteDialog: openRemoveSeedanceTagDialog,
    openTagDialog: openCreateSeedanceTagDialog,
    openUploadDialog: openSeedanceUploadDialog,
    openUrlDialog: openSeedanceUrlDialog,
    pageState: seedancePageState,
    readiness: seedanceReadiness,
    search: seedanceSearch,
    setDeleteOpen: setSeedanceDeleteOpen,
    setEditDialogOpen: setSeedanceEditDialogOpen,
    setEditDraft: setSeedanceEditDraft,
    setPage: setSeedancePage,
    setSearch: setSeedanceSearch,
    setStatus: setSeedanceStatus,
    setTagDeleteOpen: setSeedanceTagDeleteOpen,
    setTagDialogDraft: setSeedanceTagDialogDraft,
    setTagDialogErrors: setSeedanceTagDialogErrors,
    setTagDialogOpen: setSeedanceTagDialogOpen,
    setTagId: setSeedanceTagId,
    setType: setSeedanceType,
    setUploadDialogOpen: setSeedanceUploadDialogOpen,
    setUploadDraft: setSeedanceUploadDraft,
    setUploadErrors: setSeedanceUploadErrors,
    setUploadFile: setSeedanceUploadFile,
    setUrlDialogOpen: setSeedanceUrlDialogOpen,
    setUrlDraft: setSeedanceUrlDraft,
    status: seedanceStatus,
    submitEditDialog: submitSeedanceEditDialog,
    submitTagDialog: submitSeedanceTagDialog,
    submitUploadDialog: submitSeedanceUploadDialog,
    submitUrlDialog: submitSeedanceUrlDialog,
    syncSeedance,
    tagDeleteBusy: seedanceTagDeleteBusy,
    tagDeleteError: seedanceTagDeleteError,
    tagDeleteOpen: seedanceTagDeleteOpen,
    tagDeleteTarget: seedanceTagDeleteTarget,
    tagDialogBusy: seedanceTagDialogBusy,
    tagDialogDraft: seedanceTagDialogDraft,
    tagDialogErrors: seedanceTagDialogErrors,
    tagDialogOpen: seedanceTagDialogOpen,
    tagId: seedanceTagId,
    tags: seedanceTags,
    total: seedanceTotal,
    type: seedanceType,
    uploadBusy: seedanceUploadBusy,
    uploadDialogOpen: seedanceUploadDialogOpen,
    uploadDraft: seedanceUploadDraft,
    uploadErrors: seedanceUploadErrors,
    uploadFile: seedanceUploadFile,
    urlBusy: seedanceUrlBusy,
    urlDialogOpen: seedanceUrlDialogOpen,
    urlDraft: seedanceUrlDraft,
    urlErrors: seedanceUrlErrors,
  } = controller;

  return (
    <>
      <section className="real-admin-section">
        <div className="admin-panel-head">
          <div>
            <p className="eyebrow">SEEDANCE / {seedanceTotal}</p>
            <h2>Seedance 素材</h2>
            <small>
              {seedanceReadiness
                ? `provider=${seedanceReadiness.provider_configured ? "ready" : "missing"} · upload=${seedanceReadiness.upload_registration_available ? "on" : "off"} · publicBase=${seedanceReadiness.public_asset_base_url_configured ? "on" : "off"}`
                : "readiness loading"}
            </small>
          </div>
          <div>
            <button
              className="outline-button small"
              onClick={() => void syncSeedance("poll")}
            >
              <RefreshCcw size={15} /> 轮询
            </button>
            <button
              className="outline-button small"
              onClick={openSeedanceUploadDialog}
              disabled={seedanceUploadBusy || seedanceUrlBusy}
            >
              上传
            </button>
            <button
              className="outline-button small"
              onClick={openSeedanceUrlDialog}
              disabled={seedanceUploadBusy || seedanceUrlBusy}
            >
              注册 URL
            </button>
            <button
              className="vermilion-button"
              onClick={() => void syncSeedance("sync")}
            >
              <Database size={16} /> 同步
            </button>
          </div>
        </div>
        <div className="filter-line">
          <label className="tag-search">
            <Search size={15} />
            <input
              value={seedanceSearch}
              onChange={event => setSeedanceSearch(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") void loadSeedanceAssets();
              }}
              placeholder="搜索名称 / AssetID"
            />
          </label>
          <select
            value={seedanceStatus}
            onChange={event => setSeedanceStatus(event.target.value)}
          >
            <option value="">全部状态</option>
            {["queued", "Creating", "Processing", "Active", "Failed"].map(
              item => (
                <option key={item} value={item}>
                  {item}
                </option>
              )
            )}
          </select>
          <select
            value={seedanceType}
            onChange={event => setSeedanceType(event.target.value)}
          >
            <option value="">全部类型</option>
            <option value="Image">图片</option>
            <option value="Video">视频</option>
          </select>
          <select
            value={seedanceTagId}
            onChange={event => setSeedanceTagId(event.target.value)}
          >
            <option value="">全部标签</option>
            {seedanceTags.map(tag => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          <button
            className="outline-button small"
            onClick={() => void loadSeedanceAssets()}
            disabled={seedanceListLoading}
          >
            {seedanceListLoading ? (
              <Loader2 className="spin" size={15} />
            ) : (
              <Search size={15} />
            )} {" "}
            查询
          </button>
          <button
            className="outline-button small"
            onClick={() => {
              setSeedanceSearch("");
              setSeedanceStatus("");
              setSeedanceType("");
              setSeedanceTagId("");
              void loadSeedanceAssets({});
            }}
            disabled={seedanceListLoading}
          >
            清空
          </button>
        </div>
        <div className="filter-line">
          <div className="segmented">
            <button
              onClick={openCreateSeedanceTagDialog}
              disabled={busy.startsWith("seedance-")}
            >
              新建标签
            </button>
            {seedanceTags.map(tag => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 text-sm"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: tag.color || SEEDANCE_TAG_DEFAULT_COLOR,
                  }}
                />
                <span>{tag.name}</span>
                <button
                  type="button"
                  className="icon-button subtle"
                  aria-label={`删除标签 ${tag.name}`}
                  title={`删除标签 ${tag.name}`}
                  disabled={busy.startsWith("seedance-")}
                  onClick={() => openRemoveSeedanceTagDialog(tag)}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="seedance-board">
          {seedancePageState.items.map((asset, index) => (
            <article key={asset.id}>
              <span className="seedance-index">
                {String(
                  (seedancePageState.page - 1) * SEEDANCE_PAGE_SIZE + index + 1
                ).padStart(2, "0")}
              </span>
              <div>
                <b>{asset.name}</b>
                <small>
                  {asset.asset_type} · {asset.volcano_asset_id || asset.source_url} · {" "}
                  {(asset.tags || []).map(tag => tag.name).join("/") || "无标签"}
                </small>
              </div>
              <span
                className={`status-chip ${
                  asset.status.toLowerCase() === "active"
                    ? "succeeded"
                    : asset.status.toLowerCase() === "failed"
                      ? "failed"
                      : "running"
                }`}
              >
                {asset.status}
              </span>
              <button
                onClick={() => openEditSeedanceAssetDialog(asset)}
                disabled={busy.startsWith("seedance-")}
              >
                编辑
              </button>
              <button
                onClick={() => openRemoveSeedanceAssetDialog(asset)}
                disabled={busy.startsWith("seedance-")}
              >
                删除
              </button>
            </article>
          ))}
        </div>
        {!seedanceListLoading && !seedancePageState.items.length ? (
          <div className="empty-output">
            <p>没有匹配的 Seedance 素材</p>
          </div>
        ) : null}
        <div className="filter-line">
          <small>
            已加载 {controller.assets.length} / {seedanceTotal} 条 · 第 {seedancePageState.page} / {seedancePageState.pageCount} 页
          </small>
          <button
            className="outline-button small"
            disabled={seedancePageState.page <= 1}
            onClick={() => setSeedancePage(page => Math.max(1, page - 1))}
          >
            <ChevronLeft size={15} /> 上一页
          </button>
          <button
            className="outline-button small"
            disabled={seedancePageState.page >= seedancePageState.pageCount}
            onClick={() =>
              setSeedancePage(page =>
                Math.min(seedancePageState.pageCount, page + 1)
              )
            }
          >
            下一页 <ChevronRight size={15} />
          </button>
        </div>
      </section>

      <Dialog
        open={seedanceUrlDialogOpen}
        onOpenChange={nextOpen => {
          if (!nextOpen) {
            if (seedanceUrlBusy) return;
            closeSeedanceUrlDialog();
            return;
          }
          setSeedanceUrlDialogOpen(true);
        }}
      >
        <DialogContent
          className="sm:max-w-[720px]"
          showCloseButton={!seedanceUrlBusy}
          onEscapeKeyDown={event => {
            if (seedanceUrlBusy) event.preventDefault();
          }}
          onPointerDownOutside={event => {
            if (seedanceUrlBusy) event.preventDefault();
          }}
          onInteractOutside={event => {
            if (seedanceUrlBusy) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>注册 Seedance URL</DialogTitle>
            <DialogDescription>
              为已有资源地址创建 Seedance 素材记录，提交后会按正式流程刷新列表与轮询状态。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <SeedanceReadiness readiness={seedanceReadiness} />
            {!seedanceReadiness?.provider_configured ? (
              <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
                当前 Provider 未配置，暂不能注册 URL 资产。
              </p>
            ) : null}
            <label className="grid gap-2 text-sm">
              <span>Source URL *</span>
              <Input
                value={seedanceUrlDraft.source_url}
                onChange={event =>
                  setSeedanceUrlDraft(draft => ({
                    ...draft,
                    source_url: event.target.value,
                  }))
                }
                disabled={seedanceUrlBusy}
                placeholder="https://example.com/image.png"
              />
              {seedanceUrlErrors.source_url ? (
                <span className="text-sm text-destructive">
                  {seedanceUrlErrors.source_url}
                </span>
              ) : null}
            </label>
            <label className="grid gap-2 text-sm">
              <span>名称</span>
              <Input
                value={seedanceUrlDraft.name}
                onChange={event =>
                  setSeedanceUrlDraft(draft => ({
                    ...draft,
                    name: event.target.value,
                  }))
                }
                disabled={seedanceUrlBusy}
                placeholder="可选"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span>备注</span>
              <Textarea
                value={seedanceUrlDraft.description}
                onChange={event =>
                  setSeedanceUrlDraft(draft => ({
                    ...draft,
                    description: event.target.value,
                  }))
                }
                disabled={seedanceUrlBusy}
                rows={4}
                placeholder="可选"
              />
            </label>
            <AssetTypeSelect
              value={seedanceUrlDraft.asset_type}
              disabled={seedanceUrlBusy}
              onChange={asset_type =>
                setSeedanceUrlDraft(draft => ({ ...draft, asset_type }))
              }
            />
            <SeedanceTagPicker
              tags={seedanceTags}
              selectedIds={seedanceUrlDraft.tag_ids}
              disabled={seedanceUrlBusy}
              onChange={tag_ids =>
                setSeedanceUrlDraft(draft => ({ ...draft, tag_ids }))
              }
            />
            {seedanceUrlErrors.form ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {seedanceUrlErrors.form}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <button
              className="outline-button small"
              type="button"
              onClick={() => closeSeedanceUrlDialog()}
              disabled={seedanceUrlBusy}
            >
              取消
            </button>
            <button
              className="vermilion-button"
              type="button"
              onClick={() => void submitSeedanceUrlDialog()}
              disabled={seedanceUrlBusy}
            >
              {seedanceUrlBusy ? "提交中…" : "注册 URL"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={seedanceUploadDialogOpen}
        onOpenChange={nextOpen => {
          if (!nextOpen) {
            if (seedanceUploadBusy) return;
            closeSeedanceUploadDialog();
            return;
          }
          setSeedanceUploadDialogOpen(true);
        }}
      >
        <DialogContent
          className="sm:max-w-[720px]"
          showCloseButton={!seedanceUploadBusy}
          onEscapeKeyDown={event => {
            if (seedanceUploadBusy) event.preventDefault();
          }}
          onPointerDownOutside={event => {
            if (seedanceUploadBusy) event.preventDefault();
          }}
          onInteractOutside={event => {
            if (seedanceUploadBusy) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>上传 Seedance 文件</DialogTitle>
            <DialogDescription>
              上传图片或视频文件后创建 Seedance 素材记录，提交前请确认文件类型与标签。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <SeedanceReadiness readiness={seedanceReadiness} />
            {!seedanceReadiness?.provider_configured ? (
              <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
                当前 Provider 未配置，暂不能上传 Seedance 资产。
              </p>
            ) : null}
            {seedanceReadiness?.upload_registration_available === false ? (
              <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
                当前环境未开放上传注册，请先同步或稍后重试。
              </p>
            ) : null}
            <label className="grid gap-2 text-sm">
              <span>文件 *</span>
              <Input
                type="file"
                accept="image/*,video/*"
                disabled={seedanceUploadBusy}
                onChange={event => {
                  const file = event.target.files?.[0] || null;
                  setSeedanceUploadFile(file);
                  setSeedanceUploadErrors(current => ({
                    ...current,
                    file: undefined,
                    form: undefined,
                  }));
                  if (file) {
                    setSeedanceUploadDraft(draft => ({
                      ...draft,
                      asset_type: file.type.startsWith("video/")
                        ? "Video"
                        : "Image",
                      name: draft.name || file.name,
                    }));
                  }
                }}
              />
              {seedanceUploadFile ? (
                <small>已选择：{seedanceUploadFile.name}</small>
              ) : null}
              {seedanceUploadErrors.file ? (
                <span className="text-sm text-destructive">
                  {seedanceUploadErrors.file}
                </span>
              ) : null}
            </label>
            <label className="grid gap-2 text-sm">
              <span>名称</span>
              <Input
                value={seedanceUploadDraft.name}
                onChange={event =>
                  setSeedanceUploadDraft(draft => ({
                    ...draft,
                    name: event.target.value,
                  }))
                }
                disabled={seedanceUploadBusy}
                placeholder="可选"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span>备注</span>
              <Textarea
                value={seedanceUploadDraft.description}
                onChange={event =>
                  setSeedanceUploadDraft(draft => ({
                    ...draft,
                    description: event.target.value,
                  }))
                }
                disabled={seedanceUploadBusy}
                rows={4}
                placeholder="可选"
              />
            </label>
            <AssetTypeSelect
              value={seedanceUploadDraft.asset_type}
              disabled={seedanceUploadBusy}
              onChange={asset_type =>
                setSeedanceUploadDraft(draft => ({ ...draft, asset_type }))
              }
            />
            <SeedanceTagPicker
              tags={seedanceTags}
              selectedIds={seedanceUploadDraft.tag_ids}
              disabled={seedanceUploadBusy}
              onChange={tag_ids =>
                setSeedanceUploadDraft(draft => ({ ...draft, tag_ids }))
              }
            />
            {seedanceUploadErrors.form ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {seedanceUploadErrors.form}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <button
              className="outline-button small"
              type="button"
              onClick={() => closeSeedanceUploadDialog()}
              disabled={seedanceUploadBusy}
            >
              取消
            </button>
            <button
              className="vermilion-button"
              type="button"
              onClick={() => void submitSeedanceUploadDialog()}
              disabled={seedanceUploadBusy}
            >
              {seedanceUploadBusy ? "提交中…" : "上传并注册"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={seedanceTagDialogOpen}
        onOpenChange={nextOpen => {
          if (!nextOpen) {
            if (seedanceTagDialogBusy) return;
            closeSeedanceTagDialog();
            return;
          }
          setSeedanceTagDialogOpen(true);
        }}
      >
        <DialogContent
          className="sm:max-w-[560px]"
          showCloseButton={!seedanceTagDialogBusy}
          onEscapeKeyDown={event => {
            if (seedanceTagDialogBusy) event.preventDefault();
          }}
          onPointerDownOutside={event => {
            if (seedanceTagDialogBusy) event.preventDefault();
          }}
          onInteractOutside={event => {
            if (seedanceTagDialogBusy) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>新建 Seedance 标签</DialogTitle>
            <DialogDescription>
              创建后可在素材编辑中选择并绑定到素材。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <label className="grid gap-2 text-sm">
              <span>名称 *</span>
              <Input
                value={seedanceTagDialogDraft.name}
                onChange={event => {
                  setSeedanceTagDialogDraft(draft => ({
                    ...draft,
                    name: event.target.value,
                  }));
                  setSeedanceTagDialogErrors(errors => ({
                    ...errors,
                    name: undefined,
                    form: undefined,
                  }));
                }}
                disabled={seedanceTagDialogBusy}
                aria-invalid={Boolean(seedanceTagDialogErrors.name)}
                placeholder="请输入标签名称"
              />
              {seedanceTagDialogErrors.name ? (
                <span className="text-sm text-destructive">
                  {seedanceTagDialogErrors.name}
                </span>
              ) : null}
            </label>
            <label className="grid gap-2 text-sm">
              <span>颜色</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={
                    isSeedanceTagColor(seedanceTagDialogDraft.color)
                      ? seedanceTagDialogDraft.color.trim()
                      : SEEDANCE_TAG_DEFAULT_COLOR
                  }
                  onChange={event => {
                    setSeedanceTagDialogDraft(draft => ({
                      ...draft,
                      color: event.target.value,
                    }));
                    setSeedanceTagDialogErrors(errors => ({
                      ...errors,
                      color: undefined,
                      form: undefined,
                    }));
                  }}
                  disabled={seedanceTagDialogBusy}
                  className="h-10 w-12 rounded-md border border-input bg-background p-1"
                  aria-label="标签颜色"
                />
                <Input
                  value={seedanceTagDialogDraft.color}
                  onChange={event => {
                    setSeedanceTagDialogDraft(draft => ({
                      ...draft,
                      color: event.target.value,
                    }));
                    setSeedanceTagDialogErrors(errors => ({
                      ...errors,
                      color: undefined,
                      form: undefined,
                    }));
                  }}
                  disabled={seedanceTagDialogBusy}
                  aria-invalid={Boolean(seedanceTagDialogErrors.color)}
                  placeholder={SEEDANCE_TAG_DEFAULT_COLOR}
                />
              </div>
              {seedanceTagDialogErrors.color ? (
                <span className="text-sm text-destructive">
                  {seedanceTagDialogErrors.color}
                </span>
              ) : null}
            </label>
            {seedanceTagDialogErrors.form ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {seedanceTagDialogErrors.form}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <button
              className="outline-button small"
              type="button"
              onClick={() => closeSeedanceTagDialog()}
              disabled={seedanceTagDialogBusy}
            >
              取消
            </button>
            <button
              className="vermilion-button"
              type="button"
              onClick={() => void submitSeedanceTagDialog()}
              disabled={seedanceTagDialogBusy}
            >
              {seedanceTagDialogBusy ? "提交中…" : "创建标签"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={seedanceTagDeleteOpen}
        onOpenChange={nextOpen => {
          if (!nextOpen) {
            if (seedanceTagDeleteBusy) return;
            closeRemoveSeedanceTagDialog();
            return;
          }
          setSeedanceTagDeleteOpen(true);
        }}
      >
        <AlertDialogContent
          onEscapeKeyDown={event => {
            if (seedanceTagDeleteBusy) event.preventDefault();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>删除 Seedance 标签</AlertDialogTitle>
            <AlertDialogDescription>
              {seedanceTagDeleteTarget
                ? `确认删除「${seedanceTagDeleteTarget.name}」？删除后会解除其与素材的绑定。`
                : "请选择要删除的标签。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {seedanceTagDeleteError ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {seedanceTagDeleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={seedanceTagDeleteBusy}
              onClick={event => {
                if (seedanceTagDeleteBusy) event.preventDefault();
                else closeRemoveSeedanceTagDialog();
              }}
            >
              取消
            </AlertDialogCancel>
            <button
              className="vermilion-button"
              type="button"
              onClick={() => void confirmRemoveSeedanceTag()}
              disabled={
                seedanceTagDeleteBusy || !seedanceTagDeleteTarget?.id
              }
            >
              {seedanceTagDeleteBusy ? "删除中…" : "确认删除"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={seedanceEditDialogOpen}
        onOpenChange={nextOpen => {
          if (!nextOpen) {
            if (seedanceEditBusy) return;
            closeEditSeedanceAssetDialog();
            return;
          }
          setSeedanceEditDialogOpen(true);
        }}
      >
        <DialogContent
          className="sm:max-w-[760px]"
          showCloseButton={!seedanceEditBusy}
          onEscapeKeyDown={event => {
            if (seedanceEditBusy) event.preventDefault();
          }}
          onPointerDownOutside={event => {
            if (seedanceEditBusy) event.preventDefault();
          }}
          onInteractOutside={event => {
            if (seedanceEditBusy) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>编辑 Seedance 素材</DialogTitle>
            <DialogDescription>
              {seedanceEditTarget
                ? `正在编辑「${seedanceEditTarget.name}」（${seedanceEditTarget.id}），提交会同步名称、备注与标签。`
                : "请选择要编辑的 Seedance 素材。"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              {seedanceEditTarget
                ? `asset_type=${seedanceEditTarget.asset_type} · status=${seedanceEditTarget.status} · source=${seedanceEditTarget.volcano_asset_id || seedanceEditTarget.source_url || "-"}`
                : "target frozen"}
            </p>
            <label className="grid gap-2 text-sm">
              <span>名称 *</span>
              <Input
                value={seedanceEditDraft.name}
                onChange={event =>
                  setSeedanceEditDraft(draft => ({
                    ...draft,
                    name: event.target.value,
                  }))
                }
                disabled={seedanceEditBusy}
                placeholder="请输入素材名称"
              />
              {seedanceEditErrors.name ? (
                <span className="text-sm text-destructive">
                  {seedanceEditErrors.name}
                </span>
              ) : null}
            </label>
            <label className="grid gap-2 text-sm">
              <span>备注</span>
              <Textarea
                value={seedanceEditDraft.description}
                onChange={event =>
                  setSeedanceEditDraft(draft => ({
                    ...draft,
                    description: event.target.value,
                  }))
                }
                disabled={seedanceEditBusy}
                rows={4}
                placeholder="可选"
              />
            </label>
            <SeedanceTagPicker
              tags={seedanceTags}
              selectedIds={seedanceEditDraft.tag_ids}
              disabled={seedanceEditBusy}
              onChange={tag_ids =>
                setSeedanceEditDraft(draft => ({ ...draft, tag_ids }))
              }
            />
            {seedanceEditErrors.form ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {seedanceEditErrors.form}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <button
              className="outline-button small"
              type="button"
              onClick={() => closeEditSeedanceAssetDialog()}
              disabled={seedanceEditBusy}
            >
              取消
            </button>
            <button
              className="vermilion-button"
              type="button"
              onClick={() => void submitSeedanceEditDialog()}
              disabled={seedanceEditBusy}
            >
              {seedanceEditBusy ? "提交中…" : "保存修改"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={seedanceDeleteOpen}
        onOpenChange={nextOpen => {
          if (!nextOpen) {
            if (seedanceDeleteBusy) return;
            closeRemoveSeedanceAssetDialog();
            return;
          }
          setSeedanceDeleteOpen(true);
        }}
      >
        <AlertDialogContent
          onEscapeKeyDown={event => {
            if (seedanceDeleteBusy) event.preventDefault();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>删除 Seedance 素材</AlertDialogTitle>
            <AlertDialogDescription>
              {seedanceDeleteTarget
                ? `确认删除「${seedanceDeleteTarget.name}」（${seedanceDeleteTarget.id}）？这会同时请求上游素材库删除该资产。`
                : "请选择要删除的 Seedance 素材。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {seedanceDeleteError ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {seedanceDeleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={seedanceDeleteBusy}
              onClick={event => {
                if (seedanceDeleteBusy) event.preventDefault();
                else closeRemoveSeedanceAssetDialog();
              }}
            >
              取消
            </AlertDialogCancel>
            <button
              className="vermilion-button"
              type="button"
              onClick={() => void confirmRemoveSeedanceAsset()}
              disabled={seedanceDeleteBusy || !seedanceDeleteTarget?.id}
            >
              {seedanceDeleteBusy ? "删除中…" : "确认删除"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SeedanceReadiness({
  readiness,
}: {
  readiness: SeedanceAssetsController["readiness"];
}) {
  return (
    <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
      {readiness
        ? `provider=${readiness.provider_configured ? "ready" : "missing"} · upload=${readiness.upload_registration_available ? "on" : "off"} · publicBase=${readiness.public_asset_base_url_configured ? "on" : "off"}`
        : "readiness loading"}
      {readiness?.provider_error ? ` · ${readiness.provider_error}` : ""}
    </p>
  );
}

function AssetTypeSelect({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (value: "Image" | "Video") => void;
  value: "Image" | "Video";
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span>资产类型</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value as "Image" | "Video")}
        disabled={disabled}
        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="Image">Image</option>
        <option value="Video">Video</option>
      </select>
    </label>
  );
}

function SeedanceTagPicker({
  disabled,
  onChange,
  selectedIds,
  tags,
}: {
  disabled: boolean;
  onChange: (tagIds: string[]) => void;
  selectedIds: string[];
  tags: SeedanceAssetTag[];
}) {
  return (
    <div className="grid gap-2 text-sm">
      <span>标签</span>
      <div className="flex flex-wrap gap-2">
        {tags.length ? (
          tags.map(tag => {
            const selected = selectedIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                className={selected ? "selected" : ""}
                disabled={disabled}
                aria-pressed={selected}
                onClick={() =>
                  onChange(
                    selected
                      ? selectedIds.filter(tagId => tagId !== tag.id)
                      : [...selectedIds, tag.id]
                  )
                }
              >
                {tag.name}
              </button>
            );
          })
        ) : (
          <span className="text-sm text-muted-foreground">
            暂无标签，可先创建标签后再绑定。
          </span>
        )}
      </div>
    </div>
  );
}
