import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ParamsBar } from "./ParamsBar";

describe("video model selector", () => {
  it("renders official and proxy SD-video labels with independent routing values", () => {
    const html = renderToStaticMarkup(<ParamsBar
      models={["sdvideo/seedance-2.0", "sdvideo/seedance-2.0-ark", "sdvideo/vidu-q3"]}
      labels={{ "sdvideo/seedance-2.0": "Seedance 2.0", "sdvideo/seedance-2.0-ark": "Seedance 2.0 · 火山方舟官方", "sdvideo/vidu-q3": "Vidu Q3" }}
      config={{ model: "sdvideo/seedance-2.0-ark", size: "16:9", resolution: "720p", seconds: "5", generateAudio: true, watermark: false }}
      onChange={() => undefined} disabled={false}
    />);
    expect(html).toContain('value="sdvideo/seedance-2.0-ark" selected="">Seedance 2.0 · 火山方舟官方</option>');
    expect(html).toContain('value="sdvideo/seedance-2.0">Seedance 2.0</option>');
    expect(html).toContain('value="sdvideo/vidu-q3">Vidu Q3</option>');
    expect(html).not.toContain(">sdvideo/");
  });
  it("keeps all video provider routes and aliases alongside an older saved selection", () => {
    const html = renderToStaticMarkup(<ParamsBar
      models={["a::wan3.0-video", "b::wan3.0-video", "a::sora-2"]}
      labels={{ "a::wan3.0-video": "供应商甲别名", "b::wan3.0-video": "供应商乙别名" }}
      config={{ model: "removed::wan3.0-video", size: "16:9", resolution: "720p", seconds: "5", generateAudio: true, watermark: false }}
      onChange={() => undefined} disabled={false}
    />);
    expect(html.match(/>wan3\.0-video（当前不可用）<\/option>/g)).toHaveLength(1);
    expect(html).toContain('value="removed::wan3.0-video" disabled="" selected=""');
    expect(html).toContain('value="a::wan3.0-video">供应商甲别名</option>');
    expect(html).toContain('value="b::wan3.0-video">供应商乙别名</option>');
  });
});
