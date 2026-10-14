import { expect, it } from "vitest";
import { usageModelLabel } from "./usageModelLabel";

it("prefers the catalog name and admin alias over the upstream endpoint id", () => {
  expect(
    usageModelLabel({
      model: "ep-25",
      studioModel: "official::seedance-2.5",
    })
  ).toBe("seedance-2.5");
  expect(
    usageModelLabel({
      model: "ep-25",
      studioModel: "private::ep-25",
      labels: { "private::ep-25": "Seedance 2.5" },
    })
  ).toBe("Seedance 2.5");
  expect(
    usageModelLabel({
      model: "ep-25",
      labels: { "vendor::ep-25": "Seedance 2.5" },
    })
  ).toBe("Seedance 2.5");
  expect(usageModelLabel({ model: "ep-25" })).toBe("ep-25");
});
