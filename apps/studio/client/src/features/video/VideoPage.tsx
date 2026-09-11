import VideoWorkbenchView from "./ui/VideoWorkbenchView";
import { useAuth } from "@/contexts/AuthContext";

import "./styles.css";

export default function VideoPage() {
  const { user } = useAuth();
  return user ? <VideoWorkbenchView key={user.id} ownerId={user.id} /> : null;
}
