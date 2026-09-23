import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SeedanceAsset } from "@/entities/asset";
import { publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";
import type { CanvasNodeData } from "../domain/types";
import {
  registerCanvasImageAsset, registrationProviderId, savedSeedanceRegistration,
  seedanceRegistrationKey, seedanceRegistrationPhase, type SeedanceRegistrationState,
} from "../services/seedanceRegistration";

// Progress lives on the node; notifications disappear so they do not cover the canvas.
const REGISTRATION_TOAST_SUCCESS_MS = 5_000;
const REGISTRATION_TOAST_NOTICE_MS = 8_000;
// Limit uploads/polling together so a large selection cannot flood the provider.
const REGISTRATION_BATCH_CONCURRENCY = 3;
const REGISTRATION_ERROR_PREVIEW_COUNT = 3;

type RegistrationTarget = { nodeId: string; model: string; projectKey: string; nodeIds?: string[]; skippedCount?: number };
type RegistrationOptions = {
  getContext: () => { projectKey: string | null; scope: WorkspaceScope | null; switching: boolean; nodes: CanvasNodeData[] };
  loadFile: (node: CanvasNodeData, scope: WorkspaceScope) => Promise<File>;
  onUpdate: (node: CanvasNodeData, asset: SeedanceAsset, providerId?: string) => Promise<void>;
};

export function useCanvasSeedanceRegistration(options: RegistrationOptions) {
  const [target, setTarget] = useState<RegistrationTarget | null>(null);
  const [states, setStates] = useState<Record<string, SeedanceRegistrationState>>({});
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const isRegistering = (projectKey: string, node: CanvasNodeData) => inFlight.current.has(seedanceRegistrationKey(projectKey, node));
  const registerNode = async (node: CanvasNodeData, target: RegistrationTarget, scope: WorkspaceScope, notify: boolean) => {
    const { model, projectKey } = target;
    const nodeId = node.id;
    const key = seedanceRegistrationKey(projectKey, node);
    const providerId = registrationProviderId(model);
    const saved = savedSeedanceRegistration(node);
    const existing = saved ? node.metadata?.seedanceVolcanoAssets?.find(item => item.id === saved.id && (item.providerId || "") === (providerId || "")) : undefined;
    const toastId = notify ? toast.info("已开始后台注册，可继续操作画布", {
      duration: REGISTRATION_TOAST_SUCCESS_MS,
      description: `${node.title || "当前图片"} · 完成后会通知你`,
    }) : undefined;
    const canUpdateNode = () => {
      if (!mounted.current) return false;
      const current = optionsRef.current.getContext();
      return !current.switching && current.projectKey === projectKey
        && current.nodes.some(item => item.id === nodeId && seedanceRegistrationKey(projectKey, item) === key);
    };
    const onState = (state: SeedanceRegistrationState) => {
      if (canUpdateNode()) setStates(previous => ({ ...previous, [key]: state }));
    };
    try {
      const asset = await registerCanvasImageAsset({
        scope, providerId, existing,
        loadFile: () => optionsRef.current.loadFile(node, scope),
        // Navigating away detaches node updates, not the accepted registration.
        isCurrent: () => true,
        onState,
        onUpdate: async asset => {
          if (canUpdateNode()) await optionsRef.current.onUpdate(node, asset, providerId);
        },
      });
      const phase = seedanceRegistrationPhase(asset);
      onState({ phase });
      if (notify && phase === "success") {
        toast.success("拟真人素材注册成功", {
          id: toastId, duration: REGISTRATION_TOAST_SUCCESS_MS,
          description: `${node.title || "当前图片"} · 已加入资产库「真人素材」，可用于视频参考`,
        });
      } else if (notify) {
        toast.warning("素材已上传，后台仍在处理中", {
          id: toastId, duration: REGISTRATION_TOAST_NOTICE_MS,
          description: `${node.title || "当前图片"} · 可在资产库「真人素材」查看，或点击注册按钮刷新状态，无需重复上传。`,
        });
      }
      return { phase, name: node.title, error: "" };
    } catch (error) {
      const message = publicApiError(error, "拟真人素材注册失败");
      onState({ phase: "error", error: message });
      if (notify) toast.error("拟真人素材上传或注册失败", {
        id: toastId, duration: REGISTRATION_TOAST_NOTICE_MS,
        description: `${node.title || "当前图片"} · ${message}；可点击注册按钮重试。`,
      });
      return { phase: "error" as const, name: node.title, error: message };
    } finally {
      inFlight.current.delete(key);
      if (mounted.current && !canUpdateNode()) {
        // Returning to the original canvas must not resurrect a finished spinner.
        setStates(previous => {
          const next = { ...previous };
          delete next[key];
          return next;
        });
      }
      // Never close a dialog here: the user may already be registering another image.
    }
  };

  const submit = async () => {
    if (!target) return;
    const context = optionsRef.current.getContext();
    if (!context.scope || context.switching || context.projectKey !== target.projectKey || !target.model) return;
    const batch = Boolean(target.nodeIds);
    const providerId = registrationProviderId(target.model);
    let skipped = target.skippedCount || 0;
    const ids = new Set(target.nodeIds || [target.nodeId]);
    const candidates = context.nodes.filter(node => ids.has(node.id) && node.kind === "image");
    const nodes = candidates.filter(node => {
      const saved = savedSeedanceRegistration(node);
      const registered = saved && seedanceRegistrationPhase(saved) === "success"
        && node.metadata?.seedanceVolcanoAssets?.some(asset => asset.id === saved.id && (asset.providerId || "") === (providerId || ""));
      if (registered || isRegistering(target.projectKey, node)) { skipped++; return false; }
      return true;
    });
    setTarget(null);
    if (!nodes.length) {
      toast.info(batch ? "所选图片已注册或正在注册，无需重复上传" : "该图片已经注册过拟真人素材");
      return;
    }
    // Reserve queued nodes before the first await; repeated batch/single actions
    // share the same locks. Accepted work continues after navigating away.
    nodes.forEach(node => inFlight.current.add(seedanceRegistrationKey(target.projectKey, node)));
    if (!batch) { await registerNode(nodes[0], target, context.scope, true); return; }
    setStates(previous => ({ ...previous, ...Object.fromEntries(nodes.map(node => [seedanceRegistrationKey(target.projectKey, node), { phase: "queued" as const }])) }));
    const toastId = toast.info(`已开始后台批量注册 ${nodes.length} 张图片`, { duration: REGISTRATION_TOAST_SUCCESS_MS });
    const results: Awaited<ReturnType<typeof registerNode>>[] = [];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(REGISTRATION_BATCH_CONCURRENCY, nodes.length) }, async () => {
      while (cursor < nodes.length) {
        const node = nodes[cursor++];
        results.push(await registerNode(node, target, context.scope!, false));
      }
    }));
    const success = results.filter(result => result.phase === "success").length;
    const failed = results.filter(result => result.phase === "error");
    const pending = results.length - success - failed.length;
    const summary = `成功 ${success} 张，处理中 ${pending} 张，失败 ${failed.length} 张，跳过 ${skipped} 项`;
    const failures = failed.slice(0, REGISTRATION_ERROR_PREVIEW_COUNT).map(result => `${result.name}：${result.error}`).join("；");
    const announce = failed.length || pending ? toast.warning : toast.success;
    announce("拟真人素材批量注册完成", {
      id: toastId, duration: REGISTRATION_TOAST_NOTICE_MS,
      description: `${summary}。${failures ? `${failures}。失败图片可重新框选重试。` : "可在资产库「真人素材」查看。"}`,
    });
  };

  return { target, setTarget, states, submit, isRegistering };
}
