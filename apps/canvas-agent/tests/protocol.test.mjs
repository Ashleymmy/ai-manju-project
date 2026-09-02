import assert from "node:assert/strict";
import test from "node:test";

import { CANVAS_AGENT_PROTOCOL_VERSION, CANVAS_AGENT_TOOL_NAMES, CANVAS_AGENT_TOOLS } from "@ai-manju/canvas-agent-protocol";
import { parseToolInput } from "../dist/tools.js";

test("shared tool definitions and local validators stay aligned", () => {
    assert.equal(CANVAS_AGENT_PROTOCOL_VERSION, "1.0");
    assert.deepEqual(CANVAS_AGENT_TOOLS.map((item) => item.function.name), [...CANVAS_AGENT_TOOL_NAMES]);
    assert.deepEqual(parseToolInput("canvas_connect_nodes", { connections: [{ fromNodeId: "a", toNodeId: "b" }] }), {
        connections: [{ fromNodeId: "a", toNodeId: "b" }],
    });
    assert.throws(() => parseToolInput("canvas_connect_nodes", { connections: [] }));
    assert.deepEqual(parseToolInput("canvas_search_assets", { keyword: "角色", limit: 10 }), { keyword: "角色", limit: 10 });
    assert.deepEqual(parseToolInput("canvas_list_jobs", { statuses: ["queued", "running"] }), { statuses: ["queued", "running"] });
    assert.deepEqual(parseToolInput("canvas_cancel_job", { jobId: "job_1" }), { jobId: "job_1" });
    assert.throws(() => parseToolInput("canvas_add_assets", { assetIds: [] }));
});
