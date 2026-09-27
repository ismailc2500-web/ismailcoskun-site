import type { LLMProvider, LLMRequest, LLMResult } from "@/lib/ai/types";
import type { ContinuityContext, MetadataContext, ShotContext, StoryContext } from "@/lib/story/contexts";
import { mockContinuity, mockMetadata, mockScreenplay, mockShotList } from "@/lib/ai/mock/writer";
import { approxTokens } from "@/lib/ai/json";

/** Offline LLM: deterministic template writer driven by the task's structured context. */
export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";
  readonly model = "mock-writer-v1";

  async complete(req: LLMRequest): Promise<LLMResult> {
    let output: unknown;
    switch (req.task) {
      case "story":
        output = mockScreenplay(req.context as StoryContext);
        break;
      case "shotlist":
        output = mockShotList(req.context as ShotContext);
        break;
      case "continuity":
        output = mockContinuity(req.context as ContinuityContext);
        break;
      case "metadata":
        output = mockMetadata(req.context as MetadataContext);
        break;
      default:
        output = { text: "Mock mode is active: free-form generation is disabled." };
    }
    const text = JSON.stringify(output);
    return {
      text,
      model: this.model,
      inputTokens: approxTokens(req.system + req.prompt),
      outputTokens: approxTokens(text),
      cost: 0,
    };
  }

  estimateCost() {
    return 0;
  }
}
