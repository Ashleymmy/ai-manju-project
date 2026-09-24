import { parseAgentDocument } from "./documentParser";

self.onmessage = async (event: MessageEvent<{ name: string; buffer: ArrayBuffer }>) => {
  try {
    self.postMessage({ text: await parseAgentDocument(event.data.name, event.data.buffer) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "文件读取失败，请检查格式或密码保护" });
  }
};
