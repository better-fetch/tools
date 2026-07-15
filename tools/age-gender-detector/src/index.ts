import { defineTool } from "@better-fetch/tools";

type Input = {
  image_url: string;
};

type Output = {
  image_url: string;
  age_range: string;
  age_midpoint: number;
  age_confidence: number;
  gender_presentation: "male" | "female";
  gender_confidence: number;
  image_width: number;
  image_height: number;
  model: string;
  limitations: string;
};

type AgeGenderCapability = {
  ageGender(payload: { url: string }): Promise<{
    source_url?: string;
    age_range?: string;
    age_midpoint?: number;
    age_confidence?: number;
    gender_presentation?: "male" | "female";
    gender_confidence?: number;
    image_width?: number;
    image_height?: number;
    model?: string;
    limitations?: string;
  }>;
};

export default defineTool<Input, Output>(async (input, bf) => {
  const imageUrl = input.image_url?.trim();
  if (!imageUrl) throw new Error("image_url is required");
  const result = await (bf as typeof bf & AgeGenderCapability).ageGender({ url: imageUrl });
  if (
    !result.age_range
    || result.age_midpoint === undefined
    || result.age_confidence === undefined
    || !result.gender_presentation
    || result.gender_confidence === undefined
    || result.image_width === undefined
    || result.image_height === undefined
    || !result.model
    || !result.limitations
  ) {
    throw new Error("Local vision returned an incomplete estimate");
  }
  return {
    image_url: result.source_url ?? imageUrl,
    age_range: result.age_range,
    age_midpoint: result.age_midpoint,
    age_confidence: result.age_confidence,
    gender_presentation: result.gender_presentation,
    gender_confidence: result.gender_confidence,
    image_width: result.image_width,
    image_height: result.image_height,
    model: result.model,
    limitations: result.limitations,
  };
});
