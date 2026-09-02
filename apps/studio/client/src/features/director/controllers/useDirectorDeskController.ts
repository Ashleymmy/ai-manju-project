import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import type { Asset } from "@/entities/asset";
import { publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";

import {
  createBrowserDirectorBridgeEnvironment,
  DirectorBridgeClient,
} from "../bridge/DirectorBridgeClient";
import { resolveDirectorRoute } from "../model/navigation";
import {
  isRecord,
  type DirectorFrameExport,
  type RequestDirector,
} from "../model/protocol";
import {
  createCanvasFromDirectorAsset,
  writeDirectorFrameToCanvas,
} from "../services/canvasWriteBack";
import { archiveDirectorFrame } from "../services/frameArchive";

export function useDirectorDeskController() {
  const [, navigate] = useLocation();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeRef = useRef<DirectorBridgeClient | null>(null);
  const route = useMemo(
    () =>
      resolveDirectorRoute(window.location.search, window.location.origin, () =>
        crypto.randomUUID()
      ),
    []
  );
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastAsset, setLastAsset] = useState<Asset | null>(null);
  const [lastFrame, setLastFrame] = useState<DirectorFrameExport | null>(null);
  const [capabilities, setCapabilities] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [scope, setScope] = useState<WorkspaceScope>(route.scope);

  useEffect(() => {
    const bridge = new DirectorBridgeClient({
      environment: createBrowserDirectorBridgeEnvironment(window),
      getTarget: () => iframeRef.current?.contentWindow || null,
      instanceId: route.instanceId,
      callbacks: {
        onReady: () => setReady(true),
        onCapabilities: data => setCapabilities(isRecord(data) ? data : null),
      },
    });
    bridgeRef.current = bridge;
    bridge.start();
    return () => {
      if (bridgeRef.current === bridge) bridgeRef.current = null;
      bridge.dispose();
    };
  }, [route.instanceId]);

  const requestDirector = useCallback<RequestDirector>((action, options) => {
    const bridge = bridgeRef.current;
    return bridge
      ? bridge.request(action, options)
      : Promise.reject(new Error("导演台 iframe 尚未准备好"));
  }, []);

  const captureFrameAsset = useCallback(async () => {
    const result = await archiveDirectorFrame({
      requestDirector,
      instanceId: route.instanceId,
      canvasId: route.canvasId,
      nodeId: route.nodeId,
      hasCanvasTarget: route.hasCanvasTarget,
      scope,
    });
    setLastFrame(result.frame);
    setLastAsset(result.asset);
    return result;
  }, [requestDirector, route, scope]);

  const exportFrame = useCallback(async () => {
    setBusy(true);
    try {
      await captureFrameAsset();
      toast.success("当前帧已保存到资产库");
    } catch (error) {
      toast.error(publicApiError(error, "导出导演台当前帧失败"));
    } finally {
      setBusy(false);
    }
  }, [captureFrameAsset]);

  const sendToCanvas = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (route.hasCanvasTarget) {
        const result = await writeDirectorFrameToCanvas({
          requestDirector,
          archiveFrame: captureFrameAsset,
          instanceId: route.instanceId,
          canvasId: route.canvasId,
          nodeId: route.nodeId,
          scope,
        });
        if (result.kind === "duplicate") {
          toast.info("当前工程与机位帧已经生成过，未重复创建图片节点");
          navigate(route.returnPath);
          return;
        }
        toast.success("当前机位已回写来源画布");
        navigate(route.returnPath);
        return;
      }
      if (!lastAsset) {
        toast.warning("请先导出当前帧");
        return;
      }
      const project = await createCanvasFromDirectorAsset({
        asset: lastAsset,
        scope,
      });
      navigate(`/canvas/${encodeURIComponent(project.id)}?scope=${scope}`);
    } catch (error) {
      toast.error(publicApiError(error, "送入画布失败"));
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    captureFrameAsset,
    lastAsset,
    navigate,
    requestDirector,
    route,
    scope,
  ]);

  const returnToCanvas = useCallback(
    () => navigate(route.returnPath),
    [navigate, route.returnPath]
  );
  const openStandalone = useCallback(
    () => window.open(route.directorSrc, "_blank"),
    [route.directorSrc]
  );

  return {
    iframeRef,
    ready,
    busy,
    lastAsset,
    lastFrame,
    capabilities,
    scope,
    setScope,
    hasCanvasTarget: route.hasCanvasTarget,
    directorSrc: route.directorSrc,
    exportFrame,
    sendToCanvas,
    returnToCanvas,
    openStandalone,
  };
}
