import { useMonitoringController } from "../controllers/useMonitoringController";
import { MonitoringPanel } from "./MonitoringPanel";

export default function MonitoringPage() {
  const controller = useMonitoringController(true);
  return (
    <div className="feature-page">
      <MonitoringPanel controller={controller} />
    </div>
  );
}
