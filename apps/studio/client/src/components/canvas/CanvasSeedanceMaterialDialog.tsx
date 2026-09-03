import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, ExternalLink, Plus, Search, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createMaterialAsset,
  createMaterialGroup,
  createRealValidateH5,
  createVisualValidateSession,
  deleteMaterialAsset,
  deleteMaterialGroup,
  ensureMaterialAssetsActive,
  getMaterialAsset,
  getMaterialGroup,
  getVisualValidateResult,
  materialAssetFromResponse,
  materialBytedToken,
  materialH5Link,
  type SeedanceMaterialAsset,
  type SeedanceMaterialResponse,
} from "@/services/api/material";

type CanvasSeedanceMaterialDialogProps = {
  open: boolean;
  selectedAssets?: SeedanceMaterialAsset[];
  onClose: () => void;
  onSelect: (asset: SeedanceMaterialAsset) => void;
  onRemove?: (assetId: string) => void;
};

const emptyPayload = "{}";

export function CanvasSeedanceMaterialDialog({ open, selectedAssets = [], onClose, onSelect, onRemove }: CanvasSeedanceMaterialDialogProps) {
  const [validatePayload, setValidatePayload] = useState(emptyPayload);
  const [h5Payload, setH5Payload] = useState(emptyPayload);
  const [bytedToken, setBytedToken] = useState("");
  const [groupPayload, setGroupPayload] = useState(emptyPayload);
  const [assetPayload, setAssetPayload] = useState(emptyPayload);
  const [groupId, setGroupId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [loadingKey, setLoadingKey] = useState("");
  const [lastResponse, setLastResponse] = useState<SeedanceMaterialResponse | null>(null);
  const [assets, setAssets] = useState<SeedanceMaterialAsset[]>([]);
  const h5Link = useMemo(() => lastResponse ? materialH5Link(lastResponse) : "", [lastResponse]);

  useEffect(() => {
    if (open && selectedAssets.length) setAssets((current) => mergeAssets(selectedAssets, current));
  }, [open, selectedAssets]);

  const run = async (key: string, action: () => Promise<SeedanceMaterialResponse>, success: string, onSuccess?: (result: SeedanceMaterialResponse) => void) => {
    setLoadingKey(key);
    try {
      const result = await action();
      setLastResponse(result);
      onSuccess?.(result);
      const asset = materialAssetFromResponse(result);
      if (asset) setAssets((current) => mergeAssets([asset], current));
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "素材库请求失败");
    } finally {
      setLoadingKey("");
    }
  };

  const selectAsset = async (asset: SeedanceMaterialAsset) => {
    try {
      await ensureMaterialAssetsActive([asset.id]);
      onSelect({ ...asset, status: asset.status || "Active" });
      toast.success("已选入 Seedance 活体授权素材");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "素材未激活");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="canvas-seedance-dialog canvas-material-dialog sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>Seedance 活体授权素材</DialogTitle>
          <DialogDescription>完成真人授权、素材组和素材管理后，可将 Active 素材作为 `asset://` 引用选入当前节点。</DialogDescription>
        </DialogHeader>
        <div className="canvas-material-layout">
          <div>
            <MaterialSection title="真人授权">
              <PayloadBox value={validatePayload} onChange={setValidatePayload} />
              <div className="canvas-material-actions"><button type="button" onClick={() => void run("validate", () => createVisualValidateSession(parsePayload(validatePayload)), "已创建校验会话", (result) => setBytedToken(materialBytedToken(result)))} disabled={loadingKey === "validate"}><UserRound size={15} /> 创建校验会话</button><button type="button" onClick={() => void run("h5", () => createRealValidateH5(parsePayload(h5Payload)), "已创建授权链接")} disabled={loadingKey === "h5"}><ExternalLink size={15} /> 创建授权 H5</button>{h5Link ? <button type="button" onClick={() => window.open(h5Link, "_blank", "noopener,noreferrer")}><ExternalLink size={15} /> 打开授权</button> : null}</div>
              <PayloadBox value={h5Payload} onChange={setH5Payload} compact />
              <div className="canvas-material-id-row"><input value={bytedToken} onChange={(event) => setBytedToken(event.target.value)} placeholder="BytedToken" /><button type="button" onClick={() => void run("result", () => getVisualValidateResult(bytedToken.trim()), "已查询授权结果")} disabled={!bytedToken.trim() || loadingKey === "result"}><Search size={15} /> 查询</button></div>
            </MaterialSection>
            <MaterialSection title="素材组">
              <PayloadBox value={groupPayload} onChange={setGroupPayload} />
              <div className="canvas-material-actions"><button type="button" onClick={() => void run("create-group", () => createMaterialGroup(parsePayload(groupPayload)), "已创建素材组")}><Plus size={15} /> 创建组</button><input value={groupId} onChange={(event) => setGroupId(event.target.value)} placeholder="Group Id" /><button type="button" onClick={() => void run("get-group", () => getMaterialGroup(groupId.trim()), "已查询素材组")} disabled={!groupId.trim()}><Search size={15} /> 查询组</button><button type="button" className="danger" onClick={() => void run("delete-group", () => deleteMaterialGroup(groupId.trim()), "已删除素材组")} disabled={!groupId.trim()}><Trash2 size={15} /> 删除组</button></div>
            </MaterialSection>
            <MaterialSection title="素材">
              <PayloadBox value={assetPayload} onChange={setAssetPayload} />
              <div className="canvas-material-actions"><button type="button" onClick={() => void run("create-asset", () => createMaterialAsset(parsePayload(assetPayload)), "已创建素材")}><Plus size={15} /> 创建素材</button><input value={assetId} onChange={(event) => setAssetId(event.target.value)} placeholder="Asset Id" /><button type="button" onClick={() => void run("get-asset", () => getMaterialAsset(assetId.trim()), "已查询素材")} disabled={!assetId.trim()}><Search size={15} /> 查询素材</button><button type="button" className="danger" onClick={() => void run("delete-asset", () => deleteMaterialAsset(assetId.trim()), "已删除素材")} disabled={!assetId.trim()}><Trash2 size={15} /> 删除素材</button></div>
            </MaterialSection>
          </div>
          <div>
            <MaterialSection title="可用素材">
              <div className="canvas-material-assets">{assets.length ? assets.map((asset) => <article key={asset.id}><div><b>{asset.name || asset.id}</b><code>asset://{asset.id}</code><span>{asset.status || "Unknown"}</span></div><div><button type="button" title="复制引用" onClick={() => void navigator.clipboard.writeText(`asset://${asset.id}`).then(() => toast.success("已复制"))}><Copy size={14} /></button><button type="button" onClick={() => void selectAsset(asset)}>选入生成</button>{onRemove ? <button type="button" title="移除素材" onClick={() => { onRemove(asset.id); setAssets((current) => current.filter((item) => item.id !== asset.id)); }}><Trash2 size={14} /></button> : null}</div></article>) : <p>查询或创建素材后会显示在这里。</p>}</div>
            </MaterialSection>
            <MaterialSection title="最近响应"><pre>{lastResponse ? JSON.stringify(lastResponse, null, 2) : "{}"}</pre></MaterialSection>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function mergeAssets(primary: SeedanceMaterialAsset[], secondary: SeedanceMaterialAsset[]) {
  const seen = new Set<string>();
  return [...primary, ...secondary].filter((asset) => asset.id && !seen.has(asset.id) && Boolean(seen.add(asset.id)));
}

function MaterialSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="canvas-material-section"><h4>{title}</h4>{children}</section>;
}

function PayloadBox({ value, onChange, compact = false }: { value: string; onChange: (value: string) => void; compact?: boolean }) {
  return <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={compact ? 2 : 3} spellCheck={false} />;
}

function parsePayload(value: string) {
  const parsed = JSON.parse(value.trim() || "{}") as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON 必须是对象");
  return parsed as Record<string, unknown>;
}
