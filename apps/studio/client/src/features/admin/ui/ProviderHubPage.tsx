import { ProviderHub } from "@ai-manju/provider-hub";
import "../styles.css";
import "@ai-manju/provider-hub/styles.css";
import "./provider-hub-page.css";
import { Link } from "wouter";
import { useModelProvidersController } from "../controllers/useModelProvidersController";
import { ProvidersPanel } from "./ProvidersPanel";

export default function ProviderHubPage() {
  const controller = useModelProvidersController(true);
  return <div className="provider-hub-page">
    <div className="provider-hub-back"><Link href="/admin">← 管理后台</Link></div>
    <ProviderHub
      providers={controller.providers} draft={controller.providerDraft}
      busy={Boolean(controller.busy)} loading={controller.isPending} error={controller.loadError}
      onSelect={controller.selectProvider} onCreate={() => controller.createProviderDraft()}
      onReload={() => void controller.reload()} onSaveJSON={controller.saveProvider}
      renderForm={() => <ProvidersPanel controller={controller} editorOnly />}
    />
  </div>;
}
