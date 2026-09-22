import { expect, test } from "@playwright/test";

for (const withReference of [false, true]) {
  test(`image parameter buttons reach ${withReference ? "reference edits" : "generation"} and output dimensions are verified`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const sizes = ["1024x1024", "1728x2304", "3840x2160", "1536x1024"];
    const fixtures = await page.evaluate(
      dimensions =>
        Object.fromEntries(
          dimensions.map(size => {
            const [width, height] = size.split("x").map(Number);
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d")!;
            context.fillStyle = "#224739";
            context.fillRect(0, 0, width, height);
            context.fillStyle = "#ffe298";
            context.beginPath();
            context.arc(
              width / 2,
              height / 2,
              Math.min(width, height) / 4,
              0,
              Math.PI * 2
            );
            context.fill();
            return [size, canvas.toDataURL("image/png").split(",")[1]];
          })
        ),
      sizes
    );
    await page.addInitScript(() => {
      localStorage.setItem("ai-manju:auth_token", "qa-token");
      localStorage.setItem("ai-manju:token-store", "local");
    });
    const project = {
      id: "image-parameters-qa",
      title: "图片参数验收",
      scope: "personal",
      owner_id: "qa",
    };
    const prompt = withReference
      ? "四个不同的苹果 @[node:reference]"
      : "四个不同的苹果";
    let snapshot: any = {
      schema: "ai-manhua-studio-canvas",
      version: 3,
      nodes: [
        {
          id: "target",
          kind: "image",
          title: "图片参数验收",
          content: prompt,
          x: 350,
          y: 50,
          width: 320,
          height: 238,
          metadata: {
            prompt,
            composerContent: prompt,
            model: "gpt-image-2",
            size: "auto",
            imageResolution: "1K",
            quality: "low",
          },
        },
        ...(withReference
          ? [
              {
                id: "reference",
                kind: "image",
                title: "横版参考",
                x: -200,
                y: 30,
                width: 300,
                height: 200,
                metadata: {
                  assetId: "wide-reference",
                  assetScope: "personal",
                  naturalWidth: 1536,
                  naturalHeight: 1024,
                },
              },
            ]
          : []),
      ],
      edges: [],
      connections: [],
      groups: [],
      zoom: 100,
      panX: 0,
      panY: 0,
      viewport: { x: 0, y: 0, k: 1 },
    };
    const requests: Array<{ size: string; quality: string; prompt: string }> =
      [];
    const outputs: string[] = [];
    let mismatch = false;
    let rejectMismatch = false;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      const headers = {
        "Access-Control-Allow-Origin": new URL(page.url()).origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers":
          "authorization,content-type,x-request-id",
        "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      };
      if (request.method() === "OPTIONS")
        return route.fulfill({ headers, status: 204 });
      if (request.headers().accept === "text/event-stream")
        return route.fulfill({
          headers,
          contentType: "text/event-stream",
          body: ":ok\n\n",
        });
      if (/\/assets\/(image-\d+|wide-reference)\/content$/.test(path)) {
        const id = path.split("/").at(-2)!;
        const size =
          id === "wide-reference"
            ? "1536x1024"
            : outputs[Number(id.split("-")[1]) - 1];
        return route.fulfill({
          headers,
          contentType: "image/png",
          body: Buffer.from(fixtures[size], "base64"),
        });
      }
      let data: unknown = { items: [], total: 0 };
      if (path === "/api/auth/me")
        data = {
          id: "qa",
          account: "qa",
          role: "super_admin",
          status: "active",
          display_name: "QA",
        };
      else if (path === "/api/user/preferences")
        data = { canvas: { promptPresets: [] } };
      else if (path === "/api/ai/models")
        data = {
          models: [],
          image_models: ["gpt-image-2"],
          default_image_model: "gpt-image-2",
        };
      else if (path === `/api/projects/${project.id}/snapshot`) {
        if (request.method() === "PUT") snapshot = request.postDataJSON().data;
        data = { project_id: project.id, version: 1, data: snapshot };
      } else if (path === `/api/projects/${project.id}`)
        data = { ...project, data: snapshot };
      else if (path === "/api/projects") data = { items: [project], total: 1 };
      else if (
        /\/ai\/image\/(generations|edits)$/.test(path) &&
        request.method() === "POST"
      ) {
        expect(path.endsWith("/edits")).toBe(withReference);
        let input: { size: string; quality: string; prompt: string };
        if (withReference) {
          const form = await new Response(request.postDataBuffer(), {
            headers: { "Content-Type": request.headers()["content-type"] },
          }).formData();
          expect(form.get("image")).toBeTruthy();
          input = {
            size: String(form.get("size")),
            quality: String(form.get("quality")),
            prompt: String(form.get("prompt")),
          };
        } else input = request.postDataJSON();
        requests.push(input);
        outputs.push(mismatch ? "1536x1024" : input.size);
        data = { job_id: `job-image-${requests.length}`, status: "queued" };
      } else if (/\/jobs\/job-image-\d+$/.test(path)) {
        const index = path.split("-").at(-1);
        data = {
          id: `job-image-${index}`,
          status: rejectMismatch ? "failed" : "succeeded",
          ...(rejectMismatch
            ? {
                error: {
                  code: "image_output_size_mismatch",
                  message:
                    "图片尺寸不符合所选参数：要求 1024×1024 px，实际返回 1536×1024 px。请更换模型或调整参数后重试。",
                  retryable: false,
                },
              }
            : {}),
          type: "image.generate",
          result: {
            outputs: [
              {
                asset_id: `image-${index}`,
                name: "四个苹果",
                content_type: "image/png",
              },
            ],
          },
        };
      } else if (/\/assets\/(image-\d+|wide-reference)$/.test(path)) {
        data = {
          id: path.split("/").at(-1),
          type: "image",
          name: "四个苹果",
          content_type: "image/png",
        };
      }
      if (path === "/api/prompts")
        return route.fulfill({ headers, json: { items: [], total: 0 } });
      return route.fulfill({
        headers,
        json: { success: true, data, request_id: "image-parameters-qa" },
      });
    });
    await page.goto(`/canvas/${project.id}?scope=personal`);
    const node = page.locator('[data-node-id="target"]');
    await node.locator(".node-float-label").click();
    const inspector = page.locator(".inspector-panel");
    const cases = [
      {
        resolution: "1K",
        ratio: "1:1",
        detail: "低",
        quality: "low",
        size: "1024x1024",
      },
      {
        resolution: "2K",
        ratio: "3:4",
        detail: "中",
        quality: "medium",
        size: "1728x2304",
      },
      {
        resolution: "4K",
        ratio: "16:9",
        detail: "高",
        quality: "high",
        size: "3840x2160",
      },
      {
        resolution: "1K",
        ratio: "1:1",
        detail: "低",
        quality: "low",
        size: "1024x1024",
      },
    ];
    for (const [index, choice] of cases.entries()) {
      mismatch = index === cases.length - 1;
      await inspector
        .getByRole("button", { name: "参数", exact: true })
        .click();
      const parameters = page.locator(".node-pop-params");
      await parameters
        .getByRole("button", { name: choice.resolution, exact: true })
        .click();
      await parameters
        .getByRole("button", { name: choice.ratio, exact: true })
        .click();
      await parameters
        .getByRole("button", { name: choice.detail, exact: true })
        .click();
      await expect(parameters).toContainText(
        `请求尺寸：${choice.size.replace("x", " × ")} px`
      );
      await inspector
        .getByRole("button", { name: "生成", exact: true })
        .click();
      await expect.poll(() => requests.length).toBe(index + 1);
      expect(requests[index]).toMatchObject({
        size: choice.size,
        quality: choice.quality,
      });
      expect(requests[index].prompt).toContain(choice.size.replace("x", "×"));
      const [width, height] = outputs[index].split("x").map(Number);
      await expect(node.locator("img").first()).toHaveJSProperty(
        "naturalWidth",
        width
      );
      await expect(node.locator("img").first()).toHaveJSProperty(
        "naturalHeight",
        height
      );
      await expect
        .poll(
          () =>
            snapshot.nodes.find((item: any) => item.id === "target")?.metadata
              .naturalWidth
        )
        .toBe(width);
      await expect
        .poll(
          () =>
            snapshot.nodes.find((item: any) => item.id === "target")?.metadata
              .status
        )
        .toBe("success");
      const warning = inspector
        .getByRole("status")
        .filter({ hasText: "原图实际尺寸为" });
      if (mismatch) {
        await expect(warning).toContainText("1536 × 1024 px");
        await expect(warning).toContainText("1024 × 1024 px");
      } else await expect(warning).toHaveCount(0);
      expect(
        snapshot.nodes.find((item: any) => item.id === "target").metadata
          .composerContent
      ).toBe(prompt);
    }
    await page.screenshot({
      path: testInfo.outputPath("size-mismatch-visible.png"),
    });
    // The new worker rejects a mismatch before success/asset registration. Older
    // workers above are still covered by the decoded-image warning as a fallback.
    rejectMismatch = true;
    await inspector.getByRole("button", { name: "生成", exact: true }).click();
    await expect
      .poll(
        () =>
          snapshot.nodes.find((item: any) => item.id === "target")?.metadata
            .status
      )
      .toBe("error");
    await expect(inspector.getByRole("alert")).toContainText(
      "要求 1024×1024 px，实际返回 1536×1024 px"
    );
    await expect(
      inspector.getByRole("button", { name: "重试", exact: true })
    ).toBeVisible();
    expect(
      snapshot.nodes.find((item: any) => item.id === "target").metadata.assetId
    ).toBe("image-4");
    expect(requests).toHaveLength(5);
    await page.screenshot({
      path: testInfo.outputPath("nonconforming-output-rejected.png"),
    });
    expect(errors).toEqual([]);
  });
}
