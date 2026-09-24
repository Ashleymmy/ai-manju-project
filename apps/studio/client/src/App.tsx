import { AppProviders } from "@/app/providers";
import { AppRouter } from "@/app/routes";
import { AssetImportTaskHost } from "@/features/assets";
import { RuntimeErrorReporter } from "@/components/RuntimeErrorReporter";

export default function App() {
  return (
    <AppProviders>
      <RuntimeErrorReporter />
      <AppRouter />
      <AssetImportTaskHost />
    </AppProviders>
  );
}
