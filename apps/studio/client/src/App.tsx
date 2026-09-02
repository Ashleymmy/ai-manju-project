import { AppProviders } from "@/app/providers";
import { AppRouter } from "@/app/routes";

export default function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
