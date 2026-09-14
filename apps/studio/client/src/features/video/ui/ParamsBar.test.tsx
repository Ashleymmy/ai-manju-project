import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ParamsBar } from "./ParamsBar";

describe("video model selector", () => {
  it("shows the actual model once and keeps saved routing without showing supplier aliases", () => {
    const html = renderToStaticMarkup(<ParamsBar
      models={["a::wan3.0-video", "b::wan3.0-video", "a::sora-2"]}
      labels={{ "a::wan3.0-video": "供应商甲别名", "b::wan3.0-video": "供应商乙别名" }}
      config={{ model: "removed::wan3.0-video", size: "16:9", resolution: "720p", seconds: "5", generateAudio: true, watermark: false }}
      onChange={() => undefined} disabled={false}
    />);
    expect(html.match(/>wan3\.0-video<\/option>/g)).toHaveLength(1);
    expect(html).toContain('value="removed::wan3.0-video" selected=""');
    expect(html).not.toContain("供应商");
  });
});
