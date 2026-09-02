export type CanvasTextNodeLike = {
  kind: string;
  content: string;
  metadata?: Record<string, unknown> & {
    content?: string;
    prompt?: string;
    composerContent?: string;
    status?: string;
  };
};

export type CanvasTextRequestMessage = {
  role: "user";
  content: string | Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: { url: string } }
  >;
};

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function canvasTextDisplayValue(node: CanvasTextNodeLike) {
  return node.content || textValue(node.metadata?.content);
}

export function canvasTextComposerValue(node: CanvasTextNodeLike) {
  const composer = textValue(node.metadata?.composerContent);
  if (composer) return composer;
  const prompt = textValue(node.metadata?.prompt);
  if (prompt) return prompt;
  if (isGeneratedCanvasText(node)) return "";
  return node.content || textValue(node.metadata?.content);
}

export function isGeneratedCanvasText(node: CanvasTextNodeLike) {
  return node.kind === "text"
    && node.metadata?.status === "success";
}

export function canvasTextRequestPrompt(node: CanvasTextNodeLike, composerPrompt: string) {
  if (!isGeneratedCanvasText(node)) return composerPrompt;
  return `请根据要求修改以下文本。\n\n原文：\n${canvasTextDisplayValue(node)}\n\n修改要求：\n${composerPrompt}`;
}

export function buildCanvasTextRequestMessages(prompt: string, imageDataUrls: readonly string[]): CanvasTextRequestMessage[] {
  if (!imageDataUrls.length) return [{ role: "user", content: prompt }];
  return [{
    role: "user",
    content: [
      { type: "input_text", text: prompt },
      ...imageDataUrls.map((url) => ({ type: "input_image" as const, image_url: { url } })),
    ],
  }];
}

export function updateCanvasNodeComposer<T extends CanvasTextNodeLike>(node: T, composerContent: string): T {
  const generatedText = isGeneratedCanvasText(node);
  return {
    ...node,
    content: generatedText ? node.content : composerContent,
    metadata: {
      ...(node.metadata || {}),
      content: generatedText ? node.metadata?.content : composerContent,
      prompt: composerContent,
      composerContent,
    },
  };
}

export function updateCanvasTextDisplay<T extends CanvasTextNodeLike>(node: T, content: string): T {
  return {
    ...node,
    content,
    metadata: {
      ...(node.metadata || {}),
      content,
    },
  };
}
