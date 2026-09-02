import { describe, expect, it } from "vitest";

import {
    CANVAS_AGENT_PROTOCOL_VERSION,
    CANVAS_AGENT_READ_TOOL_NAMES,
    CANVAS_AGENT_TOOL_NAMES,
    CANVAS_AGENT_TOOLS,
    isCanvasAgentReadTool,
    isCanvasAgentToolName,
    type CanvasAgentEvent,
    type CanvasAgentToolName,
    type CanvasAgentToolRequest,
    type CanvasAgentToolResult,
} from "../src/index.js";

type ToolParameters = {
    type: unknown;
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: unknown;
};

function parametersFor(name: CanvasAgentToolName): ToolParameters {
    const definition = CANVAS_AGENT_TOOLS.find((item) => item.function.name === name);
    if (!definition) throw new Error(`Missing tool definition: ${name}`);
    return definition.function.parameters as ToolParameters;
}

describe("canvas agent wire protocol", () => {
    it("keeps the versioned request, result, and event envelopes JSON-safe", () => {
        const request = {
            protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION,
            requestId: "request-1",
            name: "canvas_apply_ops",
            input: { ops: [{ type: "select_nodes", ids: ["node-1"] }] },
            requiresConfirmation: true,
        } satisfies CanvasAgentToolRequest;
        const result = {
            protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION,
            requestId: request.requestId,
            result: { applied: true },
        } satisfies CanvasAgentToolResult;
        const event = {
            protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION,
            channel: "online",
            type: "tool_result",
            timestamp: "2026-09-03T00:00:00.000Z",
            payload: result,
        } satisfies CanvasAgentEvent;
        const envelope = { request, result, event };

        expect(CANVAS_AGENT_PROTOCOL_VERSION).toBe("1.0");
        expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope);
    });

    it("publishes exactly one strict function schema for every public tool", () => {
        const registeredNames = CANVAS_AGENT_TOOLS.map((item) => item.function.name);

        expect(registeredNames).toEqual([...CANVAS_AGENT_TOOL_NAMES]);
        expect(new Set(registeredNames).size).toBe(registeredNames.length);

        for (const definition of CANVAS_AGENT_TOOLS) {
            const parameters = definition.function.parameters as ToolParameters;
            expect(definition.type).toBe("function");
            expect(definition.function.description.trim()).not.toBe("");
            expect(parameters).toMatchObject({
                type: "object",
                additionalProperties: false,
            });
            expect(Array.isArray(parameters.required)).toBe(true);
            for (const requiredName of parameters.required) {
                expect(parameters.properties).toHaveProperty(requiredName);
            }
        }
    });

    it("keeps operation and generation schemas aligned with their wire contracts", () => {
        const applyOps = parametersFor("canvas_apply_ops");
        const opsSchema = applyOps.properties.ops as {
            type: unknown;
            items: {
                properties: Record<string, unknown>;
                required: string[];
                additionalProperties: unknown;
            };
        };
        const opTypeSchema = opsSchema.items.properties.type as { type: unknown; enum: unknown[] };

        expect(applyOps.required).toEqual(["ops"]);
        expect(opsSchema.type).toBe("array");
        expect(opsSchema.items.required).toEqual(["type"]);
        expect(opsSchema.items.additionalProperties).toBe(false);
        expect(opTypeSchema).toEqual({
            type: "string",
            enum: [
                "add_node",
                "update_node",
                "delete_node",
                "delete_connections",
                "connect_nodes",
                "set_viewport",
                "select_nodes",
                "run_generation",
            ],
        });

        const genericGeneration = parametersFor("canvas_create_generation_flow");
        const imageGeneration = parametersFor("canvas_generate_image");
        expect(genericGeneration.required).toEqual(["prompt"]);
        expect(genericGeneration.properties.mode).toEqual({
            type: "string",
            enum: ["text", "image", "video", "audio"],
        });
        expect(imageGeneration.required).toEqual(["prompt"]);
        expect(imageGeneration.properties).not.toHaveProperty("mode");
    });

    it("classifies every public and read-only tool without accepting lookalikes", () => {
        const readTools = new Set<string>(CANVAS_AGENT_READ_TOOL_NAMES);

        for (const name of CANVAS_AGENT_TOOL_NAMES) {
            expect(isCanvasAgentToolName(name)).toBe(true);
            expect(isCanvasAgentReadTool(name)).toBe(readTools.has(name));
        }

        for (const invalid of ["", "canvas_get_states", "canvas_unknown", null, 0, {}, []]) {
            expect(isCanvasAgentToolName(invalid)).toBe(false);
            expect(isCanvasAgentReadTool(invalid)).toBe(false);
        }
    });
});
