# age-gender-detector

Estimate a coarse age range and binary gender presentation from one public,
face-focused image. The tool calls Better Fetch's bounded local ONNX inference
lane; the image is not sent to an external vision API.

This is appearance classification, not identity, exact age, self-described
gender, or age verification. It should never be used for employment, housing,
insurance, credit, law enforcement, eligibility, or another high-stakes
decision. The Adience classifiers work best on a clear, centered, front-facing
face and can be wrong across lighting, pose, age, and demographic groups.

Input:

```json
{
  "image_url": "https://images.pexels.com/photos/614810/pexels-photo-614810.jpeg?w=720"
}
```

The URL can omit `https://`; Better Fetch defaults bare public hosts to HTTPS.
One successful estimate consumes one credit.
