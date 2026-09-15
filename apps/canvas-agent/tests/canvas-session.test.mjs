import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { CanvasSession } from "../dist/canvas-session.js";

class FakeResponse extends EventEmitter {
    constructor() {
        super();
        this.frames = [];
        this.ended = false;
    }

    writeHead() {}

    write(value) {
        this.frames.push(String(value));
    }

    end() {
        if (this.ended) return;
        this.ended = true;
        this.emit("close");
    }

    events(type) {
        return this.frames
            .map((frame) => frame.match(/^event: ([^\n]+)\ndata: ([\s\S]+?)\n\n$/))
            .filter((match) => match && match[1] === type)
            .map((match) => JSON.parse(match[2]));
    }
}

function snapshot(projectId) {
    return { projectId, title: projectId, nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
}

function connect(session, clientId) {
    const response = new FakeResponse();
    session.openEvents(new URL(`http://127.0.0.1/events?clientId=${clientId}`), response);
    session.updateState(snapshot(clientId), clientId);
    return response;
}

test("keeps canvas tool calls and snapshots isolated per client", async () => {
    const session = new CanvasSession();
    const a = connect(session, "a");
    const b = connect(session, "b");

    assert.equal((await session.callTool("canvas_get_state", {}, "a")).projectId, "a");
    assert.equal((await session.callTool("canvas_get_state", {}, "b")).projectId, "b");

    const aResult = session.callTool("canvas_apply_ops", { ops: [{ type: "select_nodes", ids: ["a-node"] }] }, "a");
    await new Promise((resolve) => setImmediate(resolve));
    const aRequest = a.events("tool_call")[0];
    assert.ok(aRequest?.requestId);
    assert.equal(b.events("tool_call").length, 0);
    session.resolveResult({ requestId: aRequest.requestId, result: { snapshot: snapshot("a-next") } }, "a");
    assert.deepEqual(await aResult, { snapshot: snapshot("a-next") });
    assert.equal(session.health().clients, 2);
    assert.equal(session.health().hasCanvas, true);
    a.end();
    b.end();
});

test("disconnecting one client rejects only its pending tool call", async () => {
    const session = new CanvasSession();
    const a = connect(session, "a");
    const b = connect(session, "b");
    const aResult = session.callTool("canvas_apply_ops", { ops: [{ type: "select_nodes", ids: [] }] }, "a");
    const bResult = session.callTool("canvas_apply_ops", { ops: [{ type: "select_nodes", ids: [] }] }, "b");
    await new Promise((resolve) => setImmediate(resolve));
    const bRequest = b.events("tool_call")[0];
    a.end();
    await assert.rejects(aResult, /画布连接已断开/);
    session.resolveResult({ requestId: bRequest.requestId, result: { ok: true } }, "b");
    assert.deepEqual(await bResult, { ok: true });
    assert.equal(session.health().clients, 1);
    b.end();
});

test("reconnecting the same client replaces the old stream without deleting the new one", () => {
    const session = new CanvasSession();
    const oldResponse = connect(session, "a");
    const oldGeneration = session.connectionGeneration("a");
    const newResponse = new FakeResponse();
    session.openEvents(new URL("http://127.0.0.1/events?clientId=a"), newResponse);
    oldResponse.emit("close");
    session.emit("a", "agent_event", { stale: true }, oldGeneration);
    session.emit("a", "agent_event", { ok: true });
    assert.equal(oldResponse.events("agent_event").length, 0);
    assert.deepEqual(newResponse.events("agent_event"), [{ ok: true }]);
    newResponse.end();
});
