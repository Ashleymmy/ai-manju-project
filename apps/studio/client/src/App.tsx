import { AppProviders } from "@/app/providers";
import { AppRouter } from "@/app/routes";
import { AssetImportTaskHost } from "@/features/assets";

export default function App() {
  return (
    <AppProviders>
      <AppRouter />
      <AssetImportTaskHost />
    </AppProviders>
  );
}
