import { createRoot } from "react-dom/client";
import "./shared/styles/global.css";
import App from "./App";
import { QueryProvider } from "./app/providers/QueryProvider";

createRoot(document.getElementById("root")!).render(
  <QueryProvider>
    <App />
  </QueryProvider>
);
