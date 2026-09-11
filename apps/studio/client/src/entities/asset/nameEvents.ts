import type { WorkspaceScope } from "@/shared/config";

export const ASSET_NAME_SYNC_CHANNEL = "ai-manju:asset-name";
export const ASSET_NAME_SYNC_EVENT = "ai-manju:asset-name";

export type AssetNameSyncMessage = {
  assetId: string;
  name: string;
  scope: WorkspaceScope;
};

function isAssetNameSyncMessage(value: unknown): value is AssetNameSyncMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as AssetNameSyncMessage;
  return Boolean(message.assetId && message.name && (message.scope === "personal" || message.scope === "team"));
}

let publishChannel: BroadcastChannel | null | undefined;

function getPublishChannel(): BroadcastChannel | null {
  if (publishChannel !== undefined) return publishChannel;
  if (typeof BroadcastChannel === "undefined") {
    publishChannel = null;
    return null;
  }
  try {
    publishChannel = new BroadcastChannel(ASSET_NAME_SYNC_CHANNEL);
  } catch {
    publishChannel = null;
  }
  return publishChannel;
}

export function publishAssetNameChange(message: AssetNameSyncMessage) {
  if (!isAssetNameSyncMessage(message)) return;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ASSET_NAME_SYNC_EVENT, { detail: message }));
  }
  try {
    getPublishChannel()?.postMessage(message);
  } catch {
    /* 非浏览器或通道不可用时忽略 */
  }
}

export function subscribeAssetNameChanges(
  onMessage: (message: AssetNameSyncMessage) => void,
): () => void {
  const handleWindow = (event: Event) => {
    const detail = "detail" in event ? (event as CustomEvent).detail : undefined;
    if (isAssetNameSyncMessage(detail)) onMessage(detail);
  };
  if (typeof window !== "undefined") {
    window.addEventListener(ASSET_NAME_SYNC_EVENT, handleWindow);
  }

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(ASSET_NAME_SYNC_CHANNEL);
      channel.onmessage = event => {
        if (isAssetNameSyncMessage(event.data)) onMessage(event.data);
      };
    } catch {
      channel = null;
    }
  }

  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener(ASSET_NAME_SYNC_EVENT, handleWindow);
    }
    channel?.close();
  };
}
