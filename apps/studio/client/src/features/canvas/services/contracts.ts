export type CanvasServiceOperation<Result> = () => Promise<Result>;
export type CanvasServiceExecutor = <Result>(operation: CanvasServiceOperation<Result>) => Promise<Result>;

export type CanvasServices = {
  project: CanvasServiceExecutor;
  generation: CanvasServiceExecutor;
  assets: CanvasServiceExecutor;
  agent: CanvasServiceExecutor;
};

export function createCanvasServices(overrides: Partial<CanvasServices> = {}): CanvasServices {
  const executeDirectly: CanvasServiceExecutor = (operation) => operation();
  return {
    project: overrides.project || executeDirectly,
    generation: overrides.generation || executeDirectly,
    assets: overrides.assets || executeDirectly,
    agent: overrides.agent || executeDirectly,
  };
}
